import { createHmac, createSign, timingSafeEqual } from "node:crypto";

import { createModuleLogger } from "../../logger/index.ts";
import type {
  AgentRailProviderStatus,
  MoonPayCurrencyLimits,
  MoonPayCustomerLimits,
  MoonPayQuoteIntent,
  MoonPayQuoteResult,
  MoonPaySwapPair,
  MoonPaySwapQuoteIntent,
  MoonPayTransactionLookup,
  MoonPayTransactionSummary,
  MoonPayVirtualAccount,
  MoonPayVirtualAccountFilters,
  MoonPayVirtualAccountTransactionPage,
  MoonPayVirtualAccountTransactionQuery,
  MoonPayWebhookVerificationInput,
  MoonPayWebhookVerificationResult,
  WalletFundingIntent,
  WalletLinkResult,
  WalletProvider,
  WalletSwapIntent,
} from "../types.ts";
import type { WalletProviderConfig } from "../../../types/index.ts";

const logger = createModuleLogger("rails-moonpay");

const DEFAULT_MOONPAY_BUY_URL = "https://buy.moonpay.com";
const DEFAULT_MOONPAY_SELL_URL = "https://sell.moonpay.com";
const DEFAULT_MOONPAY_SWAP_URL = "https://swap.moonpay.com";
const DEFAULT_MOONPAY_API_BASE = "https://api.moonpay.com";
const DEFAULT_MOONPAY_VIRTUAL_ACCOUNTS_BASE = `${DEFAULT_MOONPAY_API_BASE}/v1/virtual-accounts`;

type QueryValue = string | number | boolean | undefined | null;

function setQueryParams(url: URL, params: Record<string, QueryValue>): void {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    url.searchParams.set(key, typeof value === "boolean" ? String(value) : String(value));
  }
}

function parseNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function parseTimestamp(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const normalized = value > 1e12 ? value : value * 1000;
    const date = new Date(normalized);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function getPathValue(record: Record<string, unknown>, key: string): unknown {
  if (!key.includes(".")) {
    return record[key];
  }

  let current: unknown = record;
  for (const segment of key.split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function extractString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = getPathValue(record, key);
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return undefined;
}

function extractNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = parseNumber(getPathValue(record, key));
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function normalizeQuote(raw: Record<string, unknown>, mode: "buy" | "sell" | "swap"): MoonPayQuoteResult {
  return {
    provider: "moonpay",
    mode,
    raw,
  };
}

function normalizeTransaction(record: Record<string, unknown>, mode: MoonPayTransactionSummary["mode"]): MoonPayTransactionSummary {
  return {
    provider: "moonpay",
    mode,
    id: extractString(record, ["id", "transactionId"]) || "unknown",
    status: extractString(record, ["status"]),
    createdAt: parseTimestamp(record.createdAt ?? record.created_at ?? record.created),
    updatedAt: parseTimestamp(record.updatedAt ?? record.updated_at ?? record.updated),
    baseCurrencyCode: extractString(record, ["baseCurrencyCode", "baseCurrency", "baseCurrency.code"]),
    quoteCurrencyCode: extractString(record, ["quoteCurrencyCode", "currencyCode", "quoteCurrency", "quoteCurrency.code"]),
    baseCurrencyAmount: extractNumber(record, ["baseCurrencyAmount", "baseCurrency.amount", "baseAmount"]),
    quoteCurrencyAmount: extractNumber(record, ["quoteCurrencyAmount", "quoteCurrency.amount", "amount"]),
    externalTransactionId: extractString(record, ["externalTransactionId", "externalId"]),
    raw: record,
  };
}

function normalizeVirtualAccount(record: Record<string, unknown>): MoonPayVirtualAccount {
  return {
    provider: "moonpay",
    id: extractString(record, ["id", "virtualAccountId"]) || "unknown",
    status: extractString(record, ["status"]),
    externalCustomerId: extractString(record, ["externalCustomerId"]),
    walletAddress: extractString(record, ["walletAddress", "depositAddress", "address"]),
    raw: record,
  };
}

function buildSwapPair(intent: MoonPaySwapQuoteIntent): string {
  if (intent.pair?.trim()) {
    return intent.pair.trim();
  }
  if (intent.fromCurrencyCode?.trim() && intent.toCurrencyCode?.trim()) {
    return `${intent.fromCurrencyCode.trim().toLowerCase()}_${intent.toCurrencyCode.trim().toLowerCase()}`;
  }
  throw new Error("MoonPay swap quote requires either a pair or both fromCurrencyCode and toCurrencyCode.");
}

function needsSignedWidget(params: Record<string, QueryValue>): boolean {
  return Boolean(params.walletAddress || params.refundWalletAddress || params.email || params.externalCustomerId);
}

function parseMoonPaySignatureHeader(header: string): { timestamp?: number; signature?: string } {
  const parts = header.split(",");
  let timestamp: number | undefined;
  let signature: string | undefined;

  for (const part of parts) {
    const [rawKey, rawValue] = part.split("=", 2);
    const key = rawKey?.trim().toLowerCase();
    const value = rawValue?.trim();
    if (!key || !value) {
      continue;
    }

    if (key === "t") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        timestamp = parsed;
      }
    } else if (key === "s" || key === "v1") {
      signature = value;
    }
  }

  return { timestamp, signature };
}

