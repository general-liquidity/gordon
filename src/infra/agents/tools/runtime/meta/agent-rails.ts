import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { getAuditLogger } from "../../../../platform/audit/audit-log.ts";
import { recordApiCall } from "../../../../platform/observability/index.ts";
import { getGordonContext, isArmed, type MastraExecutionContext } from "../../types.ts";

const agentRailStatusSchema = z.object({
  activeWalletProviderId: z.string().nullable(),
  activeChainProviderId: z.string().nullable(),
  activePaymentProviderId: z.string().nullable(),
  approvalsRequired: z.boolean(),
  statuses: z.array(z.object({
    id: z.string(),
    kind: z.enum(["wallet", "chain", "payment"]),
    configured: z.boolean(),
    enabled: z.boolean(),
    authMode: z.enum(["native", "mcp", "hybrid"]),
    transport: z.enum(["native", "mcp", "hybrid"]),
    mcpServerId: z.string().optional(),
    warnings: z.array(z.string()).optional(),
    details: z.record(z.string(), z.unknown()).optional(),
  })),
  error: z.string().optional(),
});

export const getAgentRailsStatusTool = createTool({
  id: "get_agent_rails_status",
  description:
    "Show the status of Gordon's native wallet, chain-data, and payments rails. " +
    "Use when the user asks about Helius, MoonPay, Polygon x402, wallet rails, payment rails, or MCP fast paths.",
  inputSchema: z.object({}),
  outputSchema: agentRailStatusSchema,
  execute: async (_input, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.agentRails) {
      return {
        activeWalletProviderId: null,
        activeChainProviderId: null,
        activePaymentProviderId: null,
        approvalsRequired: true,
        statuses: [],
        error: "Agent rails are not configured in the current runtime context.",
      };
    }

    getAuditLogger(ctx.userId || "system").success(
      "AGENT_RAIL_STATUS_READ",
      {},
      {
        metadata: {
          rails: ctx.agentRails.getStatuses().map((status) => status.id),
        },
      },
    );

    return {
      activeWalletProviderId: ctx.agentRails.activeWalletProvider?.config.id || null,
      activeChainProviderId: ctx.agentRails.activeChainProvider?.config.id || null,
      activePaymentProviderId: ctx.agentRails.activePaymentProvider?.config.id || null,
      approvalsRequired: ctx.config.agentRails.requireApprovalForExternalActions,
      statuses: ctx.agentRails.getStatuses(),
    };
  },
});

const heliusWalletOverviewSchema = z.object({
  provider: z.literal("helius").optional(),
  address: z.string().optional(),
  nativeBalanceLamports: z.number().optional(),
  assetCount: z.number().optional(),
  assets: z.array(z.object({
    id: z.string(),
    symbol: z.string(),
    name: z.string().optional(),
    amount: z.number().optional(),
    usdValue: z.number().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })).optional(),
  error: z.string().optional(),
});

export const heliusWalletOverviewTool = createTool({
  id: "helius_wallet_overview",
  description:
    "Inspect a Solana wallet using Gordon's native Helius provider. " +
    "Use when the user asks for a Solana wallet overview, token holdings, or portfolio composition.",
  inputSchema: z.object({
    address: z.string().describe("Solana wallet address to inspect."),
    limit: z.number().int().min(1).max(100).default(25),
  }),
  outputSchema: heliusWalletOverviewSchema,
  execute: async ({ address, limit }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    const provider = ctx?.agentRails?.activeChainProvider;
    if (!provider || provider.id !== "helius") {
      return { error: "Helius is not configured as the active native chain provider." };
    }

    const startedAt = Date.now();
    try {
      const result = await provider.getWalletOverview(address, limit);
      recordApiCall("helius.getWalletOverview", Date.now() - startedAt);
      getAuditLogger(ctx.userId || "system").success("HELIUS_QUERY", { action: "wallet_overview", address, limit });
      return result;
    } catch (error) {
      getAuditLogger(ctx?.userId || "system").failure(
        "HELIUS_QUERY",
        { action: "wallet_overview", address, limit },
        error instanceof Error ? error.message : String(error),
      );
      return { error: error instanceof Error ? error.message : String(error) };
    }
  },
});

