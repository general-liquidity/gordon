import { describe, it, expect } from "bun:test";

import {
  decomposeReturns,
  formatDecomposition,
  decompositionToPayload,
} from "./performanceDecomposition.ts";

describe("decomposeReturns — Wright's worked example", () => {
  it("35% return decomposes to 24% beta + 6.4% factors + 4.6% alpha", () => {
    const r = decomposeReturns({
      totalReturn: 0.35,
      marketReturn: 0.2,
      marketBeta: 1.2,
      factors: [
        { factor: "sector", loading: 0.3, factorReturn: 0.08 },
        { factor: "momentum", loading: 0.5, factorReturn: 0.06 },
        { factor: "size", loading: 0.5, factorReturn: 0.02 },
      ],
    });
    expect(r.betaContribution).toBeCloseTo(0.24, 4);
    expect(r.factorTotal).toBeCloseTo(0.064, 4);
    expect(r.alpha).toBeCloseTo(0.046, 4);
  });
});

describe("decomposeReturns — verdict classification", () => {
  it("skill when alpha >50% of total", () => {
    const r = decomposeReturns({
      totalReturn: 0.2,
      marketReturn: 0.05,
      marketBeta: 1.0,
      factors: [],
    });
    expect(r.alpha).toBeCloseTo(0.15, 4);
    expect(r.verdict).toBe("skill");
  });

  it("leveraged_beta when beta dwarfs alpha (Archegos)", () => {
    const r = decomposeReturns({
      totalReturn: 1.0,
      marketReturn: 0.2,
      marketBeta: 5.0,
      factors: [{ factor: "momentum", loading: 0.2, factorReturn: 0.06 }],
    });
    expect(r.verdict).toBe("leveraged_beta");
  });

  it("factor_harvester when factor contributions exceed alpha", () => {
    const r = decomposeReturns({
      totalReturn: 0.2,
      marketReturn: 0.05,
      marketBeta: 0.5,
      factors: [
        { factor: "momentum", loading: 1.0, factorReturn: 0.1 },
        { factor: "value", loading: 1.0, factorReturn: 0.05 },
      ],
    });
    expect(r.verdict).toBe("factor_harvester");
  });

  it("noise when alpha is negligible", () => {
    const r = decomposeReturns({
      totalReturn: 0.0501,
      marketReturn: 0.05,
      marketBeta: 1.0,
      factors: [],
    });
    expect(r.verdict).toBe("noise");
  });
});

describe("decomposeReturns — Archegos scenario", () => {
  it("17,500% leveraged-beta run shows zero alpha verdict", () => {
    const r = decomposeReturns({
      totalReturn: 1.75,
      marketReturn: 0.3,
      marketBeta: 5.0,
      factors: [
        { factor: "momentum", loading: 0.3, factorReturn: 0.1 },
        { factor: "sector", loading: 0.5, factorReturn: 0.4 },
      ],
    });
    expect(r.alpha).toBeCloseTo(1.75 - 1.5 - 0.23, 3);
    expect(r.verdict).toBe("leveraged_beta");
  });
});

describe("formatDecomposition + decompositionToPayload", () => {
  it("formats and emits payload", () => {
    const r = decomposeReturns({
      totalReturn: 0.35,
      marketReturn: 0.2,
      marketBeta: 1.2,
      factors: [{ factor: "momentum", loading: 0.5, factorReturn: 0.06 }],
    });
    const out = formatDecomposition(r);
    expect(out).toContain("Decomposition");
    expect(out).toContain("Beta:");
    const p = decompositionToPayload(r) as { kind: string };
    expect(p.kind).toBe("performance_decomposition.computed");
  });
});
