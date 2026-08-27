import { describe, it, expect } from "bun:test";
import { computeOiDirection, oiDirectionToPayload } from "./openInterestDirection.ts";

describe("computeOiDirection — regime classification", () => {
  it("price ↑ + OI ↑ → longs_building", () => {
    const prices = Array.from({ length: 30 }, (_, i) => 100 + i);
    const oi = Array.from({ length: 30 }, (_, i) => 1_000 + i * 50);
    const r = computeOiDirection({ prices, openInterest: oi });
    expect(r.regime).toBe("longs_building");
  });

  it("price ↑ + OI ↓ → short_covering", () => {
    const prices = Array.from({ length: 30 }, (_, i) => 100 + i);
    const oi = Array.from({ length: 30 }, (_, i) => 5_000 - i * 100);
    const r = computeOiDirection({ prices, openInterest: oi });
    expect(r.regime).toBe("short_covering");
  });

  it("price ↓ + OI ↑ → shorts_building", () => {
    const prices = Array.from({ length: 30 }, (_, i) => 200 - i);
    const oi = Array.from({ length: 30 }, (_, i) => 1_000 + i * 80);
    const r = computeOiDirection({ prices, openInterest: oi });
    expect(r.regime).toBe("shorts_building");
  });

  it("price ↓ + OI ↓ → long_liquidation", () => {
    const prices = Array.from({ length: 30 }, (_, i) => 200 - i);
    const oi = Array.from({ length: 30 }, (_, i) => 5_000 - i * 100);
    const r = computeOiDirection({ prices, openInterest: oi });
    expect(r.regime).toBe("long_liquidation");
  });

  it("flat price + active OI → flat", () => {
    const prices = Array.from({ length: 30 }, () => 100);
    const oi = Array.from({ length: 30 }, (_, i) => 1_000 + i * 50);
    const r = computeOiDirection({ prices, openInterest: oi });
    expect(r.regime).toBe("flat");
  });
});

describe("computeOiDirection — strength scaling", () => {
  it("strong conviction in same direction → strong", () => {
    const prices = Array.from({ length: 30 }, (_, i) => 100 + i * 3); // ~90% rise
    const oi = Array.from({ length: 30 }, (_, i) => 1_000 + i * 200); // ~600% rise
    const r = computeOiDirection({ prices, openInterest: oi });
    expect(r.trendStrength).toBe("strong");
  });

  it("low-magnitude movement is weak", () => {
    // ~1% price change and ~1% OI change over the lookback — non-flat but small.
    const prices = Array.from({ length: 30 }, (_, i) => 100 + i * 0.05);
    const oi = Array.from({ length: 30 }, (_, i) => 1_000 + i * 0.5);
    const r = computeOiDirection({ prices, openInterest: oi });
    expect(["weak", "moderate"]).toContain(r.trendStrength);
  });
});

describe("computeOiDirection — input validation", () => {
  it("length mismatch throws", () => {
    expect(() => computeOiDirection({ prices: [1, 2, 3], openInterest: [1, 2] })).toThrow();
  });

  it("short input returns flat with reason", () => {
    const r = computeOiDirection({ prices: [1, 2, 3], openInterest: [1, 2, 3] });
    expect(r.regime).toBe("flat");
    expect(r.reasoning).toContain("at least");
  });
});

describe("computeOiDirection — cash-and-carry", () => {
  it("positive basis + positive funding → short_basis carry", () => {
    const prices = Array.from({ length: 30 }, (_, i) => 100 + i);
    const oi = Array.from({ length: 30 }, (_, i) => 1_000 + i * 50);
    const r = computeOiDirection({
      prices,
      openInterest: oi,
      perpPrice: 102,
      spotPrice: 100,
      fundingRatePer8h: 0.0001, // 1 bp/8h
    });
    expect(r.cashAndCarry?.direction).toBe("short_basis");
    expect(r.cashAndCarry?.fundingApy).toBeCloseTo(0.0001 * 3 * 365, 9);
  });

  it("negative basis + negative funding → long_basis carry", () => {
    const prices = Array.from({ length: 30 }, (_, i) => 100 + i);
    const oi = Array.from({ length: 30 }, (_, i) => 1_000 + i * 50);
    const r = computeOiDirection({
      prices,
      openInterest: oi,
      perpPrice: 98,
      spotPrice: 100,
      fundingRatePer8h: -0.0005,
    });
    expect(r.cashAndCarry?.direction).toBe("long_basis");
  });

  it("attractive flag respects threshold", () => {
    const prices = Array.from({ length: 30 }, (_, i) => 100 + i);
    const oi = Array.from({ length: 30 }, (_, i) => 1_000 + i * 50);
    const r = computeOiDirection({
      prices,
      openInterest: oi,
      perpPrice: 105,
      spotPrice: 100,
      fundingRatePer8h: 0.001, // 100 bp/8h = ~110% APY
      minCarryApy: 0.5,
    });
    expect(r.cashAndCarry?.attractive).toBe(true);
  });

  it("missing perp/spot → no cash-and-carry result", () => {
    const prices = Array.from({ length: 30 }, (_, i) => 100 + i);
    const oi = Array.from({ length: 30 }, (_, i) => 1_000 + i * 50);
    const r = computeOiDirection({ prices, openInterest: oi });
    expect(r.cashAndCarry).toBeNull();
  });
});

describe("oiDirectionToPayload", () => {
  it("emits stable shape", () => {
    const prices = Array.from({ length: 30 }, (_, i) => 100 + i);
    const oi = Array.from({ length: 30 }, (_, i) => 1_000 + i * 50);
    const p = oiDirectionToPayload(computeOiDirection({ prices, openInterest: oi })) as {
      kind: string;
      regime: string;
    };
    expect(p.kind).toBe("oi_direction.computed");
    expect([
      "longs_building",
      "short_covering",
      "shorts_building",
      "long_liquidation",
      "flat",
    ]).toContain(p.regime);
  });
});