const heliusTransactionsSchema = z.object({
  transactions: z.array(z.object({
    signature: z.string(),
    slot: z.number(),
    timestamp: z.string().optional(),
    err: z.string().nullable().optional(),
    memo: z.string().nullable().optional(),
    confirmationStatus: z.string().optional(),
  })).optional(),
  error: z.string().optional(),
});

export const heliusRecentTransactionsTool = createTool({
  id: "helius_recent_transactions",
  description:
    "Fetch recent Solana transactions for an address using Gordon's native Helius provider. " +
    "Use when the user asks for recent wallet activity or transaction history on Solana.",
  inputSchema: z.object({
    address: z.string().describe("Solana wallet address."),
    limit: z.number().int().min(1).max(50).default(10),
  }),
  outputSchema: heliusTransactionsSchema,
  execute: async ({ address, limit }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    const provider = ctx?.agentRails?.activeChainProvider;
    if (!provider || provider.id !== "helius") {
      return { error: "Helius is not configured as the active native chain provider." };
    }

    const startedAt = Date.now();
    try {
      const transactions = await provider.getRecentTransactions(address, limit);
      recordApiCall("helius.getRecentTransactions", Date.now() - startedAt);
      getAuditLogger(ctx.userId || "system").success("HELIUS_QUERY", { action: "recent_transactions", address, limit });
      return { transactions };
    } catch (error) {
      getAuditLogger(ctx?.userId || "system").failure(
        "HELIUS_QUERY",
        { action: "recent_transactions", address, limit },
        error instanceof Error ? error.message : String(error),
      );
      return { error: error instanceof Error ? error.message : String(error) };
    }
  },
});

const heliusTokenMetadataSchema = z.object({
  mint: z.string().optional(),
  symbol: z.string().optional(),
  name: z.string().optional(),
  decimals: z.number().optional(),
  description: z.string().optional(),
  image: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  error: z.string().optional(),
});

export const heliusTokenMetadataTool = createTool({
  id: "helius_token_metadata",
  description:
    "Look up Solana token metadata using Gordon's native Helius provider. " +
    "Use when the user asks for a token's metadata, image, symbol, or decimals.",
  inputSchema: z.object({
    mint: z.string().describe("Token mint address."),
  }),
  outputSchema: heliusTokenMetadataSchema,
  execute: async ({ mint }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    const provider = ctx?.agentRails?.activeChainProvider;
    if (!provider || provider.id !== "helius") {
      return { error: "Helius is not configured as the active native chain provider." };
    }

    const startedAt = Date.now();
    try {
      const result = await provider.getTokenMetadata(mint);
      recordApiCall("helius.getTokenMetadata", Date.now() - startedAt);
      getAuditLogger(ctx.userId || "system").success("HELIUS_QUERY", { action: "token_metadata", mint });
      return result;
    } catch (error) {
      getAuditLogger(ctx?.userId || "system").failure(
        "HELIUS_QUERY",
        { action: "token_metadata", mint },
        error instanceof Error ? error.message : String(error),
      );
      return { error: error instanceof Error ? error.message : String(error) };
    }
  },
});

const moonpayLinkSchema = z.object({
  provider: z.literal("moonpay").optional(),
  mode: z.enum(["buy", "sell", "swap"]).optional(),
  url: z.string().optional(),
  query: z.record(z.string(), z.string()).optional(),
  signed: z.boolean().optional(),
  signature: z.string().optional(),
  error: z.string().optional(),
});

const moonpayRawSchema = z.record(z.string(), z.unknown());

const moonpayLimitsSchema = z.object({
  provider: z.literal("moonpay").optional(),
  currencyCode: z.string().optional(),
  paymentMethod: z.string().optional(),
  raw: moonpayRawSchema.optional(),
  error: z.string().optional(),
});

const moonpayQuoteSchema = z.object({
  provider: z.literal("moonpay").optional(),
  mode: z.enum(["buy", "sell", "swap"]).optional(),
  raw: moonpayRawSchema.optional(),
  error: z.string().optional(),
});

const moonpaySwapPairsSchema = z.object({
  pairs: z.array(z.object({
    provider: z.literal("moonpay").optional(),
    pair: z.string(),
    fromCurrencyCode: z.string().optional(),
    toCurrencyCode: z.string().optional(),
    raw: moonpayRawSchema,
  })).optional(),
  error: z.string().optional(),
});

