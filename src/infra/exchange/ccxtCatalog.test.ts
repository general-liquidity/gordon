import { describe, it, expect } from "bun:test";
import {
  VERIFIED_EXCHANGE_IDS,
  listCcxtExchanges,
  getExchangeCapabilities,
} from "./ccxtCatalog.ts";

describe("listCcxtExchanges", () => {
  const catalog = listCcxtExchanges();

  it("lists the full CCXT catalog (~111 venues)", () => {
    expect(catalog.length).toBeGreaterThan(90);
    expect(catalog.length).toBeLessThan(140);
  });

  it("flags exactly the verified ids that exist in ccxt.exchanges", () => {
    // robinhood is a Gordon first-class venue but NOT a ccxt.exchanges id
    // (Gordon routes it specially), so it can't appear in the catalog. Every
    // OTHER verified id must be present and flagged; nothing else is flagged.
    const catalogIds = new Set(catalog.map((e) => e.id));
    const expectedVerified = VERIFIED_EXCHANGE_IDS.filter((id) => catalogIds.has(id)).sort();
    const actualVerified = catalog.filter((e) => e.verified).map((e) => e.id).sort();
    expect(actualVerified).toEqual(expectedVerified);
    // robinhood specifically is absent from the ccxt list
    expect(catalogIds.has("robinhood")).toBe(false);
  });

  it("orders verified-first, then alpha within each tier", () => {
    const firstUnverified = catalog.findIndex((e) => !e.verified);
    // all verified come before any unverified
    expect(catalog.slice(0, firstUnverified).every((e) => e.verified)).toBe(true);
    expect(catalog.slice(firstUnverified).every((e) => !e.verified)).toBe(true);

    const verifiedNames = catalog.slice(0, firstUnverified).map((e) => e.name);
    const sortedVerified = [...verifiedNames].sort((a, b) => a.localeCompare(b));
    expect(verifiedNames).toEqual(sortedVerified);

    const communityNames = catalog.slice(firstUnverified).map((e) => e.name);
    const sortedCommunity = [...communityNames].sort((a, b) => a.localeCompare(b));
    expect(communityNames).toEqual(sortedCommunity);
  });

  it("memoizes (returns the same array instance)", () => {
    expect(listCcxtExchanges()).toBe(catalog);
  });
});

describe("getExchangeCapabilities", () => {
  it("binance: apiKey + secret, OHLCV, websocket", () => {
    const caps = getExchangeCapabilities("binance");
    expect(caps.requiredCredentials).toContain("apiKey");
    expect(caps.requiredCredentials).toContain("secret");
    expect(caps.requiredCredentials).not.toContain("privateKey");
    expect(caps.hasOHLCV).toBe(true);
    expect(caps.hasWebsocket).toBe(true);
    expect(caps.isDex).toBe(false);
    expect(caps.displayName).toBe("Binance");
  });

  it("coinbase: shape is well-formed (apiKey + secret, OHLCV)", () => {
    const caps = getExchangeCapabilities("coinbase");
    expect(caps.requiredCredentials).toContain("apiKey");
    expect(caps.requiredCredentials).toContain("secret");
    expect(caps.hasOHLCV).toBe(true);
    expect(caps.isDex).toBe(false);
    expect(typeof caps.hasWebsocket).toBe("boolean");
  });

  it("hyperliquid: DEX (privateKey/walletAddress), not apiKey+secret", () => {
    const caps = getExchangeCapabilities("hyperliquid");
    expect(caps.isDex).toBe(true);
    const dexField =
      caps.requiredCredentials.includes("privateKey") ||
      caps.requiredCredentials.includes("walletAddress");
    expect(dexField).toBe(true);
  });

  it("okx: requires a passphrase (password field)", () => {
    const caps = getExchangeCapabilities("okx");
    expect(caps.requiredCredentials).toContain("apiKey");
    expect(caps.requiredCredentials).toContain("secret");
    expect(caps.requiredCredentials).toContain("password");
  });
});
