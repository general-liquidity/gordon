import { describe, it, expect } from "bun:test";

import {
  isPcaConcentrationEnabled,
  computePcaConcentration,
  pcaConcentrationToPayload,
  PCA_CONCENTRATION_FLAG_ENV,
  type ReturnSeries,
} from "./pcaConcentration.ts";

describe("isPcaConcentrationEnabled", () => {
  it("respects the flag", () => {
    expect(isPcaConcentrationEnabled({})).toBe(false);
    expect(isPcaConcentrationEnabled({ [PCA_CONCENTRATION_FLAG_ENV]: "1" })).toBe(true);
  });
});

function lcg(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function randn(rng: () => number) {
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function independentSeries(n: number, T: number, sigma: number, seed: number): ReturnSeries[] {
  const rng = lcg(seed);
  return Array.from({ length: n }, (_, i) => ({
    strategyId: `s${i}`,
    returns: Array.from({ length: T }, () => randn(rng) * sigma),
  }));
}

/** Generate n strategies that all load on a hidden factor F. */
function factorLoadedSeries(
  n: number,
  T: number,
  factorBeta: number,
  idioSigma: number,
  seed: number,
): ReturnSeries[] {
  const rng = lcg(seed);
  const factor = Array.from({ length: T }, () => randn(rng));
  return Array.from({ length: n }, (_, i) => ({
    strategyId: `f${i}`,
    returns: factor.map((f) => factorBeta * f + randn(rng) * idioSigma),
  }));
}

describe("computePcaConcentration — edge cases", () => {
  it("0 or 1 strategy → diverse, undefined", () => {
    expect(computePcaConcentration({ series: [] }).verdict).toBe("diverse");
    expect(computePcaConcentration({ series: [{ strategyId: "a", returns: [0.1, 0.2] }] }).verdict).toBe("diverse");
  });

  it("too-short series → diverse + reason mentions length", () => {
    const r = computePcaConcentration({
      series: [
        { strategyId: "a", returns: [0.1] },
        { strategyId: "b", returns: [0.2] },
      ],
    });
    expect(r.verdict).toBe("diverse");
    expect(r.reasoning).toContain("short");
  });
});

describe("computePcaConcentration — diverse book", () => {
  it("uncorrelated strategies → PC1 < 0.5, verdict=diverse", () => {
    const series = independentSeries(6, 500, 1, 42);
    const r = computePcaConcentration({ series });
    expect(r.verdict).toBe("diverse");
    expect(r.pc1ExplainedRatio).toBeLessThan(0.5);
    expect(r.nForCumulativeTarget).toBeGreaterThan(1);
  });
});

describe("computePcaConcentration — concentrated book", () => {
  it("strong hidden factor → critical verdict", () => {
    const series = factorLoadedSeries(6, 500, 1.0, 0.1, 7);
    const r = computePcaConcentration({ series });
    expect(r.verdict).toBe("critical");
    expect(r.pc1ExplainedRatio).toBeGreaterThan(0.75);
  });

  it("moderate hidden factor → concentrated verdict", () => {
    const series = factorLoadedSeries(6, 500, 1.0, 0.7, 11);
    const r = computePcaConcentration({ series });
    expect(["concentrated", "critical"]).toContain(r.verdict);
    expect(r.pc1ExplainedRatio).toBeGreaterThan(0.4);
  });

  it("highly correlated strategies appear as high-corr pairs", () => {
    const series = factorLoadedSeries(4, 500, 1.0, 0.1, 13);
    const r = computePcaConcentration({ series });
    expect(r.highCorrelationPairs.length).toBeGreaterThan(0);
  });
});

describe("computePcaConcentration — top loadings", () => {
  it("strategies loaded on the factor appear in pc1TopLoadings", () => {
    const series = factorLoadedSeries(5, 500, 1.0, 0.05, 17);
    const r = computePcaConcentration({ series });
    expect(r.pc1TopLoadings.length).toBeGreaterThan(0);
    // All loadings should be roughly similar in magnitude (all load on same factor)
    const magnitudes = r.pc1TopLoadings.map((l) => Math.abs(l.loading));
    const maxMag = Math.max(...magnitudes);
    const minMag = Math.min(...magnitudes);
    expect(minMag / maxMag).toBeGreaterThan(0.5);
  });
});

describe("computePcaConcentration — explained variance properties", () => {
  it("ratios sum to 1, cumulative ends at 1", () => {
    const series = independentSeries(4, 300, 1, 23);
    const r = computePcaConcentration({ series });
    const sum = r.explainedVarianceRatios.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 5);
    expect(r.cumulativeExplained[r.cumulativeExplained.length - 1]!).toBeCloseTo(1, 5);
  });

  it("eigenvalues are non-negative and sorted descending", () => {
    const series = independentSeries(5, 300, 1, 29);
    const r = computePcaConcentration({ series });
    for (let i = 0; i < r.eigenvalues.length; i++) {
      expect(r.eigenvalues[i]!).toBeGreaterThanOrEqual(0);
      if (i > 0) expect(r.eigenvalues[i]!).toBeLessThanOrEqual(r.eigenvalues[i - 1]!);
    }
  });
});

describe("computePcaConcentration — custom thresholds", () => {
  it("tighter concentrated threshold flags borderline cases", () => {
    const series = factorLoadedSeries(4, 300, 1.0, 1.0, 31);
    const lax = computePcaConcentration({ series });
    const strict = computePcaConcentration({ series, concentratedThreshold: 0.25 });
    expect(strict.pc1ExplainedRatio).toBe(lax.pc1ExplainedRatio);
    // Strict threshold should flag at least as often
    if (lax.verdict === "diverse") {
      expect(["concentrated", "critical"]).toContain(strict.verdict);
    }
  });
});

describe("pcaConcentrationToPayload", () => {
  it("emits stable shape", () => {
    const series = independentSeries(3, 100, 1, 37);
    const r = computePcaConcentration({ series });
    const p = pcaConcentrationToPayload(r) as { kind: string; verdict: string };
    expect(p.kind).toBe("pca_concentration.evaluated");
    expect(["diverse", "concentrated", "critical"]).toContain(p.verdict);
  });
});
