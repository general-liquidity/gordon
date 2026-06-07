import { describe, expect, it } from "bun:test";

import {
  inferAssetClassFromVenue,
  inferAssetClassFromSymbol,
  inferAssetClass,
} from "./assetClassInference.ts";

describe("inferAssetClassFromVenue", () => {
  it("maps crypto venues", () => {
    expect(inferAssetClassFromVenue("binance")).toBe("crypto");
    expect(inferAssetClassFromVenue("Coinbase")).toBe("crypto");
    expect(inferAssetClassFromVenue("KRAKEN")).toBe("crypto");
    expect(inferAssetClassFromVenue("okx")).toBe("crypto");
  });

  it("maps us equity venues", () => {
    expect(inferAssetClassFromVenue("alpaca")).toBe("us_equity");
    expect(inferAssetClassFromVenue("ibkr")).toBe("us_equity");
    expect(inferAssetClassFromVenue("trading212")).toBe("us_equity");
  });

  it("maps defi venues", () => {
    expect(inferAssetClassFromVenue("uniswap")).toBe("defi");
    expect(inferAssetClassFromVenue("agentkit")).toBe("defi");
  });

  it("uses heuristic fallback for unknown venues with defi hints", () => {
    expect(inferAssetClassFromVenue("randomdex")).toBe("defi");
    expect(inferAssetClassFromVenue("some-pool")).toBe("defi");
  });

  it("returns unknown for unrecognized venues", () => {
    expect(inferAssetClassFromVenue("paperhand-broker-9000")).toBe("unknown");
  });

  it("handles undefined / null / empty input", () => {
    expect(inferAssetClassFromVenue(undefined)).toBe("unknown");
    expect(inferAssetClassFromVenue(null)).toBe("unknown");
    expect(inferAssetClassFromVenue("")).toBe("unknown");
  });
});

describe("inferAssetClassFromSymbol", () => {
  it("classifies FX pairs (two ISO-4217 codes, with or without separators)", () => {
    expect(inferAssetClassFromSymbol("EURUSD")).toBe("fx");
    expect(inferAssetClassFromSymbol("GBP/JPY")).toBe("fx");
    expect(inferAssetClassFromSymbol("usd_chf")).toBe("fx");
    expect(inferAssetClassFromSymbol("AUDNZD")).toBe("fx");
  });

  it("classifies precious metals as commodity", () => {
    expect(inferAssetClassFromSymbol("XAUUSD")).toBe("commodity");
    expect(inferAssetClassFromSymbol("XAGUSD")).toBe("commodity");
    expect(inferAssetClassFromSymbol("GOLD")).toBe("commodity");
    expect(inferAssetClassFromSymbol("SILVER")).toBe("commodity");
  });

  it("classifies crypto by stable quote or known base", () => {
    expect(inferAssetClassFromSymbol("BTCUSDT")).toBe("crypto");
    expect(inferAssetClassFromSymbol("ETH/USDC")).toBe("crypto");
    expect(inferAssetClassFromSymbol("BTCUSD")).toBe("crypto");
    expect(inferAssetClassFromSymbol("SOLUSD")).toBe("crypto");
  });

  it("does NOT mistake a crypto pair (BTCUSD) for FX", () => {
    // 6 letters but BTC is not a fiat code → not fx; the crypto-base check wins.
    expect(inferAssetClassFromSymbol("BTCUSD")).not.toBe("fx");
  });

  it("does NOT classify metal ETFs as commodity (they're equities by venue)", () => {
    expect(inferAssetClassFromSymbol("GLD")).toBe("unknown");
    expect(inferAssetClassFromSymbol("SLV")).toBe("unknown");
  });

  it("returns unknown for bare equity tickers / empty", () => {
    expect(inferAssetClassFromSymbol("AAPL")).toBe("unknown");
    expect(inferAssetClassFromSymbol("")).toBe("unknown");
    expect(inferAssetClassFromSymbol(undefined)).toBe("unknown");
  });
});

describe("inferAssetClass (combined: symbol over venue)", () => {
  it("uses the symbol to disambiguate on a multi-asset / unknown venue", () => {
    expect(inferAssetClass("syphonix", "EURUSD")).toBe("fx");
    expect(inferAssetClass("syphonix", "XAUUSD")).toBe("commodity");
    expect(inferAssetClass("syphonix", "BTCUSD")).toBe("crypto");
  });

  it("falls back to venue when the symbol is unclassifiable", () => {
    expect(inferAssetClass("alpaca", "AAPL")).toBe("us_equity");
    expect(inferAssetClass("binance", "FOO")).toBe("crypto");
    expect(inferAssetClass("uniswap", "WETH")).toBe("defi");
  });

  it("symbol signal overrides a generic venue", () => {
    // An FX symbol on an equity venue still reads as fx (symbol is more specific).
    expect(inferAssetClass("ibkr", "EURUSD")).toBe("fx");
  });

  it("returns unknown when neither symbol nor venue is informative", () => {
    expect(inferAssetClass("paperhand-broker-9000", "AAPL")).toBe("unknown");
    expect(inferAssetClass(undefined, undefined)).toBe("unknown");
  });
});
