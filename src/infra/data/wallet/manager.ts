/**
 * Wallet-intelligence manager — routes each operation to the highest-priority
 * available source that supports it (CCXT-style capability gating), with
 * automatic fallback to the next source on empty/error. Mirrors the OHLC
 * DataSourceManager but for address-level data.
 */

import { createModuleLogger } from "../../logger/index.ts";
import type {
  WalletIntelSource,
  WalletIntelCapabilities,
  AddressQuery,
  TxQuery,
  TokenQuery,
  SmartMoneyQuery,
  TokenBalance,
  Portfolio,
  WalletTx,
  TokenHolder,
  AddressLabel,
  SmartMoneyFlowItem,
} from "./types.ts";

const logger = createModuleLogger("wallet-intel-manager");

type CapKey = keyof Omit<WalletIntelCapabilities, "chains">;

export class WalletIntelManager {
  private sources: WalletIntelSource[] = [];

  register(source: WalletIntelSource): void {
    this.sources = this.sources.filter((s) => s.id !== source.id);
    this.sources.push(source);
    this.sources.sort((a, b) => a.priority - b.priority);
  }

  unregister(id: string): boolean {
    const before = this.sources.length;
    this.sources = this.sources.filter((s) => s.id !== id);
    return this.sources.length < before;
  }

  listSources(): ReadonlyArray<WalletIntelSource> {
    return this.sources;
  }

  /**
   * Try each capable+available source in priority order; return the first
   * non-empty result. Never throws — a source that errors is skipped.
   */
  private async route<T>(
    capability: CapKey,
    method: keyof WalletIntelSource,
    isEmpty: (result: T) => boolean,
    fallback: T,
    invoke: (source: WalletIntelSource) => Promise<T>,
  ): Promise<T> {
    for (const source of this.sources) {
      if (!source.getCapabilities()[capability]) continue;
      if (typeof source[method] !== "function") continue;
      try {
        if (!(await source.isAvailable())) continue;
        const result = await invoke(source);
        if (!isEmpty(result)) return result;
      } catch (err) {
        logger.warn("Wallet-intel source failed, falling through", {
          source: source.id,
          method: String(method),
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return fallback;
  }

  getTokenBalances(query: AddressQuery): Promise<TokenBalance[]> {
    return this.route<TokenBalance[]>(
      "balances",
      "getTokenBalances",
      (r) => r.length === 0,
      [],
      (s) => s.getTokenBalances!(query),
    );
  }

  getPortfolio(query: AddressQuery): Promise<Portfolio | null> {
    return this.route<Portfolio | null>(
      "portfolio",
      "getPortfolio",
      (r) => r === null,
      null,
      (s) => s.getPortfolio!(query),
    );
  }

  getTransactions(query: TxQuery): Promise<WalletTx[]> {
    return this.route<WalletTx[]>(
      "transactions",
      "getTransactions",
      (r) => r.length === 0,
      [],
      (s) => s.getTransactions!(query),
    );
  }

  getTokenHolders(query: TokenQuery): Promise<TokenHolder[]> {
    return this.route<TokenHolder[]>(
      "tokenHolders",
      "getTokenHolders",
      (r) => r.length === 0,
      [],
      (s) => s.getTokenHolders!(query),
    );
  }

  getAddressLabels(query: AddressQuery): Promise<AddressLabel | null> {
    return this.route<AddressLabel | null>(
      "labels",
      "getAddressLabels",
      (r) => r === null,
      null,
      (s) => s.getAddressLabels!(query),
    );
  }

  getSmartMoneyFlow(query: SmartMoneyQuery): Promise<SmartMoneyFlowItem[]> {
    return this.route<SmartMoneyFlowItem[]>(
      "smartMoneyFlow",
      "getSmartMoneyFlow",
      (r) => r.length === 0,
      [],
      (s) => s.getSmartMoneyFlow!(query),
    );
  }
}

let defaultManager: WalletIntelManager | null = null;

export function getWalletIntelManager(): WalletIntelManager {
  if (!defaultManager) {
    defaultManager = new WalletIntelManager();
  }
  return defaultManager;
}

export function resetWalletIntelManager(): void {
  defaultManager = null;
}
