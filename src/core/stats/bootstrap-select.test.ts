import { describe, expect, test } from "bun:test";
import {
  DEFAULT_ALPHA,
  counterUniform,
  defaultMeanBlockLength,
  iidBootstrapIndices,
  makeCounterStream,
  selectByBootstrapPercentile,
  stationaryBootstrapIndices,
} from "./bootstrap-select.ts";

// A path-dependent utility, which is what makes the in-sample winner distinguishable from the
// robust one: a run that breaches the ruin barrier stops trading and keeps its loss.
const RUIN_BARRIER = 0.93;

function barrieredReturn(series: readonly number[], indices: readonly number[]): number {
  let equity = 1;
  for (const i of indices) {
    equity *= 1 + series[i]!;
    if (equity < RUIN_BARRIER) return equity - 1;
  }
  return equity - 1;
}

interface Candidate {
  readonly name: string;
  readonly series: readonly number[];
}

const SAMPLE_SIZE = 40;

/** Small, steady gains every bar: never near the barrier, whatever order the bars arrive in. */
const ROBUST: Candidate = {
  name: "robust",
  series: Array.from({ length: SAMPLE_SIZE }, () => 0.006),
};

/**
 * Higher in-sample total return, but only because history dealt its losing bars LAST, after
 * thirty winners had built a cushion. Reorder the path and it is stopped out.
 */
const LUCKY: Candidate = {
  name: "lucky",
  series: Array.from({ length: SAMPLE_SIZE }, (_, i) => (i < 30 ? 0.027 : -0.05)),
};

function selectAcross(candidates: Candidate[], overrides: Record<string, unknown> = {}) {
  return selectByBootstrapPercentile<Candidate>({
    candidates,
    sampleSize: SAMPLE_SIZE,
    resamples: 400,
    seed: 7,
    label: (c) => c.name,
    evaluate: (c, indices) => barrieredReturn(c.series, indices),
    ...overrides,
  });
}

function lag1Autocorrelation(x: readonly number[]): number {
  const m = x.reduce((a, b) => a + b, 0) / x.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < x.length; i++) {
    den += (x[i]! - m) ** 2;
    if (i > 0) num += (x[i]! - m) * (x[i - 1]! - m);
  }
  return den === 0 ? 0 : num / den;
}

function correlation(x: readonly number[], y: readonly number[]): number {
  const n = x.length;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i]! - mx) * (y[i]! - my);
    sxx += (x[i]! - mx) ** 2;
    syy += (y[i]! - my) ** 2;
  }
  return sxx === 0 || syy === 0 ? 0 : sxy / Math.sqrt(sxx * syy);
}

/** Persistent AR(1) series: the kind of dependence a trading rule is actually trading. */
function autocorrelatedSeries(length: number, phi: number, seed: number): number[] {
  const draw = makeCounterStream(seed, 0);
  const out: number[] = [];
  let level = 0;
  for (let i = 0; i < length; i++) {
    level = phi * level + (draw() * 2 - 1);
    out.push(level);
  }
  return out;
}

