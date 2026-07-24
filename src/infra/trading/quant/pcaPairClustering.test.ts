import { describe, it, expect } from "bun:test";
import {
  computePcaPairClustering,
  pcaPairClusteringToPayload,
} from "./pcaPairClustering.ts";

// Deterministic seeded RNG for reproducible test data
function makeRng(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function gaussian(rng: () => number): number {
  const u1 = Math.max(1e-12, rng());
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

describe("computePcaPairClustering — basic clustering", () => {
  it("two visibly separated groups → at least one cluster", () => {
    // Group A: assets driven by factor 1
    // Group B: assets driven by factor 2
    // Both factors uncorrelated.
    const rng = makeRng(42);
    const T = 100;
    const factor1 = Array.from({ length: T }, () => gaussian(rng));
    const factor2 = Array.from({ length: T }, () => gaussian(rng));
    const returns: number[][] = [];
    // 4 assets each driven by factor1 + small idio noise
    for (let i = 0; i < 4; i++) {
      const r = factor1.map((f) => f + 0.1 * gaussian(rng));
      returns.push(r);
    }
    // 4 assets each driven by factor2
    for (let i = 0; i < 4; i++) {
      const r = factor2.map((f) => f + 0.1 * gaussian(rng));
      returns.push(r);
    }
    const r = computePcaPairClustering({
      returns,
      epsilon: 0.8,
      minPoints: 2,
      numComponents: 2,
    });
    expect(r.clusterCount).toBeGreaterThanOrEqual(1);
    expect(r.candidatePairs.length).toBeGreaterThan(0);
  });

  it("candidate pair count < all-pairs combinatorial", () => {
    const rng = makeRng(7);
    const T = 80;
    const factor = Array.from({ length: T }, () => gaussian(rng));
    const returns: number[][] = [];
    for (let i = 0; i < 6; i++) {
      returns.push(factor.map((f) => f + 0.05 * gaussian(rng)));
    }
    for (let i = 0; i < 6; i++) {
      returns.push(Array.from({ length: T }, () => gaussian(rng)));
    }
    const r = computePcaPairClustering({
      returns,
      epsilon: 0.5,
      minPoints: 3,
      numComponents: 2,
    });
    const N = returns.length;
    const allPairs = (N * (N - 1)) / 2;
    expect(r.candidatePairs.length).toBeLessThan(allPairs);
  });

  it("noise points have label = −1", () => {
    const rng = makeRng(13);
    const T = 60;
    // 3 tight cluster + 1 outlier
    const factor = Array.from({ length: T }, () => gaussian(rng));
    const returns: number[][] = [];
    for (let i = 0; i < 3; i++) {
      returns.push(factor.map((f) => f + 0.02 * gaussian(rng)));
    }
    returns.push(Array.from({ length: T }, () => gaussian(rng))); // outlier
    const r = computePcaPairClustering({
      returns,
      epsilon: 0.3,
      minPoints: 3,
      numComponents: 2,
    });
    // Outlier (index 3) likely flagged as noise
    expect(r.clusterLabels[3]).toBe(-1);
    expect(r.noiseCount).toBeGreaterThanOrEqual(1);
  });

  it("symbols round-trip through candidatePairSymbols", () => {
    const rng = makeRng(99);
    const T = 50;
    const factor = Array.from({ length: T }, () => gaussian(rng));
    const returns: number[][] = [
      factor.map((f) => f + 0.05 * gaussian(rng)),
      factor.map((f) => f + 0.05 * gaussian(rng)),
      factor.map((f) => f + 0.05 * gaussian(rng)),
    ];
    const symbols = ["AAPL", "MSFT", "GOOGL"];
    const r = computePcaPairClustering({
      returns,
      symbols,
      epsilon: 0.5,
      minPoints: 2,
      numComponents: 1,
    });
    if (r.candidatePairs.length > 0) {
      const [i, j] = r.candidatePairs[0]!;
      expect(r.candidatePairSymbols).not.toBeNull();
      expect(r.candidatePairSymbols![0]).toEqual([symbols[i]!, symbols[j]!]);
    }
  });
});

describe("computePcaPairClustering — variance explained", () => {
  it("varianceExplained ∈ [0, 1]", () => {
    const rng = makeRng(33);
    const T = 100;
    const returns = Array.from({ length: 5 }, () =>
      Array.from({ length: T }, () => gaussian(rng)),
    );
    const r = computePcaPairClustering({
      returns,
      epsilon: 1,
      minPoints: 2,
      numComponents: 2,
    });
    expect(r.varianceExplained).toBeGreaterThanOrEqual(0);
    expect(r.varianceExplained).toBeLessThanOrEqual(1.0000001);
  });

  it("using all components explains 100% of variance", () => {
    const rng = makeRng(55);
    const T = 100;
    const N = 4;
    const returns = Array.from({ length: N }, () =>
      Array.from({ length: T }, () => gaussian(rng)),
    );
    const r = computePcaPairClustering({
      returns,
      epsilon: 1,
      minPoints: 2,
      numComponents: N,
    });
    expect(r.varianceExplained).toBeCloseTo(1, 6);
  });
});

describe("computePcaPairClustering — validation", () => {
  it("throws on < 2 assets", () => {
    expect(() =>
      computePcaPairClustering({
        returns: [[0.01, 0.02]],
        epsilon: 1,
      }),
    ).toThrow();
  });

  it("throws on short series (T < 2)", () => {
    expect(() =>
      computePcaPairClustering({
        returns: [[0.01], [0.02]],
        epsilon: 1,
      }),
    ).toThrow();
  });

  it("throws on mismatched series lengths", () => {
    expect(() =>
      computePcaPairClustering({
        returns: [
          [0.01, 0.02, 0.03],
          [0.04, 0.05],
        ],
        epsilon: 1,
      }),
    ).toThrow();
  });

  it("throws on symbols length mismatch", () => {
    expect(() =>
      computePcaPairClustering({
        returns: [
          [0.01, 0.02],
          [0.03, 0.04],
        ],
        symbols: ["A"],
        epsilon: 1,
      }),
    ).toThrow();
  });

  it("throws on non-positive epsilon", () => {
    expect(() =>
      computePcaPairClustering({
        returns: [
          [0.01, 0.02],
          [0.03, 0.04],
        ],
        epsilon: 0,
      }),
    ).toThrow();
  });

  it("throws when numComponents > Berkhin bound (15)", () => {
    const N = 20;
    const T = 30;
    const rng = makeRng(1);
    const returns = Array.from({ length: N }, () =>
      Array.from({ length: T }, () => gaussian(rng)),
    );
    expect(() =>
      computePcaPairClustering({
        returns,
        epsilon: 1,
        numComponents: 16,
      }),
    ).toThrow();
  });
});

describe("pcaPairClusteringToPayload", () => {
  it("emits stable shape", () => {
    const rng = makeRng(101);
    const T = 50;
    const returns = Array.from({ length: 3 }, () =>
      Array.from({ length: T }, () => gaussian(rng)),
    );
    const r = computePcaPairClustering({
      returns,
      epsilon: 1,
      minPoints: 2,
      numComponents: 2,
    });
    const p = pcaPairClusteringToPayload(r) as { kind: string };
    expect(p.kind).toBe("pca_pair_clustering.computed");
  });
});
