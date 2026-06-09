/**
 * Zerion wallet-intelligence source — fungible positions + portfolio total.
 *
 * Zerion REST API (https://api.zerion.io/v1). Auth is HTTP Basic with the API
 * key as the username and an empty password:
 *   Authorization: Basic base64("<ZERION_API_KEY>:")
 *
 * Implements only `balances` + `portfolio` — Zerion also exposes transactions,
 * but those map to a different normalization the manager routes elsewhere.
 */

import type {
  WalletIntelSource,
  WalletIntelCapabilities,
  AddressQuery,
  TokenBalance,
  Portfolio,
} from "./types.ts";
import { createModuleLogger } from "../../logger/index.ts";

const logger = createModuleLogger("zerion");

const BASE = "https://api.zerion.io/v1";
const TIMEOUT_MS = 10_000;

// Zerion chain ids → the chain slugs the rest of Gordon uses.
const EVM_CHAINS = [
  "ethereum",
  "base",
  "arbitrum",
  "optimism",
  "polygon",
  "bsc",
  "avalanche",
];

interface PositionAttributes {
  fungible_info?: {
    symbol?: string;
    name?: string;
    implementations?: Array<{
      address?: string | null;
      chain_id?: string;
      decimals?: number;
    }>;
  };
  quantity?: { float?: number };
  value?: number | null;
  price?: number | null;
}

interface PositionItem {
  attributes?: PositionAttributes;
  relationships?: { chain?: { data?: { id?: string } } };
}

export class ZerionWalletSource implements WalletIntelSource {
  readonly id = "zerion";
  readonly name = "Zerion";
  readonly priority = 34;
  readonly requiresAuth = true;

  private get key(): string | undefined {
    return process.env.ZERION_API_KEY;
  }

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
      chains: EVM_CHAINS,
    };
  }

  private authHeader(): string {
    return "Basic " + Buffer.from(`${this.key ?? ""}:`).toString("base64");
  }

  private async fetchJson(path: string): Promise<unknown | null> {
    if (!this.key) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${BASE}${path}`, {
        headers: { Authorization: this.authHeader(), accept: "application/json" },
        signal: controller.signal,
      });
      if (!res.ok) {
        logger.warn("zerion request failed", { path, status: res.status });
        return null;
      }
      return await res.json();
    } catch (err) {
      logger.warn("zerion request errored", { path, error: String(err) });
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private mapPosition(item: PositionItem): TokenBalance | null {
    const attr = item.attributes;
    const fung = attr?.fungible_info;
    if (!fung?.symbol) return null;
    const chain = item.relationships?.chain?.data?.id ?? "ethereum";
    const impl =
      fung.implementations?.find((i) => i.chain_id === chain) ??
      fung.implementations?.[0];
    return {
      tokenAddress: impl?.address ?? "",
      symbol: fung.symbol,
      name: fung.name,
      decimals: impl?.decimals,
      amount: attr?.quantity?.float ?? 0,
      priceUsd: attr?.price ?? undefined,
      valueUsd: attr?.value ?? undefined,
      chain,
    };
  }

  async getTokenBalances(query: AddressQuery): Promise<TokenBalance[]> {
    const json = await this.fetchJson(
      `/wallets/${query.address}/positions/?filter[positions]=only_simple&currency=usd`,
    );
    const data = (json as { data?: PositionItem[] } | null)?.data;
    if (!Array.isArray(data)) return [];
    const out: TokenBalance[] = [];
    for (const item of data) {
      const bal = this.mapPosition(item);
      if (bal) out.push(bal);
    }
    return out;
  }

  async getPortfolio(query: AddressQuery): Promise<Portfolio | null> {
    const positions = await this.getTokenBalances(query);

    let totalValueUsd: number | undefined;
    const portfolioJson = await this.fetchJson(
      `/wallets/${query.address}/portfolio?currency=usd`,
    );
    const total = (
      portfolioJson as
        | { data?: { attributes?: { total?: { positions?: number } } } }
        | null
    )?.data?.attributes?.total?.positions;
    if (typeof total === "number") totalValueUsd = total;

    if (totalValueUsd === undefined && positions.length === 0) return null;

    if (totalValueUsd === undefined) {
      totalValueUsd = positions.reduce((sum, p) => sum + (p.valueUsd ?? 0), 0);
    }

    const chains = [...new Set(positions.map((p) => p.chain))];
    return { address: query.address, totalValueUsd, positions, chains };
  }
}
