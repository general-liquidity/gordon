import { describe, it, expect } from "bun:test";
import { computeCpr, cprToPayload } from "./centralPivotRange.ts";

describe("computeCpr — formula correctness", () => {
  it("CP = (H + L + C) / 3", () => {
    const r = computeCpr({ prev: { high: 110, low: 100, close: 105 } });
    expect(r.centralPivot).toBeCloseTo(105, 9);
  });

  it("TC = (H + L) / 2", () => {
    const r = computeCpr({ prev: { high: 110, low: 100, close: 105 } });
    // Symmetric close → TC and BC coincide with CP
    expect(r.topCentral).toBeCloseTo(105, 9);
    expect(r.bottomCentral).toBeCloseTo(105, 9);
  });

  it("BC = CP × 2 − TC, ordered TC ≥ BC", () => {
    const r = computeCpr({ prev: { high: 110, low: 100, close: 108 } });
    // CP = 106, TC raw = 105, BC raw = 107 → swap so TC=107, BC=105
    expect(r.topCentral).toBeGreaterThanOrEqual(r.bottomCentral);
    const cp = r.centralPivot;
    expect(r.topCentral + r.bottomCentral).toBeCloseTo(2 * cp, 9);
  });

  it("R1/S1 use the standard floor-pivot formulas", () => {
    const r = computeCpr({ prev: { high: 110, low: 100, close: 105 } });
    expect(r.r1).toBeCloseTo(2 * 105 - 100, 9);
    expect(r.s1).toBeCloseTo(2 * 105 - 110, 9);
  });
});

describe("computeCpr — narrow vs wide classification", () => {
  it("very tight prior day → narrow", () => {
    const r = computeCpr({
      prev: { high: 100.1, low: 99.9, close: 100 },
      narrowThresholdPct: 0.003,
    });
    expect(r.mode).toBe("narrow");
  });

  it("wide-range prior day → wide", () => {
    // Close near the high so TC ≠ BC (close at midpoint produces zero-width CPR).
    const r = computeCpr({
      prev: { high: 120, low: 100, close: 119 },
      narrowThresholdPct: 0.003,
    });
    expect(r.mode).toBe("wide");
  });

  it("custom narrow threshold respected", () => {
    const r = computeCpr({
      prev: { high: 110, low: 100, close: 105 },
      narrowThresholdPct: 0.5, // 50% — anything is narrow
    });
    expect(r.mode).toBe("narrow");
  });
});

describe("computeCpr — bias", () => {
  it("price above TC → bullish", () => {
    const r = computeCpr({
      prev: { high: 110, low: 100, close: 108 },
      currentPrice: 200,
    });
    expect(r.bias).toBe("bullish");
  });

  it("price below BC → bearish", () => {
    const r = computeCpr({
      prev: { high: 110, low: 100, close: 108 },
      currentPrice: 50,
    });
    expect(r.bias).toBe("bearish");
  });

  it("price inside CPR band → neutral", () => {
    const r = computeCpr({
      prev: { high: 110, low: 100, close: 108 },
      currentPrice: r0((r) => (r.topCentral + r.bottomCentral) / 2)({
        prev: { high: 110, low: 100, close: 108 },
      }),
    });
    expect(r.bias).toBe("neutral");
  });

  it("missing currentPrice → neutral", () => {
    const r = computeCpr({ prev: { high: 110, low: 100, close: 105 } });
    expect(r.bias).toBe("neutral");
  });
});

// Tiny helper to derive a price from the result of a separate compute call
// — keeps the "inside the band" test readable.
function r0<T>(
  extract: (r: ReturnType<typeof computeCpr>) => T,
): (input: Parameters<typeof computeCpr>[0]) => T {
  return (input) => extract(computeCpr(input));
}

describe("computeCpr — input validation", () => {
  it("rejects non-positive prices", () => {
    expect(() => computeCpr({ prev: { high: 0, low: 0, close: 0 } })).toThrow();
  });

  it("rejects high < low", () => {
    expect(() => computeCpr({ prev: { high: 100, low: 110, close: 105 } })).toThrow();
  });
});

describe("cprToPayload", () => {
  it("emits stable shape", () => {
    const r = computeCpr({ prev: { high: 110, low: 100, close: 105 } });
    const p = cprToPayload(r) as { kind: string; mode: string };
    expect(p.kind).toBe("cpr.computed");
    expect(["narrow", "wide"]).toContain(p.mode);
  });
});
