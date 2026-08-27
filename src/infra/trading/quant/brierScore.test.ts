import { describe, it, expect } from "bun:test";
import { computeBrierScore, brierScoreToPayload } from "./brierScore.ts";

describe("computeBrierScore — validation", () => {
  it("rejects empty predictions", () => {
    expect(() => computeBrierScore({ predictions: [], outcomes: [] })).toThrow();
  });

  it("rejects length mismatch", () => {
    expect(() => computeBrierScore({ predictions: [0.5, 0.6], outcomes: [1] })).toThrow();
  });

  it("rejects predictions outside [0,1]", () => {
    expect(() => computeBrierScore({ predictions: [0.5, 1.5], outcomes: [0, 1] })).toThrow();
    expect(() => computeBrierScore({ predictions: [-0.1, 0.5], outcomes: [0, 1] })).toThrow();
    expect(() => computeBrierScore({ predictions: [NaN, 0.5], outcomes: [0, 1] })).toThrow();
  });

  it("rejects outcomes not in {0, 1, boolean}", () => {
    expect(() => computeBrierScore({ predictions: [0.5], outcomes: [0.5] })).toThrow();
  });

  it("rejects baselineProbability outside [0,1]", () => {
    expect(() =>
      computeBrierScore({
        predictions: [0.5],
        outcomes: [1],
        baselineProbability: 1.5,
      }),
    ).toThrow();
  });
});

describe("computeBrierScore — extremes", () => {
  it("perfect predictions → BS = 0", () => {
    const r = computeBrierScore({
      predictions: [1, 0, 1, 0],
      outcomes: [1, 0, 1, 0],
    });
    expect(r.brierScore).toBeCloseTo(0, 6);
    expect(r.classification).toBe("excellent");
  });

  it("always-wrong predictions → BS = 1", () => {
    const r = computeBrierScore({
      predictions: [1, 0, 1, 0],
      outcomes: [0, 1, 0, 1],
    });
    expect(r.brierScore).toBeCloseTo(1, 6);
    expect(r.classification).toBe("poor");
  });

  it("always 0.5 → BS = 0.25 (the noise floor)", () => {
    const r = computeBrierScore({
      predictions: [0.5, 0.5, 0.5, 0.5],
      outcomes: [1, 0, 1, 0],
    });
    expect(r.brierScore).toBeCloseTo(0.25, 6);
    expect(r.classification).toBe("poor");
  });
});

describe("computeBrierScore — boolean outcome coercion", () => {
  it("accepts booleans", () => {
    const r = computeBrierScore({
      predictions: [0.8, 0.2],
      outcomes: [true, false],
    });
    // 0.04 + 0.04 = 0.08 / 2 = 0.04
    expect(r.brierScore).toBeCloseTo(0.04, 6);
    expect(r.classification).toBe("excellent");
  });
});

describe("computeBrierScore — classification thresholds", () => {
  it("BS = 0.05 → excellent", () => {
    // (0.8, 1) → 0.04 squared error; (0.2, 0) → 0.04 → mean 0.04
    const r = computeBrierScore({
      predictions: [0.8, 0.2, 0.8, 0.2],
      outcomes: [1, 0, 1, 0],
    });
    expect(r.brierScore).toBeLessThan(0.1);
    expect(r.classification).toBe("excellent");
  });

  it("BS ≈ 0.15 → good", () => {
    // (0.6, 1) → 0.16; (0.4, 0) → 0.16; mean 0.16 — actually marginal? Let's compute.
    // Use (0.65, 1) → 0.1225; (0.35, 0) → 0.1225 → mean 0.1225 → good
    const r = computeBrierScore({
      predictions: [0.65, 0.35, 0.65, 0.35],
      outcomes: [1, 0, 1, 0],
    });
    expect(r.brierScore).toBeGreaterThanOrEqual(0.1);
    expect(r.brierScore).toBeLessThan(0.2);
    expect(r.classification).toBe("good");
  });

  it("BS = 0.22 → marginal", () => {
    // (0.55, 1) → 0.2025; (0.45, 0) → 0.2025 → mean 0.2025 → marginal
    const r = computeBrierScore({
      predictions: [0.55, 0.45, 0.55, 0.45],
      outcomes: [1, 0, 1, 0],
    });
    expect(r.brierScore).toBeGreaterThanOrEqual(0.2);
    expect(r.brierScore).toBeLessThan(0.25);
    expect(r.classification).toBe("marginal");
  });
});

describe("computeBrierScore — skill score vs baseline", () => {
  it("baseline default = sample mean of outcomes (climatology)", () => {
    const r = computeBrierScore({
      predictions: [0.5, 0.5, 0.5, 0.5],
      outcomes: [1, 0, 1, 0],
    });
    expect(r.baseRate).toBeCloseTo(0.5, 6);
    expect(r.baselineProbability).toBeCloseTo(0.5, 6);
    // Predicting baseline exactly → BS = baseline-BS → skill = 0
    expect(r.skillScore).toBeCloseTo(0, 6);
  });

  it("skill > 0 when predictions beat baseline", () => {
    // Perfect predictions vs 50/50 base rate (baseline BS = 0.25)
    const r = computeBrierScore({
      predictions: [1, 0, 1, 0],
      outcomes: [1, 0, 1, 0],
    });
    expect(r.brierScore).toBeCloseTo(0, 6);
    expect(r.skillScore).toBeCloseTo(1, 6); // perfect skill
  });

  it("skill < 0 when predictions worse than baseline", () => {
    // Always 0.9 when base rate is 0.5
    const r = computeBrierScore({
      predictions: [0.9, 0.9, 0.9, 0.9],
      outcomes: [1, 0, 1, 0],
    });
    // BS = (0.01 + 0.81)/2 = 0.41; baseline BS (with default = baseRate = 0.5) = 0.25
    // skill = 1 - 0.41/0.25 < 0
    expect(r.skillScore).toBeLessThan(0);
  });

  it("respects custom baselineProbability", () => {
    const r = computeBrierScore({
      predictions: [0.5, 0.5, 0.5, 0.5],
      outcomes: [1, 0, 1, 0],
      baselineProbability: 0.5,
    });
    expect(r.baselineProbability).toBeCloseTo(0.5, 6);
  });
});

describe("computeBrierScore — base rate calculation", () => {
  it("computes base rate as sample mean of outcomes", () => {
    const r = computeBrierScore({
      predictions: [0.5, 0.5, 0.5, 0.5, 0.5],
      outcomes: [1, 1, 1, 0, 0],
    });
    expect(r.baseRate).toBeCloseTo(0.6, 6);
  });
});

describe("brierScoreToPayload", () => {
  it("emits stable shape", () => {
    const r = computeBrierScore({
      predictions: [0.7, 0.3, 0.9, 0.1],
      outcomes: [1, 0, 1, 0],
    });
    const p = brierScoreToPayload(r) as {
      kind: string;
      brierScore: number;
      classification: string;
      skillScore: number;
    };
    expect(p.kind).toBe("brier_score.computed");
    expect(p.classification).toBe("excellent");
    expect(p.skillScore).toBeGreaterThan(0);
  });
});
