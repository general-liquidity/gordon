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

  it("does NOT infer crypto from the symbol (open universe → venue/API catalog owns it)", () => {
    // Structural inference is FX/metal only; crypto symbols return unknown here
    // and are classified by the venue or the API-supplied `explicit` category.
    expect(inferAssetClassFromSymbol("BTCUSDT")).toBe("unknown");
    expect(inferAssetClassFromSymbol("ETH/USDC")).toBe("unknown");
    expect(inferAssetClassFromSymbol("SOLUSD")).toBe("unknown");
  });

  it("does NOT mistake a crypto pair (BTCUSD) for FX", () => {
    // 6 letters but BTC is not a fiat code → not fx (and not structurally crypto).
    expect(inferAssetClassFromSymbol("BTCUSD")).toBe("unknown");
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

describe("inferAssetClass (explicit > structural symbol > venue)", () => {
  it("the API-supplied explicit category wins (the source of truth for crypto/equity)", () => {
    expect(inferAssetClass("syphonix", "BTCUSD", "crypto")).toBe("crypto");
    expect(inferAssetClass(undefined, "AAPL", "equity")).toBe("us_equity");
    expect(inferAssetClass("syphonix", "WHATEVER", "forex")).toBe("fx");
    expect(inferAssetClass("syphonix", "XYZ", "metal")).toBe("commodity");
  });

  it("uses the structural symbol shape (fx/commodity) when no explicit category", () => {
    expect(inferAssetClass("syphonix", "EURUSD")).toBe("fx");
    expect(inferAssetClass("syphonix", "XAUUSD")).toBe("commodity");
  });

  it("falls back to venue for crypto/equity (whose symbols come from the catalog)", () => {
    expect(inferAssetClass("alpaca", "AAPL")).toBe("us_equity");
    expect(inferAssetClass("binance", "BTCUSD")).toBe("crypto"); // crypto via venue, not symbol
    expect(inferAssetClass("uniswap", "WETH")).toBe("defi");
  });

  it("structural symbol shape overrides a generic venue", () => {
    // An FX symbol on an equity venue still reads as fx (more specific than venue).
    expect(inferAssetClass("ibkr", "EURUSD")).toBe("fx");
  });

  it("returns unknown when symbol is non-structural and venue is multi-asset/unknown", () => {
    // A crypto symbol on an unknown multi-asset venue with no explicit category
    // can't be resolved by guessing — the API catalog must supply it.
    expect(inferAssetClass("syphonix", "BTCUSD")).toBe("unknown");
    expect(inferAssetClass("paperhand-broker-9000", "AAPL")).toBe("unknown");
    expect(inferAssetClass(undefined, undefined)).toBe("unknown");
  });
});
