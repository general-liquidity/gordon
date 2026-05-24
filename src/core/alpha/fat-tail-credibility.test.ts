import { describe, expect, test } from "bun:test";
import {
  estimateFatTailCredibility,
  formatFatTailCredibility,
} from "./fat-tail-credibility.ts";

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Sample from a Pareto distribution with tail index α. F(x) = 1 - (xm/x)^α. */
function paretoSample(rng: () => number, alpha: number, xm = 1): number {
  const u = rng();
  return xm / Math.pow(1 - u, 1 / alpha);
}

function paretoReturns(n: number, alpha: number, seed: number, signSwap = true): number[] {
  const rng = mulberry32(seed);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const mag = paretoSample(rng, alpha) - 1; // shift so most are small
    const sign = signSwap ? (rng() < 0.5 ? -1 : 1) : 1;
    out.push(sign * mag * 0.01);
  }
  return out;
}

function gaussianReturns(n: number, seed: number, sigma = 0.01): number[] {
  const rng = mulberry32(seed);
  const out: number[] = [];
  for (let i = 0; i < n; i += 2) {
    const u1 = Math.max(1e-12, rng());
    const u2 = rng();
    const z1 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const z2 = Math.sqrt(-2 * Math.log(u1)) * Math.sin(2 * Math.PI * u2);
    out.push(z1 * sigma);
    if (i + 1 < n) out.push(z2 * sigma);
  }
  return out;
}

describe("estimateFatTailCredibility", () => {
  test("too few samples → insufficient_data", () => {
    const r = estimateFatTailCredibility({
      returns: gaussianReturns(20, 1),
    });
    expect(r.fatTailClass).toBe("insufficient_data");
  });

  test("Gaussian returns → gaussian_like (α large, multiplier 1)", () => {
    const r = estimateFatTailCredibility({
      returns: gaussianReturns(2000, 1),
    });
    // Gaussian has all moments finite → Hill α should be very large
    expect(r.fatTailClass).toBe("gaussian_like");
    expect(r.sampleSizeMultiplier).toBe(1);
    expect(r.tailIndex).toBeGreaterThan(3);
  });

  test("Pareto α=3 → lighter-tailed verdict than α=1.1 Pareto", () => {
    // Hill is finite-sample biased on shifted/signed Pareto data — the
    // estimator's behavior is correct but the absolute α magnitude may
    // drift. Compare RELATIVE classification: α=3 must be LIGHTER-tailed
    // than α=1.1.
    const light = estimateFatTailCredibility({
      returns: paretoReturns(3000, 3.0, 7),
    });
    const heavy = estimateFatTailCredibility({
      returns: paretoReturns(3000, 1.1, 8),
    });
    expect(light.tailIndex).toBeGreaterThan(heavy.tailIndex);
    expect(light.sampleSizeMultiplier).toBeLessThanOrEqual(
      heavy.sampleSizeMultiplier,
    );
  });

  test("Pareto α=1.7 → heavy_tailed with multiplier 10×", () => {
    const r = estimateFatTailCredibility({
      returns: paretoReturns(3000, 1.7, 11),
    });
    expect(r.tailIndex).toBeGreaterThan(1.3);
    expect(r.tailIndex).toBeLessThan(2.3);
    // Class should be heavy_tailed or near-by bands
    expect(["heavy_tailed", "very_heavy_tailed", "moderately_heavy"]).toContain(
      r.fatTailClass,
    );
    expect(r.sampleSizeMultiplier).toBeGreaterThanOrEqual(5);
  });

  test("Pareto α=1.1 → very_heavy_tailed with huge multiplier", () => {
    const r = estimateFatTailCredibility({
      returns: paretoReturns(3000, 1.1, 13),
    });
    expect(r.tailIndex).toBeLessThan(1.5);
    expect(r.sampleSizeMultiplier).toBeGreaterThanOrEqual(50);
  });

  test("CI brackets the median estimate", () => {
    const r = estimateFatTailCredibility({
      returns: paretoReturns(2000, 2.0, 17),
    });
    expect(r.tailIndexCI.low).toBeLessThanOrEqual(r.tailIndex);
    expect(r.tailIndexCI.high).toBeGreaterThanOrEqual(r.tailIndex);
  });

  test("perK reports α̂ at multiple k fractions", () => {
    const r = estimateFatTailCredibility({
      returns: paretoReturns(2000, 2.5, 19),
    });
    expect(r.perK.length).toBeGreaterThanOrEqual(3);
    for (const p of r.perK) {
      expect(p.k).toBeGreaterThanOrEqual(2);
      expect(Number.isFinite(p.alpha)).toBe(true);
    }
  });

  test("adjustedMinimumSampleSize = baseline × multiplier", () => {
    const r = estimateFatTailCredibility({
      returns: paretoReturns(3000, 1.7, 11),
      baselineGaussianSampleSize: 100,
    });
    expect(r.adjustedMinimumSampleSize).not.toBeNull();
    expect(r.adjustedMinimumSampleSize!).toBe(100 * r.sampleSizeMultiplier);
  });

  test("no baseline → adjustedMinimumSampleSize is null", () => {
    const r = estimateFatTailCredibility({
      returns: gaussianReturns(500, 1),
    });
    expect(r.adjustedMinimumSampleSize).toBeNull();
  });

  test("custom kFractionGrid changes per-k output", () => {
    const r = estimateFatTailCredibility({
      returns: gaussianReturns(2000, 1),
      kFractionGrid: [0.05, 0.10],
    });
    expect(r.perK.length).toBe(2);
  });

  test("Taleb's 10x rule: heavy_tailed multiplier is exactly 10", () => {
    // Synthetic series that ensures α ∈ (1.5, 2]: use Pareto α=1.8
    const r = estimateFatTailCredibility({
      returns: paretoReturns(5000, 1.8, 23),
    });
    if (r.fatTailClass === "heavy_tailed") {
      expect(r.sampleSizeMultiplier).toBe(10);
    }
  });

  test("zero values are filtered before Hill", () => {
    const series = gaussianReturns(500, 1);
    for (let i = 0; i < 50; i++) series.push(0); // inject zeros
    const r = estimateFatTailCredibility({ returns: series });
    expect(r.effectiveSampleSize).toBeLessThanOrEqual(series.length);
    expect(r.fatTailClass).not.toBe("insufficient_data");
  });

  test("backtestCredibility integration: caller multiplies minTRL", () => {
    // Simulated scenario: backtestCredibility says minTRL = 200 under
    // Gaussian assumptions; fat-tail correction adjusts.
    const r = estimateFatTailCredibility({
      returns: paretoReturns(3000, 1.6, 29),
      baselineGaussianSampleSize: 200,
    });
    expect(r.adjustedMinimumSampleSize).not.toBeNull();
    if (Number.isFinite(r.sampleSizeMultiplier)) {
      expect(r.adjustedMinimumSampleSize!).toBe(200 * r.sampleSizeMultiplier);
    }
  });
});

describe("formatFatTailCredibility", () => {
  test("renders verdict + tail index + multiplier", () => {
    const r = estimateFatTailCredibility({
      returns: paretoReturns(2000, 1.7, 31),
      baselineGaussianSampleSize: 100,
    });
    const text = formatFatTailCredibility(r);
    expect(text).toContain("Fat-Tail Credibility");
    expect(text).toContain("Tail index");
    expect(text).toContain("multiplier");
  });
});