async function parseJsonResponse(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`MoonPay response was not valid JSON: ${text.slice(0, 200)}`);
  }
}

export class MoonPayProvider implements WalletProvider {
  readonly id = "moonpay" as const;
  readonly config: WalletProviderConfig;
  private readonly apiKey?: string;
  private readonly secretKey?: string;
  private readonly widgetUrl?: string;
  private readonly webhookApiKey?: string;
  private readonly virtualAccountsPrivateKey?: string;
  private readonly apiBaseUrl: string;
  private readonly virtualAccountsBaseUrl: string;

  constructor(config: WalletProviderConfig) {
    this.config = config;
    this.apiKey = process.env.MOONPAY_API_KEY;
    this.secretKey = process.env.MOONPAY_SECRET_KEY;
    this.widgetUrl = process.env.MOONPAY_WIDGET_URL;
    this.webhookApiKey = process.env.MOONPAY_WEBHOOK_API_KEY || process.env.MOONPAY_API_KEY;
    this.virtualAccountsPrivateKey = process.env.MOONPAY_VIRTUAL_ACCOUNTS_PRIVATE_KEY;
    this.apiBaseUrl = DEFAULT_MOONPAY_API_BASE;
    this.virtualAccountsBaseUrl = DEFAULT_MOONPAY_VIRTUAL_ACCOUNTS_BASE;
  }

  getStatus(): AgentRailProviderStatus {
    const warnings: string[] = [];
    if (!this.apiKey) {
      warnings.push("MOONPAY_API_KEY is not configured; public quote, limits, and transaction detail calls will fail.");
    }
    if (!this.secretKey) {
      warnings.push("MOONPAY_SECRET_KEY is not configured; signed widget URLs and authenticated transaction history will be unavailable.");
    }
    if (!this.virtualAccountsPrivateKey) {
      warnings.push("MOONPAY_VIRTUAL_ACCOUNTS_PRIVATE_KEY is not configured; virtual account APIs will be unavailable.");
    }
    if (this.config.authMode !== "native" && !this.config.mcpServerId) {
      warnings.push("MoonPay MCP mode is enabled but no MCP server id is configured.");
    }

    return {
      id: this.id,
      kind: "wallet",
      configured: Boolean(
        this.apiKey
        || this.secretKey
        || this.widgetUrl
        || this.webhookApiKey
        || this.virtualAccountsPrivateKey,
      ),
      enabled: this.config.enabled,
      authMode: this.config.authMode,
      transport: this.config.authMode === "hybrid" ? "hybrid" : this.config.authMode,
      mcpServerId: this.config.mcpServerId,
      warnings,
      details: {
        network: this.config.network,
        walletAddress: this.config.walletAddress,
        customerId: this.config.customerId,
        externalCustomerId: this.config.externalCustomerId,
        signedWidgetUrls: Boolean(this.secretKey),
        virtualAccounts: Boolean(this.virtualAccountsPrivateKey),
      },
    };
  }

  private buildWidgetLink(
    baseUrl: string,
    mode: WalletLinkResult["mode"],
    params: Record<string, QueryValue>,
  ): WalletLinkResult {
    const url = new URL(baseUrl);
    setQueryParams(url, params);

    let signature: string | undefined;
    if (this.secretKey && needsSignedWidget(params)) {
      signature = createHmac("sha256", this.secretKey).update(url.search).digest("base64");
      url.searchParams.set("signature", signature);
    }

    return {
      provider: "moonpay",
      mode,
      url: url.toString(),
      query: Object.fromEntries(url.searchParams.entries()),
      signed: Boolean(signature),
      signature,
    };
  }

