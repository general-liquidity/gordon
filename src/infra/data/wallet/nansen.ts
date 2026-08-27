/**
 * Nansen — premium smart-money / address-intelligence provider.
 *
 * Highest-signal wallet-intel source (priority 28). Implements two capabilities:
 *   - labels        → /api/v1/profiler/address/labels
 *   - smartMoneyFlow → /api/v1/smart-money/netflow
 *
 * Verified from https://docs.nansen.ai/ (2026-06): base URL
 * `https://api.nansen.ai/api/v1`, auth header `apikey: <key>`, all requests POST
 * with a JSON body. The labels endpoint returns NON-premium labels only; premium
 * (smart_money / alpha_trader) labels live behind a separate gated endpoint —
 * isSmartMoney is inferred here from the category field when present, but is
 * unverified-pending-key for the premium surface.
 */

import type {
  WalletIntelSource,
  WalletIntelCapabilities,
  AddressQuery,
  SmartMoneyQuery,
  AddressLabel,
  SmartMoneyFlowItem,
} from "./types.ts";
import { createModuleLogger } from "../../logger/index.ts";

const logger = createModuleLogger("nansen");

const BASE_URL = "https://api.nansen.ai/api/v1";
const TIMEOUT_MS = 10_000;

/** Nansen chain identifiers (docs /reference/chains). */
const CHAINS = [
  "ethereum",
  "base",
  "arbitrum",
  "optimism",
  "polygon",
  "bnb",
  "avalanche",
  "solana",
];

const CHAIN_ALIASES: Record<string, string> = {
  eth: "ethereum",
  mainnet: "ethereum",
  bsc: "bnb",
  binance: "bnb",
  avax: "avalanche",
  matic: "polygon",
  sol: "solana",
};

function mapChain(chain?: string): string {
  if (!chain) return "ethereum";
  const c = chain.toLowerCase();
  return CHAIN_ALIASES[c] ?? c;
}

interface NansenLabel {
  label?: string;
  category?: string;
}

interface NansenNetflowRow {
  token_address?: string;
  token_symbol?: string;
  chain?: string;
  net_flow_1h_usd?: number;
  net_flow_24h_usd?: number;
  net_flow_7d_usd?: number;
  net_flow_30d_usd?: number;
  trader_count?: number;
}

export class NansenWalletSource implements WalletIntelSource {
  readonly id = "nansen";
  readonly name = "Nansen";
  readonly priority = 28;
  readonly requiresAuth = true;

  private get apiKey(): string | undefined {
    return process.env.NANSEN_API_KEY;
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey);
  }

  getCapabilities(): WalletIntelCapabilities {
    return {
      balances: false,
      portfolio: false,
      transactions: false,
      tokenHolders: false,
      labels: true,
      smartMoneyFlow: true,
      chains: CHAINS,
    };
  }

  private async post<T>(path: string, body: unknown): Promise<T | null> {
    const key = this.apiKey;
    if (!key) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${BASE_URL}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: key },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        logger.warn("Nansen request failed", { path, status: res.status });
        return null;
      }
      return (await res.json()) as T;
    } catch (err) {
      logger.warn("Nansen request error", {
        path,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async getAddressLabels(query: AddressQuery): Promise<AddressLabel | null> {
    const chain = mapChain(query.chains?.[0] ?? query.chain);
    const json = await this.post<{ data?: NansenLabel[] }>("/profiler/address/labels", {
      address: query.address,
      chain,
      pagination: { page: 1, per_page: 100 },
    });
    if (!json) return null;

    const rows = Array.isArray(json.data) ? json.data : [];
    const labels: string[] = [];
    const categories = new Set<string>();
    let entity: string | undefined;

    for (const row of rows) {
      if (typeof row.label === "string" && row.label.length > 0) {
        labels.push(row.label);
        if (!entity) entity = row.label;
      }
      if (typeof row.category === "string") categories.add(row.category.toLowerCase());
    }

    if (labels.length === 0) return null;

    return {
      address: query.address,
      labels,
      entity,
      isSmartMoney: categories.has("smart_money"),
      isExchange: categories.has("cefi"),
      isContract: categories.has("contract") || categories.has("defi"),
    };
  }

  async getSmartMoneyFlow(query: SmartMoneyQuery): Promise<SmartMoneyFlowItem[]> {
    const chain = mapChain(query.chain);
    const json = await this.post<{ data?: NansenNetflowRow[] }>("/smart-money/netflow", {
      chains: [chain],
      order_by: [{ field: "net_flow_24h_usd", direction: "DESC" }],
      pagination: { page: 1, per_page: query.limit ?? 50 },
    });
    if (!json) return [];

    const rows = Array.isArray(json.data) ? json.data : [];
    const items: SmartMoneyFlowItem[] = [];

    for (const row of rows) {
      if (!row.token_address) continue;
      if (
        query.tokenAddress &&
        row.token_address.toLowerCase() !== query.tokenAddress.toLowerCase()
      ) {
        continue;
      }
      const netFlowUsd = typeof row.net_flow_24h_usd === "number" ? row.net_flow_24h_usd : 0;
      items.push({
        tokenAddress: row.token_address,
        symbol: row.token_symbol,
        chain: row.chain ?? chain,
        netFlowUsd,
        window: "24h",
      });
    }

    return items;
  }
}