const moonpayTransactionsSchema = z.object({
  transactions: z.array(z.object({
    provider: z.literal("moonpay").optional(),
    mode: z.enum(["buy", "sell", "virtual-onramp", "virtual-offramp"]),
    id: z.string(),
    status: z.string().optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
    baseCurrencyCode: z.string().optional(),
    quoteCurrencyCode: z.string().optional(),
    baseCurrencyAmount: z.number().optional(),
    quoteCurrencyAmount: z.number().optional(),
    externalTransactionId: z.string().optional(),
    raw: moonpayRawSchema,
  })).optional(),
  error: z.string().optional(),
});

const moonpayCustomerLimitsSchema = z.object({
  limits: z.array(z.object({
    provider: z.literal("moonpay").optional(),
    customerId: z.string(),
    externalCustomerId: z.string().optional(),
    raw: moonpayRawSchema,
  })).optional(),
  error: z.string().optional(),
});

const moonpayVirtualAccountsSchema = z.object({
  accounts: z.array(z.object({
    provider: z.literal("moonpay").optional(),
    id: z.string(),
    status: z.string().optional(),
    externalCustomerId: z.string().optional(),
    walletAddress: z.string().optional(),
    raw: moonpayRawSchema,
  })).optional(),
  error: z.string().optional(),
});

const moonpayVirtualAccountTransactionsSchema = z.object({
  provider: z.literal("moonpay").optional(),
  mode: z.enum(["onramp", "offramp"]).optional(),
  nextCursor: z.string().optional(),
  transactions: z.array(z.object({
    provider: z.literal("moonpay").optional(),
    mode: z.enum(["buy", "sell", "virtual-onramp", "virtual-offramp"]),
    id: z.string(),
    status: z.string().optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
    baseCurrencyCode: z.string().optional(),
    quoteCurrencyCode: z.string().optional(),
    baseCurrencyAmount: z.number().optional(),
    quoteCurrencyAmount: z.number().optional(),
    externalTransactionId: z.string().optional(),
    raw: moonpayRawSchema,
  })).optional(),
  raw: moonpayRawSchema.optional(),
  error: z.string().optional(),
});

const moonpayWebhookVerificationSchema = z.object({
  provider: z.literal("moonpay").optional(),
  valid: z.boolean().optional(),
  timestamp: z.number().optional(),
  expectedSignature: z.string().optional(),
  receivedSignature: z.string().optional(),
  reason: z.string().optional(),
  error: z.string().optional(),
});

function getMoonPayProvider(execContext: MastraExecutionContext) {
  const ctx = getGordonContext(execContext);
  const provider = ctx?.agentRails?.activeWalletProvider;
  if (!provider || provider.id !== "moonpay") {
    return { ctx, error: { error: "MoonPay is not configured as the active wallet provider." } };
  }
  return { ctx, provider };
}

export const moonpayFundingLinkTool = createTool({
  id: "moonpay_funding_link",
  description:
    "Create a Gordon-native MoonPay funding or sell link. " +
    "Use when the user wants to fund a wallet, buy crypto with fiat, or off-ramp to cash.",
  inputSchema: z.object({
    mode: z.enum(["buy", "sell"]).default("buy"),
    baseCurrencyCode: z.string().describe("Fiat currency code, e.g. usd."),
    quoteCurrencyCode: z.string().describe("Crypto currency code, e.g. btc or sol."),
    walletAddress: z.string().optional(),
    lockAmount: z.number().positive().optional(),
    baseCurrencyAmount: z.number().positive().optional(),
    quoteCurrencyAmount: z.number().positive().optional(),
    redirectUrl: z.string().url().optional(),
    network: z.string().optional(),
    email: z.string().email().optional(),
    externalCustomerId: z.string().optional(),
    theme: z.enum(["light", "dark"]).optional(),
  }),
  outputSchema: moonpayLinkSchema,
  execute: async (input, execContext: MastraExecutionContext) => {
    const active = getMoonPayProvider(execContext);
    if ("error" in active) {
      return active.error;
    }
    const { ctx, provider } = active;

    const result = input.mode === "sell"
      ? provider.buildSellLink(input)
      : provider.buildOnRampLink(input);

    getAuditLogger(ctx?.userId || "system").success("MOONPAY_LINK_CREATED", {
      mode: result.mode,
      baseCurrencyCode: input.baseCurrencyCode,
      quoteCurrencyCode: input.quoteCurrencyCode,
      network: input.network,
    });

    return result;
  },
});