  buildOnRampLink(intent: WalletFundingIntent): WalletLinkResult {
    return this.buildWidgetLink(this.widgetUrl || this.config.apiBaseUrl || DEFAULT_MOONPAY_BUY_URL, "buy", {
      apiKey: this.apiKey,
      baseCurrencyCode: intent.baseCurrencyCode.toLowerCase(),
      quoteCurrencyCode: intent.quoteCurrencyCode.toLowerCase(),
      walletAddress: intent.walletAddress || this.config.walletAddress,
      lockAmount: intent.lockAmount,
      baseCurrencyAmount: intent.baseCurrencyAmount,
      quoteCurrencyAmount: intent.quoteCurrencyAmount,
      redirectURL: intent.redirectUrl || this.config.redirectUrl,
      network: intent.network || this.config.network,
      email: intent.email || this.config.email,
      externalCustomerId: intent.externalCustomerId || this.config.externalCustomerId,
      theme: intent.theme,
      ...intent.metadata,
    });
  }

  buildSellLink(intent: WalletFundingIntent): WalletLinkResult {
    return this.buildWidgetLink(DEFAULT_MOONPAY_SELL_URL, "sell", {
      apiKey: this.apiKey,
      baseCurrencyCode: intent.baseCurrencyCode.toLowerCase(),
      quoteCurrencyCode: intent.quoteCurrencyCode.toLowerCase(),
      refundWalletAddress: intent.walletAddress || this.config.walletAddress,
      baseCurrencyAmount: intent.baseCurrencyAmount,
      quoteCurrencyAmount: intent.quoteCurrencyAmount,
      redirectURL: intent.redirectUrl || this.config.redirectUrl,
      network: intent.network || this.config.network,
      email: intent.email || this.config.email,
      externalCustomerId: intent.externalCustomerId || this.config.externalCustomerId,
      theme: intent.theme,
      ...intent.metadata,
    });
  }

  buildSwapLink(intent: WalletSwapIntent): WalletLinkResult {
    return this.buildWidgetLink(DEFAULT_MOONPAY_SWAP_URL, "swap", {
      apiKey: this.apiKey,
      fromCurrencyCode: intent.fromCurrencyCode.toLowerCase(),
      toCurrencyCode: intent.toCurrencyCode.toLowerCase(),
      walletAddress: intent.walletAddress || this.config.walletAddress,
      amount: intent.amount,
      amountCurrencyCode: intent.amountCurrencyCode,
      redirectURL: intent.redirectUrl || this.config.redirectUrl,
      email: intent.email || this.config.email,
      externalCustomerId: intent.externalCustomerId || this.config.externalCustomerId,
      theme: intent.theme,
      ...intent.metadata,
    });
  }

  private ensureApiKey(): string {
    if (!this.apiKey) {
      throw new Error("MOONPAY_API_KEY is required for native MoonPay public API calls.");
    }
    return this.apiKey;
  }

  private ensureSecretKey(): string {
    if (!this.secretKey) {
      throw new Error("MOONPAY_SECRET_KEY is required for authenticated MoonPay API calls.");
    }
    return this.secretKey;
  }

  private ensureVirtualAccountsPrivateKey(): string {
    if (!this.virtualAccountsPrivateKey) {
      throw new Error("MOONPAY_VIRTUAL_ACCOUNTS_PRIVATE_KEY is required for MoonPay virtual account API calls.");
    }
    return this.virtualAccountsPrivateKey;
  }

  private async requestPublic(path: string, query: Record<string, QueryValue> = {}): Promise<Record<string, unknown>> {
    const url = new URL(path, this.apiBaseUrl);
    setQueryParams(url, {
      apiKey: this.ensureApiKey(),
      ...query,
    });

    const response = await fetch(url, {
      headers: {
        accept: "application/json",
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`MoonPay public request failed: ${response.status} ${response.statusText} ${body}`.trim());
    }

    return parseJsonResponse(response);
  }

  private async requestWithSecret(path: string, query: Record<string, QueryValue> = {}): Promise<Record<string, unknown>> {
    const url = new URL(path, this.apiBaseUrl);
    setQueryParams(url, query);

    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        Authorization: this.ensureSecretKey(),
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`MoonPay authenticated request failed: ${response.status} ${response.statusText} ${body}`.trim());
    }

