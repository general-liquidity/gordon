import { describe, it, expect } from "bun:test";

import {
  mapLiquidity,
  liquidityToPayload,
} from "./liquidityMapper.ts";

describe("mapLiquidity — basic mapping", () => {
  it("support level → cluster below price minus buffer", () => {
    const r = mapLiquidity({
      currentPrice: 100,
      stopBufferPriceUnits: 0.5,
      levels: [{ price: 99, kind: "support", testCount: 3 }],
    });
    expect(r.nearestBelow!.price).toBe(98.5);
    expect(r.nearestBelow!.side).toBe("below");
    expect(r.nearestBelow!.sources).toContain("support");
  });

  it("resistance level → cluster above price plus buffer", () => {
    const r = mapLiquidity({
      currentPrice: 100,
      stopBufferPriceUnits: 0.5,
      levels: [{ price: 102, kind: "resistance" }],
    });
    expect(r.nearestAbove!.price).toBe(102.5);
    expect(r.nearestAbove!.side).toBe("above");
  });
});

describe("mapLiquidity — strength scoring", () => {
  it("triple-bottom support clusters more strongly than single-test", () => {
    const r = mapLiquidity({
      currentPrice: 100,
      stopBufferPriceUnits: 0.5,
      levels: [
        { price: 99, kind: "support", testCount: 3 },
        { price: 95, kind: "support", testCount: 1 },
      ],
    });
    expect(r.zonesBelow.length).toBeGreaterThanOrEqual(2);
    const tripleBottom = r.zonesBelow.find((z) => Math.abs(z.price - 98.5) < 1e-6);
    const singleTouch = r.zonesBelow.find((z) => Math.abs(z.price - 94.5) < 1e-6);
    expect(tripleBottom!.strength).toBeGreaterThan(singleTouch!.strength);
  });
});

describe("mapLiquidity — zone merging", () => {
  it("levels at the same buffered price merge their strength", () => {
    const r = mapLiquidity({
      currentPrice: 100,
      stopBufferPriceUnits: 0.5,
      levels: [
        { price: 99, kind: "support" },
        { price: 99, kind: "session_low" },
      ],
    });
    expect(r.zonesBelow.length).toBe(1);
    expect(r.zonesBelow[0]!.sources).toContain("support");
    expect(r.zonesBelow[0]!.sources).toContain("session_low");
  });
});

describe("mapLiquidity — Wright Ch 12 stop-hunt example", () => {
  it("$100 triple-bottom + $100 round number creates strongest cluster around $99.50", () => {
    const r = mapLiquidity({
      currentPrice: 101,
      stopBufferPriceUnits: 0.5,
      levels: [
        { price: 100, kind: "support", testCount: 3 },
        { price: 100, kind: "round_number" },
      ],
    });
    expect(r.nearestBelow!.price).toBe(99.5);
    expect(r.nearestBelow!.sources.length).toBeGreaterThan(1);
  });
});

describe("mapLiquidity — sorting", () => {
  it("nearest below is closest by distance, not strongest", () => {
    const r = mapLiquidity({
      currentPrice: 100,
      stopBufferPriceUnits: 0.5,
      levels: [
        { price: 95, kind: "support", testCount: 5 },
        { price: 99, kind: "support", testCount: 1 },
      ],
    });
    expect(r.nearestBelow!.price).toBe(98.5);
  });
});

describe("liquidityToPayload", () => {
  it("emits stable shape", () => {
    const r = mapLiquidity({
      currentPrice: 100,
      stopBufferPriceUnits: 0.5,
      levels: [{ price: 99, kind: "support" }],
    });
    const p = liquidityToPayload(r) as { kind: string; zoneCount: number };
    expect(p.kind).toBe("liquidity_mapper.mapped");
    expect(p.zoneCount).toBeGreaterThan(0);
  });
});
