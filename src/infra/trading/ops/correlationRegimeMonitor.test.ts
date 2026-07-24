import { describe, it, expect } from "bun:test";

import {
  evaluateCorrelationRegime,
  computeCorrelationMatrix,
  correlationToPayload,
} from "./correlationRegimeMonitor.ts";

describe("evaluateCorrelationRegime — diverse", () => {
  it("low average → diverse, diversification intact", () => {
    const r = evaluateCorrelationRegime({
      correlations: [
        [1.0, 0.1, 0.2],
        [0.1, 1.0, 0.15],
        [0.2, 0.15, 1.0],
      ],
    });
    expect(r.regime).toBe("diverse");
    expect(r.diversificationLost).toBe(false);
  });
});

describe("evaluateCorrelationRegime — elevated", () => {
  it("moderate correlations → elevated, partial diversification", () => {
    const r = evaluateCorrelationRegime({
      correlations: [
        [1.0, 0.55, 0.65],
        [0.55, 1.0, 0.60],
        [0.65, 0.60, 1.0],
      ],
    });
    expect(r.regime).toBe("elevated");
    expect(r.diversificationLost).toBe(false);
  });
});

describe("evaluateCorrelationRegime — crisis", () => {
  it("high correlations across the board → crisis", () => {
    const r = evaluateCorrelationRegime({
      correlations: [
        [1.0, 0.85, 0.90],
        [0.85, 1.0, 0.80],
        [0.90, 0.80, 1.0],
      ],
    });
    expect(r.regime).toBe("crisis");
    expect(r.diversificationLost).toBe(true);
    expect(r.reason).toContain("collapsed");
  });

  it("near-perfect pair flag fires at |r| > 0.95", () => {
    const r = evaluateCorrelationRegime({
      correlations: [
        [1.0, 0.97, 0.20],
        [0.97, 1.0, 0.15],
        [0.20, 0.15, 1.0],
      ],
    });
    expect(r.hasNearPerfectPair).toBe(true);
  });
});

describe("evaluateCorrelationRegime — edge cases", () => {
  it("single asset → diverse, dormant", () => {
    const r = evaluateCorrelationRegime({ correlations: [[1.0]] });
    expect(r.regime).toBe("diverse");
    expect(r.averagePairwise).toBe(0);
  });

  it("handles negative correlations via absolute value", () => {
    const r = evaluateCorrelationRegime({
      correlations: [
        [1.0, -0.9],
        [-0.9, 1.0],
      ],
    });
    expect(r.regime).toBe("crisis");
    expect(r.hasNearPerfectPair).toBe(false);
  });
});

describe("computeCorrelationMatrix", () => {
  it("identical series have r=1", () => {
    const s = [1, 2, 3, 4, 5, 6, 7, 8];
    const m = computeCorrelationMatrix([s, s]);
    expect(m[0]![1]).toBeCloseTo(1, 5);
  });

  it("opposite series have r=-1", () => {
    const a = [1, 2, 3, 4, 5];
    const b = [5, 4, 3, 2, 1];
    const m = computeCorrelationMatrix([a, b]);
    expect(m[0]![1]).toBeCloseTo(-1, 5);
  });

  it("constant series produce r=0 (zero stddev guard)", () => {
    const a = [1, 2, 3, 4, 5];
    const b = [7, 7, 7, 7, 7];
    const m = computeCorrelationMatrix([a, b]);
    expect(m[0]![1]).toBe(0);
  });
});

describe("Wright Ch 14 60/40 obituary scenario", () => {
  it("stock-bond correlation flip from negative to positive flags crisis", () => {
    const r = evaluateCorrelationRegime({
      correlations: [
        [1.0, 0.78],
        [0.78, 1.0],
      ],
    });
    expect(r.regime).toBe("crisis");
  });
});

describe("correlationToPayload", () => {
  it("emits stable shape", () => {
    const r = evaluateCorrelationRegime({
      correlations: [
        [1.0, 0.85],
        [0.85, 1.0],
      ],
    });
    const p = correlationToPayload(r) as { kind: string; regime: string };
    expect(p.kind).toBe("correlation_regime.evaluated");
    expect(p.regime).toBe("crisis");
  });
});
