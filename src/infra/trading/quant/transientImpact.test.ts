import { describe, it, expect } from "bun:test";
import {
  computeTransientImpact,
  transientImpactToPayload,
  isTransientImpactEnabled,
  TRANSIENT_IMPACT_FLAG_ENV,
} from "./transientImpact.ts";

describe("isTransientImpactEnabled", () => {
  it("respects the flag", () => {
    expect(isTransientImpactEnabled({})).toBe(false);
    expect(isTransientImpactEnabled({ [TRANSIENT_IMPACT_FLAG_ENV]: "1" })).toBe(true);
  });
});

describe("computeTransientImpact — validation", () => {
  it("rejects non-positive half-life", () => {
    expect(() =>
      computeTransientImpact({ now: 10, fills: [], halfLife: 0 }),
    ).toThrow();
    expect(() =>
      computeTransientImpact({ now: 10, fills: [], halfLife: -1 }),
    ).toThrow();
  });

  it("rejects negative coefficients", () => {
    expect(() =>
      computeTransientImpact({
        now: 10,
        fills: [],
        halfLife: 5,
        transientCoef: -1,
      }),
    ).toThrow();
    expect(() =>
      computeTransientImpact({
        now: 10,
        fills: [],
        halfLife: 5,
        permanentCoef: -1,
      }),
    ).toThrow();
  });

  it("rejects fills in the future relative to now", () => {
    expect(() =>
      computeTransientImpact({
        now: 5,
        fills: [{ time: 10, signedSize: 1 }],
        halfLife: 5,
      }),
    ).toThrow();
  });
});

describe("computeTransientImpact — basic invariants", () => {
  it("empty fill history → zero impact", () => {
    const r = computeTransientImpact({ now: 10, fills: [], halfLife: 5 });
    expect(r.totalImpact).toBe(0);
    expect(r.transientImpact).toBe(0);
    expect(r.permanentImpact).toBe(0);
    expect(r.effectiveFillCount).toBe(0);
  });

  it("single fill at t=now → full transient impact", () => {
    const r = computeTransientImpact({
      now: 10,
      fills: [{ time: 10, signedSize: 100 }],
      halfLife: 60,
      transientCoef: 0.01,
    });
    expect(r.transientImpact).toBeCloseTo(1.0, 6); // 100 * 0.01 * exp(0)
  });

  it("single fill at age = halfLife → 50% transient impact", () => {
    const r = computeTransientImpact({
      now: 70,
      fills: [{ time: 10, signedSize: 100 }],
      halfLife: 60,
      transientCoef: 0.01,
    });
    expect(r.transientImpact).toBeCloseTo(0.5, 6); // 100 * 0.01 * 0.5
  });

  it("single fill at age = 2 half-lives → 25% transient impact", () => {
    const r = computeTransientImpact({
      now: 130,
      fills: [{ time: 10, signedSize: 100 }],
      halfLife: 60,
      transientCoef: 0.01,
    });
    expect(r.transientImpact).toBeCloseTo(0.25, 6); // 100 * 0.01 * 0.25
  });
});

describe("computeTransientImpact — sign and additivity", () => {
  it("opposite fills at same time cancel", () => {
    const r = computeTransientImpact({
      now: 10,
      fills: [
        { time: 10, signedSize: 100 },
        { time: 10, signedSize: -100 },
      ],
      halfLife: 60,
    });
    expect(r.transientImpact).toBeCloseTo(0, 6);
  });

  it("negative (sell) fill produces negative impact", () => {
    const r = computeTransientImpact({
      now: 10,
      fills: [{ time: 10, signedSize: -100 }],
      halfLife: 60,
      transientCoef: 0.01,
    });
    expect(r.transientImpact).toBeCloseTo(-1.0, 6);
  });

  it("two fresh fills sum linearly", () => {
    const r = computeTransientImpact({
      now: 10,
      fills: [
        { time: 10, signedSize: 50 },
        { time: 10, signedSize: 30 },
      ],
      halfLife: 60,
      transientCoef: 0.01,
    });
    expect(r.transientImpact).toBeCloseTo(0.8, 6); // (50 + 30) * 0.01
  });
});

describe("computeTransientImpact — permanent component", () => {
  it("permanent component does NOT decay", () => {
    const r = computeTransientImpact({
      now: 1000, // very old fill
      fills: [{ time: 0, signedSize: 100 }],
      halfLife: 10,
      transientCoef: 0.01,
      permanentCoef: 0.005,
    });
    expect(r.transientImpact).toBeCloseTo(0, 6); // fully decayed
    expect(r.permanentImpact).toBeCloseTo(0.5, 6); // 100 * 0.005
    expect(r.totalImpact).toBeCloseTo(0.5, 6);
  });

  it("permanent + transient combine additively", () => {
    const r = computeTransientImpact({
      now: 10,
      fills: [{ time: 10, signedSize: 100 }],
      halfLife: 60,
      transientCoef: 0.01,
      permanentCoef: 0.005,
    });
    expect(r.transientImpact).toBeCloseTo(1.0, 6);
    expect(r.permanentImpact).toBeCloseTo(0.5, 6);
    expect(r.totalImpact).toBeCloseTo(1.5, 6);
  });
});

describe("computeTransientImpact — effective fill count", () => {
  it("very old fills do not count as effective", () => {
    const r = computeTransientImpact({
      now: 1000,
      fills: [{ time: 0, signedSize: 100 }], // 1000/10 = 100 half-lives old
      halfLife: 10,
    });
    expect(r.effectiveFillCount).toBe(0);
  });

  it("recent fills count as effective", () => {
    const r = computeTransientImpact({
      now: 10,
      fills: [
        { time: 10, signedSize: 100 },
        { time: 5, signedSize: 50 },
      ],
      halfLife: 60,
    });
    expect(r.effectiveFillCount).toBe(2);
  });
});

describe("computeTransientImpact — decay rate", () => {
  it("decayRate = ln(2)/halfLife", () => {
    const r = computeTransientImpact({ now: 10, fills: [], halfLife: 60 });
    expect(r.decayRate).toBeCloseTo(Math.log(2) / 60, 8);
  });
});

describe("transientImpactToPayload", () => {
  it("emits stable shape", () => {
    const r = computeTransientImpact({
      now: 10,
      fills: [{ time: 10, signedSize: 100 }],
      halfLife: 60,
      transientCoef: 0.01,
    });
    const p = transientImpactToPayload(r) as {
      kind: string;
      totalImpact: number;
      transientImpact: number;
    };
    expect(p.kind).toBe("transient_impact.computed");
    expect(p.transientImpact).toBeCloseTo(1.0, 4);
  });
});
