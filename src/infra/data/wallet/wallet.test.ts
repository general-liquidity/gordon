import { describe, expect, it } from "bun:test";

import { walletIntelSources, WalletIntelManager, registerWalletIntelSources } from "./index.ts";
import type { WalletIntelCapabilities } from "./types.ts";

const CAP_TO_METHOD: Record<keyof Omit<WalletIntelCapabilities, "chains">, string> = {
  balances: "getTokenBalances",
  portfolio: "getPortfolio",
  transactions: "getTransactions",
  tokenHolders: "getTokenHolders",
  labels: "getAddressLabels",
  smartMoneyFlow: "getSmartMoneyFlow",
};

describe("wallet intelligence adapter", () => {
  const sources = walletIntelSources();

  it("registers the six providers with distinct ids + priorities", () => {
    expect(sources.map((s) => s.id).sort()).toEqual([
      "arkham",
      "covalent",
      "debank",
      "moralis",
      "nansen",
      "zerion",
    ]);
    expect(new Set(sources.map((s) => s.priority)).size).toBe(sources.length);
  });

  it("each implements exactly the methods its capabilities declare", () => {
    for (const s of sources) {
      const caps = s.getCapabilities();
      expect(caps.chains.length).toBeGreaterThan(0);
      for (const [cap, method] of Object.entries(CAP_TO_METHOD)) {
        if (caps[cap as keyof typeof CAP_TO_METHOD]) {
          expect(typeof (s as unknown as Record<string, unknown>)[method]).toBe("function");
        }
      }
      // At least one capability is declared.
      const anyCap = (Object.keys(CAP_TO_METHOD) as Array<keyof typeof CAP_TO_METHOD>).some(
        (k) => caps[k],
      );
      expect(anyCap).toBeTrue();
    }
  });

  it("manager routes gracefully to [] / null when no source is available (no keys, never throws)", async () => {
    const m = new WalletIntelManager();
    registerWalletIntelSources(m);
    // With no API keys set in the test env, every source isAvailable()=false →
    // the manager must return empty/null, never throw.
    expect(await m.getTokenBalances({ address: "0xabc", chain: "ethereum" })).toEqual([]);
    expect(await m.getPortfolio({ address: "0xabc" })).toBeNull();
    expect(await m.getTransactions({ address: "0xabc", chain: "ethereum" })).toEqual([]);
    expect(await m.getTokenHolders({ tokenAddress: "0xtok", chain: "ethereum" })).toEqual([]);
    expect(await m.getAddressLabels({ address: "0xabc" })).toBeNull();
    expect(await m.getSmartMoneyFlow({ chain: "ethereum" })).toEqual([]);
  });
});
