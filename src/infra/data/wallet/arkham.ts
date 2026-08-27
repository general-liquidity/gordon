/**
 * Arkham Intelligence — wallet/address-intelligence source.
 *
 * Deanonymizes addresses (entity attribution, labels, exchange/contract flags)
 * and exposes token holdings. Labels + balances only; tx-flow / holders /
 * smart-money-flow are separate Arkham surfaces not wired here.
 *
 * Docs: https://docs.intel.arkm.com / https://codex.arkm.com/arkham-api
 *   base URL  https://api.arkm.com
 *   auth      header `API-Key: <key>`  (verified from public docs)
 *   labels    GET /intelligence/address/{address}?chain=<id>
 *   balances  GET /portfolio/address/{address}?time=<unix-ms>
 *
 * The portfolio endpoint requires a `time` (unix-ms) param and returns a
 * `{chain: {tokenId: entry}}` map; the entity `type`/`service` flags drive
 * isExchange/isSmartMoney. Response shapes confirmed from public docs but the
 * live API is key-gated — treat field mapping as unverified-pending-key.
 */

import type {
  WalletIntelSource,
  WalletIntelCapabilities,
  AddressQuery,
  TokenBalance,
  AddressLabel,
} from "./types.ts";
import { createModuleLogger } from "../../logger/index.ts";

const logger = createModuleLogger("arkham");

const BASE_URL = "https://api.arkm.com";
const TIMEOUT_MS = 10_000;

const SMART_MONEY_TYPES = new Set(["fund", "market_maker", "smart_money"]);
const EXCHANGE_TYPES = new Set(["exchange", "cex"]);

/** AddressQuery.chain → Arkham chain id. Unknown chains route to balances=[] . */
const CHAIN_MAP: Record<string, string> = {
  ethereum: "ethereum",
  eth: "ethereum",
  bitcoin: "bitcoin",
  btc: "bitcoin",
  solana: "solana",
  sol: "solana",
  base: "base",
  arbitrum: "arbitrum_one",
  arbitrum_one: "arbitrum_one",
  polygon: "polygon",
  matic: "polygon",
  optimism: "optimism",
  avalanche: "avalanche",
  avax: "avalanche",
  bsc: "bsc",
  bnb: "bsc",
};

interface ArkhamEntity {
  id?: string;
  name?: string;
  type?: string;
}

interface ArkhamIntel {
  address?: string;
  arkhamEntity?: ArkhamEntity | null;
  arkhamLabel?: { name?: string } | null;
  contract?: boolean | null;
  service?: boolean | null;
}

interface ArkhamPortfolioEntry {
  id?: string;
  name?: string;
  symbol?: string;
  balance?: number;
  price?: number;
  usd?: number;
}

export class ArkhamWalletSource implements WalletIntelSource {
  readonly id = "arkham";
  readonly name = "Arkham";
  readonly priority = 29;
  readonly requiresAuth = true;

  private get apiKey(): string | undefined {
    return process.env.ARKHAM_API_KEY;
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey);
  }

  getCapabilities(): WalletIntelCapabilities {
    return {
      labels: true,
      balances: true,
      portfolio: false,
      transactions: false,
      tokenHolders: false,
      smartMoneyFlow: false,
      chains: [
        "ethereum",
        "bitcoin",
        "solana",
        "base",
        "arbitrum",
        "polygon",
        "optimism",
        "avalanche",
        "bsc",
      ],
    };
  }

  private async fetchJson<T>(path: string): Promise<T | null> {
    const key = this.apiKey;
    if (!key) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${BASE_URL}${path}`, {
        headers: { "API-Key": key, Accept: "application/json" },
        signal: controller.signal,
      });
      if (!res.ok) {
        logger.warn("Arkham request failed", { path, status: res.status });
        return null;
      }
      return (await res.json()) as T;
    } catch (err) {
      logger.warn("Arkham request errored", {
        path,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async getAddressLabels(query: AddressQuery): Promise<AddressLabel | null> {
    const chain = query.chain ? CHAIN_MAP[query.chain.toLowerCase()] : undefined;
    const qs = chain ? `?chain=${encodeURIComponent(chain)}` : "";
    const data = await this.fetchJson<ArkhamIntel>(
      `/intelligence/address/${encodeURIComponent(query.address)}${qs}`,
    );
    if (!data) return null;

    const entity = data.arkhamEntity ?? undefined;
    const type = entity?.type?.toLowerCase();
    const labels: string[] = [];
    if (entity?.name) labels.push(entity.name);
    if (data.arkhamLabel?.name) labels.push(data.arkhamLabel.name);
    if (type) labels.push(type);

    return {
      address: data.address ?? query.address,
      labels: [...new Set(labels)],
      entity: entity?.name,
      isSmartMoney: type ? SMART_MONEY_TYPES.has(type) : undefined,
      isExchange: type ? EXCHANGE_TYPES.has(type) || Boolean(data.service) : undefined,
      isContract: data.contract ?? undefined,
    };
  }

  async getTokenBalances(query: AddressQuery): Promise<TokenBalance[]> {
    const wanted = query.chain ? CHAIN_MAP[query.chain.toLowerCase()] : undefined;
    if (query.chain && !wanted) return [];

    const data = await this.fetchJson<Record<string, Record<string, ArkhamPortfolioEntry>>>(
      `/portfolio/address/${encodeURIComponent(query.address)}?time=${Date.now()}`,
    );
    if (!data) return [];

    const out: TokenBalance[] = [];
    for (const [chain, byToken] of Object.entries(data)) {
      if (wanted && chain !== wanted) continue;
      if (!byToken || typeof byToken !== "object") continue;
      for (const [tokenId, entry] of Object.entries(byToken)) {
        if (!entry || typeof entry !== "object") continue;
        out.push({
          tokenAddress: entry.id ?? tokenId,
          symbol: entry.symbol ?? "",
          name: entry.name,
          amount: typeof entry.balance === "number" ? entry.balance : 0,
          priceUsd: typeof entry.price === "number" ? entry.price : undefined,
          valueUsd: typeof entry.usd === "number" ? entry.usd : undefined,
          chain,
        });
      }
    }
    return out;
  }
}