export const moonpaySwapLinkTool = createTool({
  id: "moonpay_swap_link",
  description:
    "Create a Gordon-native MoonPay swap link. " +
    "Use when the user wants a hosted swap flow between two assets.",
  inputSchema: z.object({
    fromCurrencyCode: z.string(),
    toCurrencyCode: z.string(),
    amount: z.number().positive().optional(),
    amountCurrencyCode: z.string().optional(),
    walletAddress: z.string().optional(),
    redirectUrl: z.string().url().optional(),
    email: z.string().email().optional(),
    externalCustomerId: z.string().optional(),
    theme: z.enum(["light", "dark"]).optional(),
  }),
  outputSchema: moonpayLinkSchema,
  execute: async ({ fromCurrencyCode, toCurrencyCode, amount, amountCurrencyCode, walletAddress, redirectUrl, email, externalCustomerId, theme }, execContext: MastraExecutionContext) => {
    const active = getMoonPayProvider(execContext);
    if ("error" in active) {
      return active.error;
    }
    const { ctx, provider } = active;

    const result = provider.buildSwapLink({
      fromCurrencyCode,
      toCurrencyCode,
      amount,
      amountCurrencyCode,
      walletAddress,
      redirectUrl,
      email,
      externalCustomerId,
      theme,
    });
    getAuditLogger(ctx?.userId || "system").success("MOONPAY_LINK_CREATED", {
      mode: "swap",
      fromCurrencyCode,
      toCurrencyCode,
      amount,
    });
    return result;
  },
});

export const moonpayCurrencyLimitsTool = createTool({
  id: "moonpay_currency_limits",
  description:
    "Read MoonPay min/max limits for a currency and payment method. " +
    "Use before building MoonPay buy or sell flows so the agent can keep requested amounts in-range.",
  inputSchema: z.object({
    currencyCode: z.string().describe("MoonPay crypto currency code, e.g. btc or sol."),
    paymentMethod: z.string().optional().describe("Optional MoonPay payment method identifier, e.g. credit_debit_card."),
  }),
  outputSchema: moonpayLimitsSchema,
  execute: async ({ currencyCode, paymentMethod }, execContext: MastraExecutionContext) => {
    const active = getMoonPayProvider(execContext);
    if ("error" in active) {
      return active.error;
    }
    const { ctx, provider } = active;

    const startedAt = Date.now();
    try {
      const result = await provider.getCurrencyLimits(currencyCode, paymentMethod);
      recordApiCall("moonpay.getCurrencyLimits", Date.now() - startedAt);
      getAuditLogger(ctx?.userId || "system").success("MOONPAY_QUOTE_READ", {
        action: "currency_limits",
        currencyCode,
        paymentMethod,
      });
      return result;
    } catch (error) {
      getAuditLogger(ctx?.userId || "system").failure(
        "MOONPAY_QUOTE_READ",
        { action: "currency_limits", currencyCode, paymentMethod },
        error instanceof Error ? error.message : String(error),
      );
      return { error: error instanceof Error ? error.message : String(error) };
    }
  },
});

