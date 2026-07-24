/**
 * Stationary Bootstrap Fragility Test (GORDON_STATIONARY_BOOTSTRAP).
 *
 * Quantifies how fragile a strategy's reported performance is to the
 * specific historical sample it was tested on. Politis & Romano (1994)
 * block bootstrap: resample geometric-length blocks of returns to
 * generate B synthetic histories, evaluate the strategy metric on each,
 * report confidence bands.
 *
 * Distinct from Gordon's existing walk-forward (which uses time-ordered
 * out-of-sample windows): bootstrap measures parameter fragility under
 * a shuffled history, not the strategy's ability to generalize forward
 * through time. The two are complementary diagnostics.
 *
 * Output is a confidence band on the chosen metric (typically Sharpe,
 * profit factor, or max drawdown). A strategy whose realized metric
 * sits near the median of the bootstrap distribution is robust; one
 * whose realized metric is at an extreme of its bootstrap distribution
 * is fragile and probably overfit.
 *
 *   - Geometric block length ~ 1 / p, where p is the random "block
 *     reset" probability per step. Default p = 0.1 (mean block ~10).
 *   - Stationary block resampling preserves the marginal distribution
 *     and short-range autocorrelation of the return series.
 *   - The realized metric's percentile within the bootstrap distribution
 *     is the most useful fragility readout.
 */

export interface BootstrapInput {
  /** Period-by-period strategy returns (decimals, e.g. 0.012 = +1.2%). */
  returns: ReadonlyArray<number>;
  /** Number of bootstrap resamples. Default 500. */
  resamples?: number;
  /** Block reset probability per step. Default 0.1 (mean block ~10 obs). */
  blockResetProbability?: number;
  /** Optional deterministic seed for reproducibility. Default Date.now(). */
  seed?: number;
  /** Periods per year for annualization. Default 252. */
  periodsPerYear?: number;
}

export interface MetricBand {
  /** Median across the bootstrap distribution. */
  median: number;
  /** 5th percentile. */
  ci05: number;
  /** 25th percentile. */
  ci25: number;
  /** 75th percentile. */
  ci75: number;
  /** 95th percentile. */
  ci95: number;
}

export interface BootstrapResult {
  /** Realized metric on the original (un-resampled) series. */
  realizedSharpe: number;
  realizedMeanReturn: number;
  realizedMaxDrawdown: number;
  /** Bootstrap distributions per metric. */
  sharpeBand: MetricBand;
  meanReturnBand: MetricBand;
  maxDrawdownBand: MetricBand;
  /** Percentile of the realized Sharpe within the bootstrap distribution
   *  (0..1). Values near 0.5 = robust; values near 0 or 1 = fragile. */
  sharpePercentile: number;
  /** Verdict on fragility based on the Sharpe percentile. */
  verdict: "robust" | "borderline" | "fragile";
  resamples: number;
  sampleSize: number;
  reasoning: string;
}

const DEFAULT_RESAMPLES = 500;
const DEFAULT_BLOCK_PROB = 0.1;
const DEFAULT_PPY = 252;
const ROBUST_PCT_RANGE: [number, number] = [0.25, 0.75];
const BORDERLINE_PCT_RANGE: [number, number] = [0.1, 0.9];

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function sharpe(returns: ReadonlyArray<number>, ppy: number): number {
  if (returns.length < 2) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  let ss = 0;
  for (const r of returns) ss += (r - mean) * (r - mean);
  const stdev = Math.sqrt(ss / (returns.length - 1));
  if (stdev === 0) return 0;
  return (mean / stdev) * Math.sqrt(ppy);
}

function maxDrawdown(returns: ReadonlyArray<number>): number {
  let equity = 1;
  let peak = 1;
  let mdd = 0;
  for (const r of returns) {
    equity *= 1 + r;
    if (equity > peak) peak = equity;
    const dd = (equity - peak) / peak;
    if (dd < mdd) mdd = dd;
  }
  return mdd;
}

function mean(values: ReadonlyArray<number>): number {
  if (values.length === 0) return 0;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

function quantile(sorted: ReadonlyArray<number>, q: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(sorted.length - 1, lo + 1);
  const frac = pos - lo;
  return sorted[lo]! * (1 - frac) + sorted[hi]! * frac;
}

function buildBand(values: number[]): MetricBand {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    median: quantile(sorted, 0.5),
    ci05: quantile(sorted, 0.05),
    ci25: quantile(sorted, 0.25),
    ci75: quantile(sorted, 0.75),
    ci95: quantile(sorted, 0.95),
  };
}

