import { describe, it, expect } from "bun:test";

import {
  isEffectiveNEnabled,
  computeEffectiveN,
  simpleEffectiveN,
  effectiveNToPayload,
  EFFECTIVE_N_FLAG_ENV,
} from "./effectiveN.ts";

describe("isEffectiveNEnabled", () => {
  it("respects the flag", () => {
    expect(isEffectiveNEnabled({})).toBe(false);
    expect(isEffectiveNEnabled({ [EFFECTIVE_N_FLAG_ENV]: "1" })).toBe(true);
    expect(isEffectiveNEnabled({ [EFFECTIVE_N_FLAG_ENV]: "true" })).toBe(true);
  });
});

const identity = (n: number): number[][] => {
  const m: number[][] = [];
  for (let i = 0; i < n; i++) {
    m.push(new Array(n).fill(0));
    m[i]![i] = 1;
  }
  return m;
};

const allOnes = (n: number): number[][] => {
  const m: number[][] = [];
  for (let i = 0; i < n; i++) m.push(new Array(n).fill(1));
  return m;
};

describe("computeEffectiveN — boundary cases", () => {
  it("empty input → zeros", () => {
    const r = computeEffectiveN({});
    expect(r.rawN).toBe(0);
    expect(r.effectiveN).toBe(0);
  });

  it("single signal → effectiveN = 1", () => {
    const r = computeEffectiveN({ correlationMatrix: [[1]] });
    expect(r.rawN).toBe(1);
    expect(r.effectiveN).toBe(1);
  });
});

describe("computeEffectiveN — orthogonal signals", () => {
  it("5 orthogonal signals → effectiveN ≈ 5", () => {
    const r = computeEffectiveN({ correlationMatrix: identity(5) });
    expect(r.rawN).toBe(5);
    expect(r.effectiveN).toBeCloseTo(5, 6);
    expect(r.averagePairwiseAbsCorr).toBe(0);
    expect(r.redundantPairs).toEqual([]);
  });

  it("12 orthogonal signals → effectiveN ≈ 12 (Gordon's chain scenario)", () => {
    const r = computeEffectiveN({ correlationMatrix: identity(12) });
    expect(r.effectiveN).toBeCloseTo(12, 6);
  });
});

describe("computeEffectiveN — perfectly correlated signals", () => {
  it("5 identical signals → effectiveN ≈ 1", () => {
    const r = computeEffectiveN({ correlationMatrix: allOnes(5) });
    expect(r.rawN).toBe(5);
    expect(r.effectiveN).toBeCloseTo(1, 5);
    expect(r.redundantPairs.length).toBe(10); // all 10 pairs flagged
  });
});

describe("computeEffectiveN — mixed correlation structure", () => {
  it("2 perfectly correlated + 1 independent → effectiveN = 1.8 (participation ratio)", () => {
    // Eigenvalues: 2, 1, 0 → participation = (3)² / (4 + 1 + 0) = 9/5 = 1.8
    const m = [
      [1.0, 1.0, 0.0],
      [1.0, 1.0, 0.0],
      [0.0, 0.0, 1.0],
    ];
    const r = computeEffectiveN({ correlationMatrix: m });
    expect(r.effectiveN).toBeCloseTo(1.8, 5);
  });

  it("2 highly correlated + 1 weakly correlated → effectiveN between 2 and 3", () => {
    const m = [
      [1.0, 0.9, 0.2],
      [0.9, 1.0, 0.2],
      [0.2, 0.2, 1.0],
    ];
    const r = computeEffectiveN({ correlationMatrix: m });
    expect(r.effectiveN).toBeGreaterThan(1.5);
    expect(r.effectiveN).toBeLessThan(3);
  });
});