    return parseJsonResponse(response);
  }

  private async requestVirtualAccounts(path: string, query: Record<string, QueryValue> = {}): Promise<Record<string, unknown>> {
    const url = new URL(path, `${this.virtualAccountsBaseUrl}/`);
    setQueryParams(url, {
      apiKey: this.ensureApiKey(),
      timestamp: Date.now(),
      ...query,
    });

    const payload = `${url.pathname}${url.search}`;
    const signer = createSign("RSA-SHA256");
    signer.update(payload);
    signer.end();
    const signature = signer.sign(this.ensureVirtualAccountsPrivateKey(), "base64");

    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-signature": signature,
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`MoonPay virtual accounts request failed: ${response.status} ${response.statusText} ${body}`.trim());
    }

    return parseJsonResponse(response);
  }

  async getCurrencyLimits(currencyCode: string, paymentMethod?: string): Promise<MoonPayCurrencyLimits> {
    const raw = await this.requestPublic(`/v3/currencies/${currencyCode.toLowerCase()}/limits`, {
      paymentMethod,
    });

    return {
      provider: "moonpay",
      currencyCode: currencyCode.toLowerCase(),
      paymentMethod,
      raw,
    };
  }

  async getQuote(intent: MoonPayQuoteIntent): Promise<MoonPayQuoteResult> {
    const raw = await this.requestPublic(
      `/v3/currencies/${intent.currencyCode.toLowerCase()}/${intent.mode}_quote`,
      {
        baseCurrencyAmount: intent.baseCurrencyAmount,
        quoteCurrencyAmount: intent.quoteCurrencyAmount,
        baseCurrencyCode: intent.baseCurrencyCode?.toLowerCase(),
        paymentMethod: intent.paymentMethod,
        areFeesIncluded: intent.areFeesIncluded,
        extraFeePercentage: intent.extraFeePercentage,
      },
    );

    return normalizeQuote(raw, intent.mode);
  }

  async getSwapPairs(): Promise<MoonPaySwapPair[]> {
    const raw = await this.requestPublic("/v4/swap/pairs");
    const pairs = Array.isArray(raw.data)
      ? raw.data
      : Array.isArray(raw.pairs)
        ? raw.pairs
        : Array.isArray(raw)
          ? raw
          : [];

    return pairs.map((entry) => {
      const record = asRecord(entry);
      const pair = extractString(record, ["pair", "id", "name"]) || "unknown";
      return {
        provider: "moonpay",
        pair,
        fromCurrencyCode: extractString(record, ["fromCurrencyCode", "baseCurrencyCode", "from"]),
        toCurrencyCode: extractString(record, ["toCurrencyCode", "quoteCurrencyCode", "to"]),
        raw: record,
      };
    });
  }

  async getSwapQuote(intent: MoonPaySwapQuoteIntent): Promise<MoonPayQuoteResult> {
    const pair = buildSwapPair(intent);
    const raw = await this.requestPublic(`/v4/swap/${pair}/quote`, {
      amount: intent.amount,
      amountCurrencyCode: intent.amountCurrencyCode,
      externalCustomerId: intent.externalCustomerId || this.config.externalCustomerId,
    });

    return normalizeQuote(raw, "swap");
  }

  async getTransactions(input: MoonPayTransactionLookup): Promise<MoonPayTransactionSummary[]> {
    if (input.transactionId) {
      const path = input.mode === "buy"
        ? `/v1/transactions/${input.transactionId}`
        : `/v1/sell_transactions/${input.transactionId}`;
      const raw = await this.requestPublic(path);
      return [normalizeTransaction(raw, input.mode)];
    }

    if (input.externalTransactionId) {
      const path = input.mode === "buy"
        ? `/v1/transactions/ext/${input.externalTransactionId}`
        : `/v1/sell_transactions/ext/${input.externalTransactionId}`;
      const raw = await this.requestPublic(path);
      return [normalizeTransaction(raw, input.mode)];
    }

    if (!input.customerId) {
      throw new Error("MoonPay transaction history requires either a transactionId, externalTransactionId, or customerId.");
    }

    const path = input.mode === "buy" ? "/v1/transactions" : "/v1/sell_transactions";
    const raw = await this.requestWithSecret(path, {
      customerId: input.customerId,
      limit: input.limit,
    });

    const items = Array.isArray(raw.data)
      ? raw.data
      : Array.isArray(raw.transactions)
        ? raw.transactions
        : Array.isArray(raw)
          ? raw
          : [];
    return items.map((item) => normalizeTransaction(asRecord(item), input.mode));
  }

  async getCustomerLimits(customerId: string, externalCustomerId: boolean = false): Promise<MoonPayCustomerLimits[]> {
    const path = externalCustomerId
      ? `/v1/customers/ext/${customerId}/limits`
      : `/v1/customers/${customerId}/limits`;
    const raw = await this.requestWithSecret(path);
    const items = Array.isArray(raw.data)
      ? raw.data
      : Array.isArray(raw.limits)
        ? raw.limits
        : Array.isArray(raw)
          ? raw
          : [raw];

    return items.map((item) => {
      const record = asRecord(item);
      return {
        provider: "moonpay",
        customerId: externalCustomerId
          ? extractString(record, ["customerId"]) || customerId
          : customerId,
        externalCustomerId: externalCustomerId ? customerId : extractString(record, ["externalCustomerId"]),
        raw: record,
      };
    });
  }

  async getVirtualAccounts(filters: MoonPayVirtualAccountFilters = {}): Promise<MoonPayVirtualAccount[]> {
    const raw = await this.requestVirtualAccounts(".", {
      virtualAccountId: filters.virtualAccountId,
      externalCustomerId: filters.externalCustomerId,
      walletAddress: filters.walletAddress,
    });

    const items = Array.isArray(raw.data)
      ? raw.data
      : Array.isArray(raw.virtualAccounts)
        ? raw.virtualAccounts
        : Array.isArray(raw)
          ? raw
          : [raw];

    return items
      .map((item) => asRecord(item))
      .filter((item) => Object.keys(item).length > 0)
      .map(normalizeVirtualAccount);
  }

  async getVirtualAccountTransactions(input: MoonPayVirtualAccountTransactionQuery): Promise<MoonPayVirtualAccountTransactionPage> {
    const basePath = `transactions/${input.mode}`;
    const path = input.transactionId ? `${basePath}/${input.transactionId}` : basePath;
    const raw = await this.requestVirtualAccounts(path, {
      virtualAccountId: input.virtualAccountId,
      externalCustomerId: input.externalCustomerId,
      cursor: input.cursor,
      pageSize: input.pageSize,
    });

    const items = Array.isArray(raw.data)
      ? raw.data
      : Array.isArray(raw.transactions)
        ? raw.transactions
        : Array.isArray(raw)
          ? raw
          : [raw];

    return {
      provider: "moonpay",
      mode: input.mode,
      nextCursor: extractString(raw, ["nextCursor", "cursor", "next"]),
      transactions: items
        .map((item) => asRecord(item))
        .filter((item) => Object.keys(item).length > 0)
        .map((item) => normalizeTransaction(item, input.mode === "onramp" ? "virtual-onramp" : "virtual-offramp")),
      raw,
    };
  }

  verifyWebhookSignature(input: MoonPayWebhookVerificationInput): MoonPayWebhookVerificationResult {
    if (!this.webhookApiKey) {
      return {
        provider: "moonpay",
        valid: false,
        reason: "MOONPAY_WEBHOOK_API_KEY is not configured.",
      };
    }

    const { timestamp, signature: receivedSignature } = parseMoonPaySignatureHeader(input.signatureHeader);
    if (!timestamp || !receivedSignature) {
      return {
        provider: "moonpay",
        valid: false,
        reason: "MoonPay webhook signature header is missing timestamp or signature.",
      };
    }

    const maxAgeSeconds = input.maxAgeSeconds ?? 300;
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSeconds - timestamp) > maxAgeSeconds) {
      return {
        provider: "moonpay",
        valid: false,
        timestamp,
        receivedSignature,
        reason: `MoonPay webhook signature is outside the ${maxAgeSeconds}s replay window.`,
      };
    }

    const method = input.method || "POST";
    const signedPayload = method === "GET"
      ? `${timestamp}.${input.requestPath || ""}`
      : `${timestamp}.${input.payload}`;
    const expectedSignature = createHmac("sha256", this.webhookApiKey).update(signedPayload).digest("hex");

    let valid = false;
    try {
      valid = timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(receivedSignature));
    } catch (error) {
      logger.warn("MoonPay webhook signature comparison failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return {
      provider: "moonpay",
      valid,
      timestamp,
      expectedSignature,
      receivedSignature,
      reason: valid ? undefined : "MoonPay webhook signature did not match.",
    };
  }
}