function resample(
  returns: ReadonlyArray<number>,
  blockProb: number,
  rng: () => number,
): number[] {
  const n = returns.length;
  const out: number[] = new Array(n);
  let idx = Math.floor(rng() * n);
  for (let i = 0; i < n; i++) {
    if (rng() < blockProb) {
      idx = Math.floor(rng() * n);
    } else {
      idx = (idx + 1) % n;
    }
    out[i] = returns[idx]!;
  }
  return out;
}

export function runStationaryBootstrap(input: BootstrapInput): BootstrapResult {
  const returns = input.returns;
  const resamples = input.resamples ?? DEFAULT_RESAMPLES;
  const blockProb = input.blockResetProbability ?? DEFAULT_BLOCK_PROB;
  const ppy = input.periodsPerYear ?? DEFAULT_PPY;
  const seed = input.seed ?? Date.now();

  if (returns.length < 30) {
    return {
      realizedSharpe: Number.NaN,
      realizedMeanReturn: Number.NaN,
      realizedMaxDrawdown: Number.NaN,
      sharpeBand: { median: 0, ci05: 0, ci25: 0, ci75: 0, ci95: 0 },
      meanReturnBand: { median: 0, ci05: 0, ci25: 0, ci75: 0, ci95: 0 },
      maxDrawdownBand: { median: 0, ci05: 0, ci25: 0, ci75: 0, ci95: 0 },
      sharpePercentile: 0.5,
      verdict: "borderline",
      resamples: 0,
      sampleSize: returns.length,
      reasoning: `need at least 30 returns, got ${returns.length}`,
    };
  }

  const rng = lcg(seed);
  const realizedSharpe = sharpe(returns, ppy);
  const realizedMean = mean(returns);
  const realizedMdd = maxDrawdown(returns);

  const sharpes: number[] = new Array(resamples);
  const means: number[] = new Array(resamples);
  const mdds: number[] = new Array(resamples);

  for (let b = 0; b < resamples; b++) {
    const sample = resample(returns, blockProb, rng);
    sharpes[b] = sharpe(sample, ppy);
    means[b] = mean(sample);
    mdds[b] = maxDrawdown(sample);
  }

  const sortedSharpes = [...sharpes].sort((a, b) => a - b);
  let below = 0;
  for (const s of sortedSharpes) if (s < realizedSharpe) below++;
  const sharpePct = below / sortedSharpes.length;

  let verdict: BootstrapResult["verdict"];
  if (sharpePct >= ROBUST_PCT_RANGE[0] && sharpePct <= ROBUST_PCT_RANGE[1]) {
    verdict = "robust";
  } else if (sharpePct >= BORDERLINE_PCT_RANGE[0] && sharpePct <= BORDERLINE_PCT_RANGE[1]) {
    verdict = "borderline";
  } else {
    verdict = "fragile";
  }

  const sharpeBand = buildBand(sharpes);
  const reasoning =
    `Sharpe ${realizedSharpe.toFixed(2)} sits at p${(sharpePct * 100).toFixed(0)} of the ${resamples}-resample bootstrap ` +
    `(median ${sharpeBand.median.toFixed(2)}, 5–95 CI [${sharpeBand.ci05.toFixed(2)}, ${sharpeBand.ci95.toFixed(2)}]) → ${verdict}`;

  return {
    realizedSharpe,
    realizedMeanReturn: realizedMean,
    realizedMaxDrawdown: realizedMdd,
    sharpeBand,
    meanReturnBand: buildBand(means),
    maxDrawdownBand: buildBand(mdds),
    sharpePercentile: sharpePct,
    verdict,
    resamples,
    sampleSize: returns.length,
    reasoning,
  };
}

export function bootstrapToPayload(result: BootstrapResult): Record<string, unknown> {
  return {
    kind: "stationary_bootstrap.evaluated",
    realizedSharpe: Number.isFinite(result.realizedSharpe)
      ? Number(result.realizedSharpe.toFixed(4))
      : null,
    sharpeMedian: Number(result.sharpeBand.median.toFixed(4)),
    sharpeCi05: Number(result.sharpeBand.ci05.toFixed(4)),
    sharpeCi95: Number(result.sharpeBand.ci95.toFixed(4)),
    sharpePercentile: Number(result.sharpePercentile.toFixed(3)),
    verdict: result.verdict,
    resamples: result.resamples,
    sampleSize: result.sampleSize,
  };
}
