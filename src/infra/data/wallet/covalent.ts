/**
 * Covalent / GoldRush wallet-intelligence source.
 *
 * Foundational API over the unified v1 endpoint. Implements balances,
 * transactions, and token-holders; portfolio/labels/smart-money are out of
 * scope for this source. Every op resolves gracefully ([] on error/timeout/
 * empty) so the manager can fall through.
 */
import type {
  WalletIntelSource,
  WalletIntelCapabilities,
  AddressQuery,
  TxQuery,
  TokenQuery,
  TokenBalance,
  WalletTx,
  TokenHolder,
} from "./types.ts";
import { createModuleLogger } from "../../logger/index.ts";

const logger = createModuleLogger("covalent");

const BASE = "https://api.covalenthq.com/v1";
const TIMEOUT_MS = 10_000;

/** Gordon chain name → Covalent chainName slug. Unknown → undefined. */
const CHAIN_SLUGS: Record<string, string> = {
  ethereum: "eth-mainnet",
  base: "base-mainnet",
  polygon: "matic-mainnet",
  arbitrum: "arbitrum-mainnet",
  optimism: "optimism-mainnet",
  bsc: "bsc-mainnet",
  avalanche: "avalanche-mainnet",
};

function slug(chain?: string): string | undefined {
  if (!chain) return undefined;
  return CHAIN_SLUGS[chain.toLowerCase()];
}

function apiKey(): string | undefined {
  return process.env.GOLDRUSH_API_KEY || process.env.COVALENT_API_KEY;
}

export class CovalentWalletSource implements WalletIntelSource {
  readonly id = "covalent";
  readonly name = "Covalent (GoldRush)";
  readonly priority = 30;
  readonly requiresAuth = true;

  async isAvailable(): Promise<boolean> {
    return Boolean(apiKey());
  }

  getCapabilities(): WalletIntelCapabilities {
    return {
      balances: true,
      portfolio: false,
      transactions: true,
      tokenHolders: true,
      labels: false,
      smartMoneyFlow: false,
      chains: Object.keys(CHAIN_SLUGS),
    };
  }

  private async fetchJson(path: string): Promise<any | null> {
    const key = apiKey();
    if (!key) return null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${BASE}${path}`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: ctrl.signal,
      });
      if (!res.ok) {
        logger.warn(`HTTP ${res.status} for ${path}`);
        return null;
      }
      const json: any = await res.json();
      if (json?.error) {
        logger.warn(`API error for ${path}: ${json.error_message ?? "unknown"}`);
        return null;
      }
      return json;
    } catch (err) {
      logger.warn(`request failed for ${path}: ${(err as Error).message}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async getTokenBalances(query: AddressQuery): Promise<TokenBalance[]> {
    const chain = query.chains?.[0] ?? query.chain;
    const cn = slug(chain);
    if (!cn) {
      logger.warn(`unsupported chain: ${chain}`);
      return [];
    }
    const json = await this.fetchJson(
      `/${cn}/address/${query.address}/balances_v2/`,
    );
    const items: any[] = json?.data?.items ?? [];
    return items.map((it) => {
      const decimals = Number(it.contract_decimals ?? 0);
      const raw = Number(it.balance ?? 0);
      return {
        tokenAddress: it.contract_address,
        symbol: it.contract_ticker_symbol ?? "",
        name: it.contract_name ?? undefined,
        decimals,
        amount: decimals > 0 ? raw / 10 ** decimals : raw,
        priceUsd: it.quote_rate ?? undefined,
        valueUsd: it.quote ?? undefined,
        chain: chain!,
      } satisfies TokenBalance;
    });
  }

  async getTransactions(query: TxQuery): Promise<WalletTx[]> {
    const cn = slug(query.chain);
    if (!cn) {
      logger.warn(`unsupported chain: ${query.chain}`);
      return [];
    }
    const json = await this.fetchJson(
      `/${cn}/address/${query.address}/transactions_v3/`,
    );
    const items: any[] = json?.data?.items ?? [];
    const addr = query.address.toLowerCase();
    let txs: WalletTx[] = items.map((it) => {
      const from = it.from_address ?? "";
      return {
        hash: it.tx_hash,
        chain: query.chain!,
        timestamp: Date.parse(it.block_signed_at),
        from,
        to: it.to_address ?? "",
        valueUsd: it.value_quote ?? undefined,
        direction:
          from.toLowerCase() === addr
            ? ("out" as const)
            : ("in" as const),
      } satisfies WalletTx;
    });
    if (query.sinceMs != null) {
      txs = txs.filter((t) => !Number.isNaN(t.timestamp) && t.timestamp >= query.sinceMs!);
    }
    if (query.limit != null) txs = txs.slice(0, query.limit);
    return txs;
  }

  async getTokenHolders(query: TokenQuery): Promise<TokenHolder[]> {
    const cn = slug(query.chain);
    if (!cn) {
      logger.warn(`unsupported chain: ${query.chain}`);
      return [];
    }
    const params = query.limit != null ? `?page-size=${query.limit}` : "";
    const json = await this.fetchJson(
      `/${cn}/tokens/${query.tokenAddress}/token_holders_v2/${params}`,
    );
    const items: any[] = json?.data?.items ?? [];
    let holders: TokenHolder[] = items.map((it) => {
      const decimals = Number(it.contract_decimals ?? 0);
      const raw = Number(it.balance ?? 0);
      const supply = Number(it.total_supply ?? 0);
      return {
        address: it.address,
        amount: decimals > 0 ? raw / 10 ** decimals : raw,
        pct: supply > 0 ? (raw / supply) * 100 : undefined,
      } satisfies TokenHolder;
    });
    if (query.limit != null) holders = holders.slice(0, query.limit);
    return holders;
  }
}