export const moonpayQuoteTool = createTool({
  id: "moonpay_quote",
  description:
    "Fetch MoonPay buy, sell, or swap quotes through the native MoonPay provider. " +
    "Use when the user wants live fiat/crypto pricing or swap estimates rather than just a hosted widget link.",
  inputSchema: z.object({
    mode: z.enum(["buy", "sell", "swap"]).default("buy"),
    currencyCode: z.string().optional().describe("Required for buy/sell quotes."),
    baseCurrencyAmount: z.number().positive().optional(),
    quoteCurrencyAmount: z.number().positive().optional(),
    baseCurrencyCode: z.string().optional(),
    paymentMethod: z.string().optional(),
    areFeesIncluded: z.boolean().optional(),
    extraFeePercentage: z.number().min(0).max(100).optional(),
    pair: z.string().optional().describe("Optional MoonPay swap pair, e.g. eth_usdc."),
    fromCurrencyCode: z.string().optional(),
    toCurrencyCode: z.string().optional(),
    amount: z.number().positive().optional(),
    amountCurrencyCode: z.string().optional(),
    externalCustomerId: z.string().optional(),
  }),
  outputSchema: moonpayQuoteSchema,
  execute: async (input, execContext: MastraExecutionContext) => {
    const active = getMoonPayProvider(execContext);
    if ("error" in active) {
      return active.error;
    }
    const { ctx, provider } = active;

    if (input.mode !== "swap" && !input.currencyCode) {
      return { error: "currencyCode is required for MoonPay buy and sell quotes." };
    }
    if (input.mode === "swap" && !input.pair && !(input.fromCurrencyCode && input.toCurrencyCode)) {
      return { error: "MoonPay swap quotes require a pair or both fromCurrencyCode and toCurrencyCode." };
    }

    const startedAt = Date.now();
    try {
      const result = input.mode === "swap"
        ? await provider.getSwapQuote({
          pair: input.pair,
          fromCurrencyCode: input.fromCurrencyCode,
          toCurrencyCode: input.toCurrencyCode,
          amount: input.amount,
          amountCurrencyCode: input.amountCurrencyCode,
          externalCustomerId: input.externalCustomerId,
        })
        : await provider.getQuote({
          mode: input.mode,
          currencyCode: input.currencyCode!,
          baseCurrencyAmount: input.baseCurrencyAmount,
          quoteCurrencyAmount: input.quoteCurrencyAmount,
          baseCurrencyCode: input.baseCurrencyCode,
          paymentMethod: input.paymentMethod,
          areFeesIncluded: input.areFeesIncluded,
          extraFeePercentage: input.extraFeePercentage,
        });

      recordApiCall("moonpay.getQuote", Date.now() - startedAt);
      getAuditLogger(ctx?.userId || "system").success("MOONPAY_QUOTE_READ", {
        action: "quote",
        mode: input.mode,
        currencyCode: input.currencyCode,
        pair: input.pair,
      });
      return result;
    } catch (error) {
      getAuditLogger(ctx?.userId || "system").failure(
        "MOONPAY_QUOTE_READ",
        { action: "quote", mode: input.mode, currencyCode: input.currencyCode, pair: input.pair },
        error instanceof Error ? error.message : String(error),
      );
      return { error: error instanceof Error ? error.message : String(error) };
    }
  },
});

export const moonpaySwapPairsTool = createTool({
  id: "moonpay_swap_pairs",
  description:
    "List MoonPay swap pairs from the native MoonPay API. " +
    "Use when the user wants to discover whether MoonPay supports a specific swap pair before quoting or routing.",
  inputSchema: z.object({}),
  outputSchema: moonpaySwapPairsSchema,
  execute: async (_input, execContext: MastraExecutionContext) => {
    const active = getMoonPayProvider(execContext);
    if ("error" in active) {
      return active.error;
    }
    const { ctx, provider } = active;

    const startedAt = Date.now();
    try {
      const pairs = await provider.getSwapPairs();
      recordApiCall("moonpay.getSwapPairs", Date.now() - startedAt);
      getAuditLogger(ctx?.userId || "system").success("MOONPAY_QUOTE_READ", { action: "swap_pairs" });
      return { pairs };
    } catch (error) {
      getAuditLogger(ctx?.userId || "system").failure(
        "MOONPAY_QUOTE_READ",
        { action: "swap_pairs" },
        error instanceof Error ? error.message : String(error),
      );
      return { error: error instanceof Error ? error.message : String(error) };
    }
  },
});

