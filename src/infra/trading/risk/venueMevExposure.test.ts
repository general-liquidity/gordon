import { describe, it, expect } from "bun:test";
import {
  classifyVenue,
  classifyNativeVenue,
  classifyCcxtVenue,
  buildVenueMevExposure,
} from "./venueMevExposure.ts";

describe("classifyNativeVenue", () => {
  it("classifies CEXes as low tier", () => {
    for (const id of ["binance", "coinbase", "kraken", "okx", "gemini", "bitfinex", "binance_us"]) {
      expect(classifyNativeVenue(id).tier).toBe("low");
    }
  });

  it("classifies hyperliquid as medium", () => {
    expect(classifyNativeVenue("hyperliquid").tier).toBe("medium");
  });

  it("returns unknown for unrecognized venue ids", () => {
    expect(classifyNativeVenue("madeup_venue").tier).toBe("unknown");
  });

  it("assigns expected scores per tier", () => {
    expect(classifyNativeVenue("binance").score).toBe(0);
    expect(classifyNativeVenue("hyperliquid").score).toBe(25);
    expect(classifyNativeVenue("madeup").score).toBe(30);
  });

  it("populates a reason string", () => {
    expect(classifyNativeVenue("binance").reason).toContain("CEX");
  });
});

describe("classifyCcxtVenue", () => {
  it("classifies known CCXT CEXes as low", () => {
    for (const sub of ["binance", "kucoin", "bybit", "mexc", "gate", "bitget"]) {
      expect(classifyCcxtVenue(sub).tier).toBe("low");
    }
  });

  it("returns unknown for unrecognized CCXT sub-ids", () => {
    expect(classifyCcxtVenue("madeup_ccxt").tier).toBe("unknown");
  });
});

describe("classifyVenue — dispatch on prefix", () => {
  it("dispatches to native classifier for non-prefixed ids", () => {
    expect(classifyVenue("binance").tier).toBe("low");
    expect(classifyVenue("removed_venue").tier).toBe("unknown");
  });

  it("dispatches to CCXT classifier for ccxt: prefixed ids", () => {
    expect(classifyVenue("ccxt:binance").tier).toBe("low");
    expect(classifyVenue("ccxt:kucoin").tier).toBe("low");
    expect(classifyVenue("ccxt:unknown_sub").tier).toBe("unknown");
  });
});

describe("buildVenueMevExposure — operator override", () => {
  it("builds an exposure with the explicit tier", () => {
    const exp = buildVenueMevExposure("protected");
    expect(exp.tier).toBe("protected");
    expect(exp.score).toBe(5);
  });

  it("uses default reason when no override supplied", () => {
    expect(buildVenueMevExposure("high").reason).toContain("Public mempool");
  });

  it("honors reason override", () => {
    const exp = buildVenueMevExposure("protected", "Routing through Flashbots Protect RPC");
    expect(exp.reason).toBe("Routing through Flashbots Protect RPC");
  });
});
