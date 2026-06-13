/**
 * Options-chain manager — routes a chain request to the highest-priority
 * available provider that lists the requested currency, with fallback. Single
 * provider today (Deribit), but the structure supports more. Mirrors the
 * DataSource / OnchainMetrics / WalletIntel managers.
 */

import { createModuleLogger } from "../../logger/index.ts";
import type { OptionsChainProvider, OptionsChainSnapshot } from "./types.ts";

const logger = createModuleLogger("options-chain-manager");

export class OptionsChainManager {
  private providers: OptionsChainProvider[] = [];

  register(provider: OptionsChainProvider): void {
    this.providers = this.providers.filter((p) => p.id !== provider.id);
    this.providers.push(provider);
    this.providers.sort((a, b) => a.priority - b.priority);
  }

  unregister(id: string): boolean {
    const before = this.providers.length;
    this.providers = this.providers.filter((p) => p.id !== id);
    return this.providers.length < before;
  }

  listProviders(): ReadonlyArray<OptionsChainProvider> {
    return this.providers;
  }

  /**
   * Fetch the options chain for `currency`. Tries each provider that lists the
   * currency in priority order; returns the first non-empty chain. Throws only
   * if every provider declined or failed (so the caller can degrade cleanly).
   */
  async getChain(currency: string): Promise<OptionsChainSnapshot> {
    const cur = currency.toUpperCase();
    const errors: string[] = [];

    for (const provider of this.providers) {
      const currencies = provider.getCapabilities().currencies.map((c) => c.toUpperCase());
      if (!currencies.includes(cur)) continue;
      try {
        if (!(await provider.isAvailable())) continue;
        const snapshot = await provider.getChain(currency);
        if (snapshot.contracts.length > 0) return snapshot;
        errors.push(`${provider.id}: empty chain`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`${provider.id}: ${message}`);
        logger.warn("Options-chain provider failed, falling through", {
          provider: provider.id,
          currency: cur,
          error: message,
        });
      }
    }

    throw new Error(
      `No options-chain provider could serve "${currency}". ${
        errors.length > 0 ? `Errors: ${errors.join("; ")}` : "No provider lists this currency."
      }`,
    );
  }
}

let defaultManager: OptionsChainManager | null = null;

export function getOptionsChainManager(): OptionsChainManager {
  if (!defaultManager) {
    defaultManager = new OptionsChainManager();
  }
  return defaultManager;
}

export function resetOptionsChainManager(): void {
  defaultManager = null;
}