export const moonpayTransactionsTool = createTool({
  id: "moonpay_transactions",
  description:
    "Inspect MoonPay buy or sell transactions using the native MoonPay API. " +
    "Use when the user wants transaction history, a specific MoonPay transaction, or an external-id lookup.",
  inputSchema: z.object({
    mode: z.enum(["buy", "sell"]).default("buy"),
    transactionId: z.string().optional(),
    externalTransactionId: z.string().optional(),
    customerId: z.string().optional(),
    limit: z.number().int().min(1).max(100).optional(),
  }),
  outputSchema: moonpayTransactionsSchema,
  execute: async (input, execContext: MastraExecutionContext) => {
    const active = getMoonPayProvider(execContext);
    if ("error" in active) {
      return active.error;
    }
    const { ctx, provider } = active;

    const startedAt = Date.now();
    try {
      const transactions = await provider.getTransactions(input);
      recordApiCall("moonpay.getTransactions", Date.now() - startedAt);
      getAuditLogger(ctx?.userId || "system").success("MOONPAY_TRANSACTION_READ", {
        mode: input.mode,
        transactionId: input.transactionId,
        externalTransactionId: input.externalTransactionId,
        customerId: input.customerId,
      });
      return { transactions };
    } catch (error) {
      getAuditLogger(ctx?.userId || "system").failure(
        "MOONPAY_TRANSACTION_READ",
        {
          mode: input.mode,
          transactionId: input.transactionId,
          externalTransactionId: input.externalTransactionId,
          customerId: input.customerId,
        },
        error instanceof Error ? error.message : String(error),
      );
      return { error: error instanceof Error ? error.message : String(error) };
    }
  },
});

export const moonpayCustomerLimitsTool = createTool({
  id: "moonpay_customer_limits",
  description:
    "Read MoonPay customer limits for a MoonPay customer id or external customer id. " +
    "Use when the user wants to know MoonPay buy/sell eligibility or remaining limits.",
  inputSchema: z.object({
    customerId: z.string().describe("MoonPay customer id or external customer id."),
    externalCustomerId: z.boolean().default(false).describe("Set true when the identifier is your external customer id."),
  }),
  outputSchema: moonpayCustomerLimitsSchema,
  execute: async ({ customerId, externalCustomerId }, execContext: MastraExecutionContext) => {
    const active = getMoonPayProvider(execContext);
    if ("error" in active) {
      return active.error;
    }
    const { ctx, provider } = active;

    const startedAt = Date.now();
    try {
      const limits = await provider.getCustomerLimits(customerId, externalCustomerId);
      recordApiCall("moonpay.getCustomerLimits", Date.now() - startedAt);
      getAuditLogger(ctx?.userId || "system").success("MOONPAY_CUSTOMER_LIMITS_READ", {
        customerId,
        externalCustomerId,
      });
      return { limits };
    } catch (error) {
      getAuditLogger(ctx?.userId || "system").failure(
        "MOONPAY_CUSTOMER_LIMITS_READ",
        { customerId, externalCustomerId },
        error instanceof Error ? error.message : String(error),
      );
      return { error: error instanceof Error ? error.message : String(error) };
    }
  },
});

export const moonpayVirtualAccountsTool = createTool({
  id: "moonpay_virtual_accounts",
  description:
    "Read MoonPay virtual accounts through MoonPay's signed virtual-accounts API. " +
    "Use when the user wants MoonPay virtual account details or account-creation state for a customer.",
  inputSchema: z.object({
    virtualAccountId: z.string().optional(),
    externalCustomerId: z.string().optional(),
    walletAddress: z.string().optional(),
  }),
  outputSchema: moonpayVirtualAccountsSchema,
  execute: async (input, execContext: MastraExecutionContext) => {
    const active = getMoonPayProvider(execContext);
    if ("error" in active) {
      return active.error;
    }
    const { ctx, provider } = active;

    const startedAt = Date.now();
    try {
      const accounts = await provider.getVirtualAccounts(input);
      recordApiCall("moonpay.getVirtualAccounts", Date.now() - startedAt);
      getAuditLogger(ctx?.userId || "system").success("MOONPAY_VIRTUAL_ACCOUNT_READ", {
        action: "accounts",
        virtualAccountId: input.virtualAccountId,
        externalCustomerId: input.externalCustomerId,
        walletAddress: input.walletAddress,
      });
      return { accounts };
    } catch (error) {
      getAuditLogger(ctx?.userId || "system").failure(
        "MOONPAY_VIRTUAL_ACCOUNT_READ",
        {
          action: "accounts",
          virtualAccountId: input.virtualAccountId,
          externalCustomerId: input.externalCustomerId,
          walletAddress: input.walletAddress,
        },
        error instanceof Error ? error.message : String(error),
      );
      return { error: error instanceof Error ? error.message : String(error) };
    }
  },
});

