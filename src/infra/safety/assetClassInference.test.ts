import { describe, expect, it } from "bun:test";

import { inferAssetClassFromVenue } from "./assetClassInference.ts";

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