describe("computeEffectiveN — redundant-pair detection", () => {
  it("flags pairs above threshold", () => {
    const m = [
      [1.0, 0.95, 0.1],
      [0.95, 1.0, 0.3],
      [0.1, 0.3, 1.0],
    ];
    const r = computeEffectiveN({
      correlationMatrix: m,
      labels: ["a", "b", "c"],
    });
    expect(r.redundantPairs.length).toBe(1);
    expect(r.redundantPairs[0]!.a).toBe("a");
    expect(r.redundantPairs[0]!.b).toBe("b");
    expect(r.redundantPairs[0]!.correlation).toBeCloseTo(0.95, 5);
  });

  it("respects custom threshold", () => {
    const m = [
      [1.0, 0.5, 0.6],
      [0.5, 1.0, 0.4],
      [0.6, 0.4, 1.0],
    ];
    const r = computeEffectiveN({
      correlationMatrix: m,
      redundantThreshold: 0.45,
    });
    expect(r.redundantPairs.length).toBe(2);
  });

  it("sorts redundant pairs by absolute correlation descending", () => {
    const m = [
      [1.0, 0.92, 0.99, 0.1],
      [0.92, 1.0, 0.85, 0.1],
      [0.99, 0.85, 1.0, 0.1],
      [0.1, 0.1, 0.1, 1.0],
    ];
    const r = computeEffectiveN({ correlationMatrix: m });
    expect(r.redundantPairs.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < r.redundantPairs.length; i++) {
      expect(Math.abs(r.redundantPairs[i - 1]!.correlation)).toBeGreaterThanOrEqual(
        Math.abs(r.redundantPairs[i]!.correlation),
      );
    }
  });

  it("handles negative correlations via absolute value", () => {
    // Eigenvalues: 1+0.9=1.9, 1-0.9=0.1 → participation = 4 / 3.62 ≈ 1.105
    const m = [
      [1.0, -0.9],
      [-0.9, 1.0],
    ];
    const r = computeEffectiveN({ correlationMatrix: m });
    expect(r.redundantPairs.length).toBe(1);
    expect(r.effectiveN).toBeCloseTo(1.105, 2);
    expect(r.effectiveN).toBeLessThan(1.2);
  });
});

describe("computeEffectiveN — raw signal series", () => {
  it("identical series → effectiveN ≈ 1", () => {
    const s = [1, 2, 3, 4, 5, 6, 7, 8];
    const r = computeEffectiveN({
      signals: [
        { signalId: "a", values: s },
        { signalId: "b", values: s },
        { signalId: "c", values: s },
      ],
    });
    expect(r.effectiveN).toBeCloseTo(1, 4);
  });

  it("independent random-ish series → effectiveN well above 1", () => {
    const r = computeEffectiveN({
      signals: [
        { signalId: "a", values: [1, 2, 3, 4, 5, 6, 7, 8] },
        { signalId: "b", values: [5, 1, 8, 2, 7, 3, 6, 4] },
        { signalId: "c", values: [3, 8, 1, 7, 2, 6, 5, 4] },
      ],
    });
    expect(r.effectiveN).toBeGreaterThan(1.5);
  });

  it("propagates signalId as labels", () => {
    const r = computeEffectiveN({
      signals: [
        { signalId: "momentum", values: [1, 2, 3, 4] },
        { signalId: "mean_reversion", values: [4, 3, 2, 1] },
      ],
    });
    expect(r.labels).toEqual(["momentum", "mean_reversion"]);
  });
});

describe("computeEffectiveN — reasoning verdicts", () => {
  it("orthogonal → well-diversified", () => {
    const r = computeEffectiveN({ correlationMatrix: identity(5) });
    expect(r.reasoning).toContain("well-diversified");
  });

  it("all correlated → high redundancy", () => {
    const r = computeEffectiveN({ correlationMatrix: allOnes(5) });
    expect(r.reasoning).toContain("high redundancy");
  });
});

describe("simpleEffectiveN", () => {
  it("zero correlation → N", () => {
    expect(simpleEffectiveN(10, 0)).toBe(10);
  });

  it("full correlation → 1", () => {
    expect(simpleEffectiveN(10, 1)).toBe(1);
  });

  it("half correlation → halfway between 1 and N", () => {
    const r = simpleEffectiveN(10, 0.5);
    expect(r).toBeGreaterThan(1);
    expect(r).toBeLessThan(10);
  });

  it("boundary: n=0 → 0", () => {
    expect(simpleEffectiveN(0, 0.5)).toBe(0);
  });

  it("boundary: n=1 → 1", () => {
    expect(simpleEffectiveN(1, 0.5)).toBe(1);
  });
});

describe("Gordon 12-primitive chain scenario", () => {
  it("realistic moderate-correlation chain → effectiveN < 12", () => {
    const n = 12;
    const m: number[][] = [];
    for (let i = 0; i < n; i++) {
      m.push(new Array(n).fill(0));
      m[i]![i] = 1;
      for (let j = 0; j < n; j++) {
        if (i !== j) m[i]![j] = 0.35 + (((i + j) % 5) * 0.05);
      }
    }
    // Symmetrize
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const avg = (m[i]![j]! + m[j]![i]!) / 2;
        m[i]![j] = avg;
        m[j]![i] = avg;
      }
    }
    const r = computeEffectiveN({ correlationMatrix: m });
    expect(r.effectiveN).toBeLessThan(12);
    expect(r.effectiveN).toBeGreaterThan(2);
  });
});

describe("effectiveNToPayload", () => {
  it("emits stable shape", () => {
    const r = computeEffectiveN({ correlationMatrix: identity(5) });
    const p = effectiveNToPayload(r) as { kind: string; effectiveN: number };
    expect(p.kind).toBe("effective_n.computed");
    expect(p.effectiveN).toBeCloseTo(5, 1);
  });
});