export const moonpayVirtualAccountTransactionsTool = createTool({
  id: "moonpay_virtual_account_transactions",
  description:
    "Read MoonPay virtual-account on-ramp or off-ramp transactions. " +
    "Use when the user wants MoonPay-backed bank transfer activity or a specific virtual-account transaction.",
  inputSchema: z.object({
    mode: z.enum(["onramp", "offramp"]).default("onramp"),
    transactionId: z.string().optional(),
    virtualAccountId: z.string().optional(),
    externalCustomerId: z.string().optional(),
    cursor: z.string().optional(),
    pageSize: z.number().int().min(1).max(100).optional(),
  }),
  outputSchema: moonpayVirtualAccountTransactionsSchema,
  execute: async (input, execContext: MastraExecutionContext) => {
    const active = getMoonPayProvider(execContext);
    if ("error" in active) {
      return active.error;
    }
    const { ctx, provider } = active;

    const startedAt = Date.now();
    try {
      const result = await provider.getVirtualAccountTransactions(input);
      recordApiCall("moonpay.getVirtualAccountTransactions", Date.now() - startedAt);
      getAuditLogger(ctx?.userId || "system").success("MOONPAY_VIRTUAL_ACCOUNT_READ", {
        action: "transactions",
        mode: input.mode,
        transactionId: input.transactionId,
        virtualAccountId: input.virtualAccountId,
        externalCustomerId: input.externalCustomerId,
      });
      return result;
    } catch (error) {
      getAuditLogger(ctx?.userId || "system").failure(
        "MOONPAY_VIRTUAL_ACCOUNT_READ",
        {
          action: "transactions",
          mode: input.mode,
          transactionId: input.transactionId,
          virtualAccountId: input.virtualAccountId,
          externalCustomerId: input.externalCustomerId,
        },
        error instanceof Error ? error.message : String(error),
      );
      return { error: error instanceof Error ? error.message : String(error) };
    }
  },
});

export const moonpayVerifyWebhookTool = createTool({
  id: "moonpay_verify_webhook",
  description:
    "Verify a MoonPay webhook signature with MoonPay's v2 signing format. " +
    "Use when Gordon receives a MoonPay webhook payload and needs to confirm authenticity before acting on it.",
  inputSchema: z.object({
    signatureHeader: z.string().describe("MoonPay-Signature-V2 or X-Signature-V2 header value."),
    payload: z.string().describe("Raw webhook body as a string."),
    method: z.enum(["POST", "GET"]).default("POST").describe("Use POST for webhook bodies or GET when verifying a signed redirect query string."),
    requestPath: z.string().default("").describe("For GET verification, pass the raw query string or request search fragment exactly as MoonPay sent it."),
    maxAgeSeconds: z.number().int().positive().max(3600).optional(),
  }),
  outputSchema: moonpayWebhookVerificationSchema,
  execute: async (input, execContext: MastraExecutionContext) => {
    const active = getMoonPayProvider(execContext);
    if ("error" in active) {
      return active.error;
    }
    const { ctx, provider } = active;

    try {
      const result = provider.verifyWebhookSignature(input);
      const auditLogger = getAuditLogger(ctx?.userId || "system");
      if (result.valid) {
        auditLogger.success("MOONPAY_WEBHOOK_VERIFIED", {
          requestPath: input.requestPath,
          maxAgeSeconds: input.maxAgeSeconds,
        });
      } else {
        auditLogger.failure(
          "MOONPAY_WEBHOOK_VERIFIED",
          { requestPath: input.requestPath, maxAgeSeconds: input.maxAgeSeconds },
          result.reason || "MoonPay webhook verification failed.",
        );
      }
      return result;
    } catch (error) {
      getAuditLogger(ctx?.userId || "system").failure(
        "MOONPAY_WEBHOOK_VERIFIED",
        { requestPath: input.requestPath, maxAgeSeconds: input.maxAgeSeconds },
        error instanceof Error ? error.message : String(error),
      );
      return { error: error instanceof Error ? error.message : String(error) };
    }
  },
});

