/**
 * Moralis wallet/address-intelligence source.
 *
 * EVM-only (Solana lives behind a separate Moralis API surface — declared
 * honestly via getCapabilities().chains). Wraps three Web3 Data API wallet
 * endpoints: token balances w/ prices, net-worth, and history.
 * Base: https://deep-index.moralis.io/api/v2.2  Auth: X-API-Key header.
 */
import type {
  WalletIntelSource,
  WalletIntelCapabilities,
  AddressQuery,
  TxQuery,
  TokenBalance,
  Portfolio,
  WalletTx,
} from "./types.ts";
import { createModuleLogger } from "../../logger/index.ts";

const logger = createModuleLogger("moralis");

const BASE = "https://deep-index.moralis.io/api/v2.2";
const TIMEOUT_MS = 10_000;

/** Map an AddressQuery.chain to a Moralis chain name; unknown → null. */
const CHAIN_MAP: Record<string, string> = {
  eth: "eth",
  ethereum: "eth",
  mainnet: "eth",
  base: "base",
  polygon: "polygon",
  matic: "polygon",
  arbitrum: "arbitrum",
  optimism: "optimism",
  bsc: "bsc",
  bnb: "bsc",
  avalanche: "avalanche",
  avax: "avalanche",
};

function mapChain(chain?: string): string | null {
  if (!chain) return "eth";
  return CHAIN_MAP[chain.toLowerCase()] ?? null;
}

export class MoralisWalletSource implements WalletIntelSource {
  readonly id = "moralis";
  readonly name = "Moralis";
  readonly priority = 32;
  readonly requiresAuth = true;

  private get key(): string | undefined {
    return process.env.MORALIS_API_KEY;
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.key);
  }

  getCapabilities(): WalletIntelCapabilities {
    return {
      balances: true,
      portfolio: true,
      transactions: true,
      tokenHolders: false,
      labels: false,
      smartMoneyFlow: false,
      chains: ["eth", "base", "polygon", "arbitrum", "optimism", "bsc", "avalanche"],
    };
  }

  private async get(path: string, params: Record<string, string | string[]>): Promise<any | null> {
    const key = this.key;
    if (!key) return null;
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (Array.isArray(v)) for (const item of v) qs.append(k, item);
      else qs.set(k, v);
    }
    const url = `${BASE}${path}?${qs.toString()}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { "X-API-Key": key, accept: "application/json" },
        signal: controller.signal,
      });
      if (!res.ok) {
        logger.warn("moralis http error", { path, status: res.status });
        return null;
      }
      return await res.json();
    } catch (err) {
      logger.warn("moralis fetch failed", { path, err: String(err) });
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async getTokenBalances(query: AddressQuery): Promise<TokenBalance[]> {
    const chain = mapChain(query.chain);
    if (!chain) return [];
    const body = await this.get(`/wallets/${query.address}/tokens`, { chain });
    const result = body?.result;
    if (!Array.isArray(result)) return [];
    return result.map((r: any): TokenBalance => {
      const decimals = r.decimals != null ? Number(r.decimals) : undefined;
      let amount = r.balance_formatted != null ? Number(r.balance_formatted) : NaN;
      if (!Number.isFinite(amount) && r.balance != null && decimals != null) {
        amount = Number(r.balance) / 10 ** decimals;
      }
      const priceUsd = r.usd_price != null ? Number(r.usd_price) : undefined;
      const valueUsd = r.usd_value != null ? Number(r.usd_value) : undefined;
      return {
        tokenAddress: r.token_address ?? "",
        symbol: r.symbol ?? "",
        name: r.name ?? undefined,
        decimals,
        amount: Number.isFinite(amount) ? amount : 0,
        priceUsd: Number.isFinite(priceUsd as number) ? priceUsd : undefined,
        valueUsd: Number.isFinite(valueUsd as number) ? valueUsd : undefined,
        chain,
      };
    });
  }

  async getPortfolio(query: AddressQuery): Promise<Portfolio | null> {
    const chains = query.chains?.length
      ? query.chains.map(mapChain).filter((c): c is string => Boolean(c))
      : [mapChain(query.chain)].filter((c): c is string => Boolean(c));
    if (!chains.length) return null;

    const balanceLists = await Promise.all(
      chains.map((chain) => this.getTokenBalances({ address: query.address, chain })),
    );
    const positions = balanceLists.flat();

    const nw = await this.get(`/wallets/${query.address}/net-worth`, { "chains[]": chains });
    let totalValueUsd = nw?.total_networth_usd != null ? Number(nw.total_networth_usd) : NaN;
    if (!Number.isFinite(totalValueUsd)) {
      totalValueUsd = positions.reduce((sum, p) => sum + (p.valueUsd ?? 0), 0);
    }

    return {
      address: query.address,
      totalValueUsd: Number.isFinite(totalValueUsd) ? totalValueUsd : 0,
      positions,
      chains,
    };
  }

  async getTransactions(query: TxQuery): Promise<WalletTx[]> {
    const chain = mapChain(query.chain);
    if (!chain) return [];
    const params: Record<string, string> = { chain };
    if (query.limit != null) params.limit = String(query.limit);
    const body = await this.get(`/wallets/${query.address}/history`, params);
    const result = body?.result;
    if (!Array.isArray(result)) return [];
    const addr = query.address.toLowerCase();
    return result
      .map((r: any): WalletTx => {
        const from = r.from_address ?? "";
        const to = r.to_address ?? "";
        return {
          hash: r.hash ?? "",
          chain,
          timestamp: r.block_timestamp ? Date.parse(r.block_timestamp) : 0,
          from,
          to,
          direction:
            from.toLowerCase() === addr ? "out" : to.toLowerCase() === addr ? "in" : undefined,
          type: r.category ?? r.method_label ?? undefined,
        };
      })
      .filter((tx) => (query.sinceMs != null ? tx.timestamp >= query.sinceMs : true));
  }
}
