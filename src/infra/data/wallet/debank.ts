/**
 * DeBank Cloud (pro-openapi) wallet/address-intelligence source.
 *
 * Portfolio + token-balance reads over major EVM chains. DeBank uses its own
 * short chain ids ("eth", "base", "matic", …); we map AddressQuery chains in
 * and DeBank ids back to canonical names out.
 *
 * Docs: https://docs.cloud.debank.com/en/readme/api-pro-reference/user
 *   GET /v1/user/total_balance?id=<addr>      → { total_usd_value, chain_list }
 *   GET /v1/user/all_token_list?id=<addr>&is_all=false → [{ id, chain, symbol, … }]
 * Auth header: "AccessKey: <DEBANK_ACCESS_KEY>".
 */
import type {
  WalletIntelSource,
  WalletIntelCapabilities,
  AddressQuery,
  TokenBalance,
  Portfolio,
} from "./types.ts";
import { createModuleLogger } from "../../logger/index.ts";

const logger = createModuleLogger("debank");

const BASE_URL = "https://pro-openapi.debank.com/v1";
const TIMEOUT_MS = 10_000;

/** Canonical chain name → DeBank chain id. */
const CANONICAL_TO_DEBANK: Record<string, string> = {
  ethereum: "eth",
  eth: "eth",
  base: "base",
  polygon: "matic",
  matic: "matic",
  arbitrum: "arb",
  arb: "arb",
  optimism: "op",
  op: "op",
  bsc: "bsc",
  bnb: "bsc",
  avalanche: "avax",
  avax: "avax",
};

/** DeBank chain id → canonical chain name (results). */
const DEBANK_TO_CANONICAL: Record<string, string> = {
  eth: "ethereum",
  base: "base",
  matic: "polygon",
  arb: "arbitrum",
  op: "optimism",
  bsc: "bsc",
  avax: "avalanche",
};

interface DeBankChain {
  id: string;
  usd_value: number;
}
interface DeBankTotalBalance {
  total_usd_value: number;
  chain_list: DeBankChain[];
}
interface DeBankToken {
  id: string;
  chain: string;
  symbol: string;
  name?: string;
  decimals?: number;
  amount: number;
  price?: number;
}

export class DeBankWalletSource implements WalletIntelSource {
  readonly id = "debank";
  readonly name = "DeBank";
  readonly priority = 36;
  readonly requiresAuth = true;

  private readonly key = process.env.DEBANK_ACCESS_KEY;

  async isAvailable(): Promise<boolean> {
    return Boolean(this.key);
  }

  getCapabilities(): WalletIntelCapabilities {
    return {
      balances: true,
      portfolio: true,
      transactions: false,
      tokenHolders: false,
      labels: false,
      smartMoneyFlow: false,
      chains: ["ethereum", "base", "polygon", "arbitrum", "optimism", "bsc", "avalanche"],
    };
  }

  /** Resolve the DeBank chain ids to scope a query to (undefined = all). */
  private scopedDebankChains(query: AddressQuery): string[] | undefined {
    const requested = query.chains ?? (query.chain ? [query.chain] : undefined);
    if (!requested || requested.length === 0) return undefined;
    return requested
      .map((c) => CANONICAL_TO_DEBANK[c.toLowerCase()])
      .filter((c): c is string => Boolean(c));
  }

  private async fetchJson<T>(path: string): Promise<T | null> {
    if (!this.key) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${BASE_URL}${path}`, {
        headers: { AccessKey: this.key, Accept: "application/json" },
        signal: controller.signal,
      });
      if (!res.ok) {
        logger.warn(`DeBank ${path} → HTTP ${res.status}`);
        return null;
      }
      return (await res.json()) as T;
    } catch (err) {
      logger.warn(`DeBank ${path} failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async getPortfolio(query: AddressQuery): Promise<Portfolio | null> {
    const data = await this.fetchJson<DeBankTotalBalance>(
      `/user/total_balance?id=${encodeURIComponent(query.address)}`,
    );
    if (!data) return null;

    const scoped = this.scopedDebankChains(query);
    const positions = await this.getTokenBalances(query);
    const chains = (data.chain_list ?? [])
      .filter((c) => !scoped || scoped.includes(c.id))
      .map((c) => DEBANK_TO_CANONICAL[c.id] ?? c.id);

    return {
      address: query.address,
      totalValueUsd: data.total_usd_value ?? 0,
      positions,
      chains,
    };
  }

  async getTokenBalances(query: AddressQuery): Promise<TokenBalance[]> {
    const scoped = this.scopedDebankChains(query);
    let path = `/user/all_token_list?id=${encodeURIComponent(query.address)}&is_all=false`;
    if (scoped && scoped.length > 0) path += `&chain_ids=${scoped.join(",")}`;

    const tokens = await this.fetchJson<DeBankToken[]>(path);
    if (!tokens || !Array.isArray(tokens)) return [];

    return tokens
      .filter((t) => !scoped || scoped.includes(t.chain))
      .map((t) => {
        const amount = t.amount ?? 0;
        const priceUsd = t.price;
        return {
          tokenAddress: t.id,
          symbol: t.symbol,
          name: t.name,
          decimals: t.decimals,
          amount,
          priceUsd,
          valueUsd: priceUsd != null ? amount * priceUsd : undefined,
          chain: DEBANK_TO_CANONICAL[t.chain] ?? t.chain,
        };
      });
  }
}