describe("selectByBootstrapPercentile", () => {
  test("prefers the genuinely better parameter over the one that got lucky on the observed path", () => {
    const result = selectAcross([ROBUST, LUCKY]);

    expect(result.pointEstimateWinner.name).toBe("lucky");
    expect(result.selected.name).toBe("robust");
    expect(result.disagreesWithPointEstimate).toBe(true);

    const lucky = result.evidence.find((e) => e.label === "lucky")!;
    const robust = result.evidence.find((e) => e.label === "robust")!;
    expect(lucky.pointEstimate).toBeGreaterThan(robust.pointEstimate);
    expect(lucky.percentileUtility).toBeLessThan(robust.percentileUtility);
  });

  test("reports a wider point-estimate-to-percentile gap for the overfit candidate than the robust one", () => {
    const result = selectAcross([ROBUST, LUCKY]);
    const lucky = result.evidence.find((e) => e.label === "lucky")!;
    const robust = result.evidence.find((e) => e.label === "robust")!;

    expect(lucky.overfitGap).toBeGreaterThan(robust.overfitGap + 0.1);
    expect(robust.overfitGap).toBeCloseTo(0, 6);
    expect(lucky.spread).toBeGreaterThan(robust.spread);
    expect(result.warnings.some((w) => w.includes("lucky"))).toBe(true);
  });

  test("repeats exactly under the same seed and changes under a different one", () => {
    const first = selectAcross([ROBUST, LUCKY]);
    const repeat = selectAcross([ROBUST, LUCKY]);
    const reseeded = selectAcross([ROBUST, LUCKY], { seed: 20260819 });

    expect(repeat.evidence.map((e) => e.percentileUtility)).toEqual(
      first.evidence.map((e) => e.percentileUtility),
    );
    expect(repeat.evidence.map((e) => e.sortedUtilities)).toEqual(
      first.evidence.map((e) => e.sortedUtilities),
    );

    const luckyFirst = first.evidence.find((e) => e.label === "lucky")!;
    const luckyReseeded = reseeded.evidence.find((e) => e.label === "lucky")!;
    expect(luckyReseeded.sortedUtilities).not.toEqual(luckyFirst.sortedUtilities);
  });

  test("defaults to the mid-quantile and flags an alpha in the extreme lower tail", () => {
    expect(DEFAULT_ALPHA).toBe(0.5);

    const conservative = selectAcross([ROBUST, LUCKY], { alpha: 0.05 });
    expect(conservative.warnings.some((w) => w.includes("lower tail"))).toBe(true);

    const midQuantile = selectAcross([ROBUST, LUCKY], { alpha: 0.6 });
    expect(midQuantile.warnings.some((w) => w.includes("lower tail"))).toBe(false);
  });

  test("keeps a single candidate selectable and says the choice was uncontested", () => {
    const result = selectAcross([ROBUST]);

    expect(result.selected.name).toBe("robust");
    expect(result.disagreesWithPointEstimate).toBe(false);
    expect(result.warnings.some((w) => w.includes("single candidate"))).toBe(true);
  });

  test("survives a single observation and a zero-variance series without producing NaN", () => {
    const single = selectByBootstrapPercentile<number>({
      candidates: [1, 2],
      sampleSize: 1,
      resamples: 25,
      seed: 3,
      evaluate: (c, indices) => c * indices.length,
    });
    for (const e of single.evidence) {
      expect(Number.isFinite(e.percentileUtility)).toBe(true);
      expect(Number.isFinite(e.overfitGap)).toBe(true);
      expect(e.spread).toBe(0);
      expect(e.stdDev).toBe(0);
    }
    expect(single.selected).toBe(2);
    expect(single.warnings.some((w) => w.includes("sampleSize below 2"))).toBe(true);

    const flat = Array.from({ length: 30 }, () => 0.01);
    const constant = selectByBootstrapPercentile<readonly number[]>({
      candidates: [flat],
      sampleSize: flat.length,
      resamples: 50,
      seed: 3,
      evaluate: (series, indices) =>
        indices.reduce((a, i) => a + series[i]!, 0) / indices.length,
    });
    const evidence = constant.evidence[0]!;
    expect(evidence.stdDev).toBeCloseTo(0, 12);
    expect(evidence.spread).toBeCloseTo(0, 12);
    expect(evidence.overfitGap).toBeCloseTo(0, 12);
    expect(Number.isNaN(evidence.percentileUtility)).toBe(false);
  });

  test("rejects an empty candidate set, a non-positive sample size and an out-of-range alpha", () => {
    const base = {
      sampleSize: 10,
      evaluate: () => 1,
    };
    expect(() => selectByBootstrapPercentile({ ...base, candidates: [] })).toThrow(
      /at least one candidate/,
    );
    expect(() =>
      selectByBootstrapPercentile({ ...base, candidates: ["a"], sampleSize: 0 }),
    ).toThrow(/positive integer/);
    expect(() =>
      selectByBootstrapPercentile({ ...base, candidates: ["a"], alpha: 1.5 }),
    ).toThrow(/\[0, 1\]/);
  });

  test("stamps the result only from an injected clock", () => {
    expect(selectAcross([ROBUST]).generatedAtMs).toBeNull();
    expect(selectAcross([ROBUST], { clock: () => 1_700_000_000_000 }).generatedAtMs).toBe(
      1_700_000_000_000,
    );
  });

  test("reads no clock and touches no I/O", async () => {
    const source = await Bun.file(new URL("./bootstrap-select.ts", import.meta.url)).text();
    expect(source).not.toContain("Date.now");
    expect(source).not.toContain("Math.random");
    expect(source).not.toContain("process.env");
    expect(source).not.toContain("node:fs");
    expect(source).not.toContain("fetch(");
  });
});