const polygonPaymentIntentSchema = z.object({
  provider: z.literal("polygon").optional(),
  network: z.string().optional(),
  resource: z.string().optional(),
  recipient: z.string().optional(),
  amountUsd: z.string().optional(),
  currency: z.string().optional(),
  payer: z.string().optional(),
  facilitatorUrl: z.string().optional(),
  description: z.string().optional(),
  nonce: z.string().optional(),
  issuedAt: z.string().optional(),
  expiresAt: z.string().optional(),
  signature: z.string().optional(),
  signatureType: z.literal("eip191").optional(),
  headers: z.record(z.string(), z.string()).optional(),
  signed: z.boolean().optional(),
  approvalRequired: z.boolean().optional(),
  error: z.string().optional(),
});

export const polygonPaymentIntentTool = createTool({
  id: "polygon_payment_intent",
  description:
    "Create or sign a Gordon-native Polygon x402 payment intent for paid APIs and agent-to-agent payments. " +
    "Use when the user wants to prepare payment headers or pay for external services.",
  inputSchema: z.object({
    resource: z.string().describe("Resource or URL being paid for."),
    amountUsd: z.string().describe("Payment amount in USD terms, e.g. 0.10"),
    currency: z.string().default("USDC"),
    recipient: z.string().optional(),
    description: z.string().optional(),
    expiresInMinutes: z.number().int().positive().max(1440).optional(),
    approveSigning: z.boolean().default(false).describe("Whether to sign the payment intent. Requires permissionMode not 'strict' when approvals are required."),
  }),
  outputSchema: polygonPaymentIntentSchema,
  execute: async ({ approveSigning, ...input }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    const provider = ctx?.agentRails?.activePaymentProvider;
    if (!provider || provider.id !== "polygon") {
      return { error: "Polygon x402 is not configured as the active payment provider." };
    }

    try {
      const intent = await provider.createPaymentIntent(input);
      const approvalRequired = ctx?.config.agentRails.requireApprovalForExternalActions ?? true;
      const maySign = approveSigning && (!approvalRequired || isArmed(ctx!));

      if (approveSigning && approvalRequired && !isArmed(ctx!)) {
        getAuditLogger(ctx?.userId || "system").blocked(
          "POLYGON_PAYMENT_INTENT_SIGNED",
          { resource: input.resource, amountUsd: input.amountUsd },
          "permissionMode must not be 'strict' before signing external payment intents.",
        );
        return {
          ...intent,
          signed: false,
          approvalRequired: true,
          error: "permissionMode must not be 'strict' before signing external payment intents.",
        };
      }

      const signedIntent = maySign ? await provider.signPaymentIntent(intent) : intent;
      const headers = provider.buildPaymentHeaders(signedIntent);
      const signed = "signature" in signedIntent;

      getAuditLogger(ctx?.userId || "system").record(
        signed ? "POLYGON_PAYMENT_INTENT_SIGNED" : "POLYGON_PAYMENT_INTENT_CREATED",
        { resource: input.resource, amountUsd: input.amountUsd, approveSigning },
        signed ? "SUCCESS" : "PENDING",
      );

      return {
        ...signedIntent,
        headers: headers.headers,
        signed,
        approvalRequired,
      };
    } catch (error) {
      getAuditLogger(ctx?.userId || "system").failure(
        "POLYGON_PAYMENT_INTENT_CREATED",
        { resource: input.resource, amountUsd: input.amountUsd },
        error instanceof Error ? error.message : String(error),
      );
      return { error: error instanceof Error ? error.message : String(error) };
    }
  },
});

export const agentRailsTools = {
  get_agent_rails_status: getAgentRailsStatusTool,
  helius_wallet_overview: heliusWalletOverviewTool,
  helius_recent_transactions: heliusRecentTransactionsTool,
  helius_token_metadata: heliusTokenMetadataTool,
  moonpay_funding_link: moonpayFundingLinkTool,
  moonpay_swap_link: moonpaySwapLinkTool,
  moonpay_currency_limits: moonpayCurrencyLimitsTool,
  moonpay_quote: moonpayQuoteTool,
  moonpay_swap_pairs: moonpaySwapPairsTool,
  moonpay_transactions: moonpayTransactionsTool,
  moonpay_customer_limits: moonpayCustomerLimitsTool,
  moonpay_virtual_accounts: moonpayVirtualAccountsTool,
  moonpay_virtual_account_transactions: moonpayVirtualAccountTransactionsTool,
  moonpay_verify_webhook: moonpayVerifyWebhookTool,
  polygon_payment_intent: polygonPaymentIntentTool,
};
