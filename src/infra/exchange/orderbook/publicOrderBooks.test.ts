import { describe, it, expect } from "bun:test";
import { PUBLIC_VENUES, isUsdQuote, splitSymbol } from "./publicOrderBooks.ts";

describe("splitSymbol", () => {
  it("recognizes USDT pairs", () => {
    expect(splitSymbol("BTCUSDT")).toEqual({ base: "BTC", quote: "USDT" });
  });
  it("prefers longer suffixes (USDT over USD)", () => {
    expect(splitSymbol("ETHUSDT")?.quote).toBe("USDT");
    expect(splitSymbol("ETHUSD")?.quote).toBe("USD");
  });
  it("handles dashed form", () => {
    expect(splitSymbol("BTC-USD")).toEqual({ base: "BTC", quote: "USD" });
  });
  it("handles fiat quotes", () => {
    expect(splitSymbol("BTCEUR")).toEqual({ base: "BTC", quote: "EUR" });
    expect(splitSymbol("ETHGBP")).toEqual({ base: "ETH", quote: "GBP" });
  });
  it("handles crypto-quoted pairs", () => {
    expect(splitSymbol("SOLBTC")).toEqual({ base: "SOL", quote: "BTC" });
  });
  it("returns null for unknown suffix", () => {
    expect(splitSymbol("UNKNOWNTOKEN")).toBeNull();
  });
});

describe("isUsdQuote", () => {
  it("treats stables as USD-equivalent", () => {
    expect(isUsdQuote("USDT")).toBe(true);
    expect(isUsdQuote("USDC")).toBe(true);
    expect(isUsdQuote("DAI")).toBe(true);
    expect(isUsdQuote("usd")).toBe(true);
  });
  it("rejects non-USD quotes", () => {
    expect(isUsdQuote("EUR")).toBe(false);
    expect(isUsdQuote("BTC")).toBe(false);
  });
});

describe("toNativeSymbol per venue", () => {
  it("Binance keeps tight format", () => {
    expect(PUBLIC_VENUES.binance.toNativeSymbol("BTCUSDT")).toBe("BTCUSDT");
    expect(PUBLIC_VENUES.binance.toNativeSymbol("BTC-USD")).toBe("BTCUSD");
  });
  it("Coinbase uses dash + maps USDT→USD", () => {
    expect(PUBLIC_VENUES.coinbase.toNativeSymbol("BTCUSDT")).toBe("BTC-USD");
    expect(PUBLIC_VENUES.coinbase.toNativeSymbol("ETHUSD")).toBe("ETH-USD");
    expect(PUBLIC_VENUES.coinbase.toNativeSymbol("ETHEUR")).toBe("ETH-EUR");
  });
  it("Kraken maps BTC→XBT", () => {
    expect(PUBLIC_VENUES.kraken.toNativeSymbol("BTCUSD")).toBe("XBTUSD");
  });
  it("OKX inserts dash before fiat suffix", () => {
    expect(PUBLIC_VENUES.okx.toNativeSymbol("BTCUSDT")).toBe("BTC-USDT");
    expect(PUBLIC_VENUES.okx.toNativeSymbol("ETHUSD")).toBe("ETH-USD");
    expect(PUBLIC_VENUES.okx.toNativeSymbol("BTC-USDT")).toBe("BTC-USDT");
  });
});

describe("venue fee defaults", () => {
  it("publishes a takerBps for each venue", () => {
    for (const v of Object.values(PUBLIC_VENUES)) {
      expect(v.takerBps).toBeGreaterThan(0);
      expect(v.takerBps).toBeLessThan(200); // sanity: under 2%
    }
  });
});