describe("dependence-preserving resampling", () => {
  test("retains the autocorrelation that an IID shuffle destroys", () => {
    const series = autocorrelatedSeries(400, 0.85, 99);
    const observed = lag1Autocorrelation(series);
    expect(observed).toBeGreaterThan(0.7);

    const runs = 60;
    let blockAcf = 0;
    let iidAcf = 0;
    for (let s = 0; s < runs; s++) {
      const blockIdx = stationaryBootstrapIndices(
        series.length,
        series.length,
        20,
        makeCounterStream(5, s),
      );
      const iidIdx = iidBootstrapIndices(series.length, series.length, 20, makeCounterStream(5, s));
      blockAcf += lag1Autocorrelation(blockIdx.map((i) => series[i]!));
      iidAcf += lag1Autocorrelation(iidIdx.map((i) => series[i]!));
    }
    blockAcf /= runs;
    iidAcf /= runs;

    expect(blockAcf).toBeGreaterThan(0.7 * observed);
    expect(Math.abs(iidAcf)).toBeLessThan(0.1);
    expect(blockAcf - iidAcf).toBeGreaterThan(0.5);
  });

  test("draws every series of a multi-asset objective from one shared index vector, so a correlated pair stays correlated", () => {
    const assetA = autocorrelatedSeries(200, 0.6, 11);
    const assetB = assetA.map((v, i) => 0.9 * v + 0.1 * (i % 7) - 0.3);
    const observedCorrelation = correlation(assetA, assetB);
    expect(observedCorrelation).toBeGreaterThan(0.9);

    const indices = stationaryBootstrapIndices(
      assetA.length,
      assetA.length,
      15,
      makeCounterStream(42, 0),
    );
    const resampled = correlation(
      indices.map((i) => assetA[i]!),
      indices.map((i) => assetB[i]!),
    );
    expect(resampled).toBeGreaterThan(observedCorrelation - 0.05);

    // The selector must hand the SAME vector to every series inside one evaluation, otherwise a
    // portfolio objective would see a mean and a covariance drawn from different histories.
    const correlationsSeen: number[] = [];
    selectByBootstrapPercentile<null>({
      candidates: [null],
      sampleSize: assetA.length,
      resamples: 30,
      seed: 4,
      evaluate: (_c, idx) => {
        correlationsSeen.push(
          correlation(
            idx.map((i) => assetA[i]!),
            idx.map((i) => assetB[i]!),
          ),
        );
        return 0;
      },
    });
    expect(correlationsSeen.length).toBe(31);
    expect(Math.min(...correlationsSeen)).toBeGreaterThan(0.85);
  });

  test("draws uniforms reproducible from their coordinates alone, without replaying the stream", () => {
    const stream = makeCounterStream(123, 9);
    const drawn = [stream(), stream(), stream()];
    expect(drawn).toEqual([
      counterUniform(123, 9, 0),
      counterUniform(123, 9, 1),
      counterUniform(123, 9, 2),
    ]);
    for (const u of drawn) {
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
    }
    expect(counterUniform(123, 9, 0)).not.toBe(counterUniform(124, 9, 0));
  });

  test("stays inside the observation range for every sample size, including one", () => {
    for (const n of [1, 2, 7, 50]) {
      const idx = stationaryBootstrapIndices(n, 25, defaultMeanBlockLength(n), makeCounterStream(1, n));
      expect(idx.length).toBe(25);
      expect(Math.min(...idx)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...idx)).toBeLessThan(n);
    }
  });
});
