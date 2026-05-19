/**
 * Kaufman's Adaptive Moving Average — KAMA (GORDON_KAUFMAN_ADAPTIVE_MA).
 *
 * The book's namesake (TSaM Ch 17). EMA whose smoothing constant varies
 * each period based on the efficiency ratio: fast EMA when the market is
 * trending cleanly, slow EMA (effectively flat) when noisy.
 *
 *   sc[t] = [ER[t] * (fastSC - slowSC) + slowSC]²
 *   KAMA[t] = KAMA[t-1] + sc[t] * (price[t] - KAMA[t-1])
 *
 * Default nominal speeds 2-period (fast) and 30-period (slow), per
 * Kaufman. Squaring the smoothing constant inside the parenthesis
 * collapses the slow end into an effectively flat ~900-period trend,
 * which is what produces KAMA's signature "stop and wait" behavior
 * when ER drops near zero.
 *
 * Composes with WW6/effective-N (KAMA on the signal-combined series),
 * the regime detector (treat KAMA-slope as the regime baseline), and
 * AQ1/range volatility (size-on-vol scaling against KAMA trend).
 */

import { computeEfficiencyRatio } from "./efficiencyRatio.ts";

export const KAUFMAN_ADAPTIVE_MA_FLAG_ENV = "GORDON_KAUFMAN_ADAPTIVE_MA";

export function isKaufmanAdaptiveMaEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env[KAUFMAN_ADAPTIVE_MA_FLAG_ENV] === "1" ||
    env[KAUFMAN_ADAPTIVE_MA_FLAG_ENV] === "true"
  );
}

export interface KamaInput {
  prices: ReadonlyArray<number>;
  /** Efficiency-ratio lookback. Default 10. */
  erPeriod?: number;
  /** Nominal fast EMA period for the high end of the smoothing constant. Default 2. */
  fastPeriod?: number;
  /** Nominal slow EMA period for the low end. Default 30. */
  slowPeriod?: number;
  /**
   * Optional trend-change filter as a fraction of one standard deviation
   * of KAMA period-over-period changes. Suppresses false flips from
   * sub-noise penetrations. Default 0.1.
   */
  trendFilterStdevs?: number;
}

export type KamaTrend = "up" | "down" | "flat";

export interface KamaResult {
  /** Full KAMA series, aligned with input prices. Pre-warmup positions = NaN. */
  kama: number[];
  /** Per-period smoothing constants. NaN during warmup. */
  smoothingConstants: number[];
  currentKama: number;
  currentSc: number;
  trend: KamaTrend;
  trendChangeIndex: number | null;
  sampleSize: number;
  reasoning: string;
}

const DEFAULT_ER_PERIOD = 10;
const DEFAULT_FAST_PERIOD = 2;
const DEFAULT_SLOW_PERIOD = 30;
const DEFAULT_TREND_FILTER = 0.1;

function smoothingFromPeriod(period: number): number {
  return 2 / (period + 1);
}

export function computeKama(input: KamaInput): KamaResult {
  const prices = input.prices;
  const erPeriod = input.erPeriod ?? DEFAULT_ER_PERIOD;
  const fastSC = smoothingFromPeriod(input.fastPeriod ?? DEFAULT_FAST_PERIOD);
  const slowSC = smoothingFromPeriod(input.slowPeriod ?? DEFAULT_SLOW_PERIOD);
  const trendFilterMul = input.trendFilterStdevs ?? DEFAULT_TREND_FILTER;
  const n = prices.length;

  const kama: number[] = new Array(n).fill(Number.NaN);
  const scs: number[] = new Array(n).fill(Number.NaN);

  if (n < erPeriod + 1) {
    return {
      kama,
      smoothingConstants: scs,
      currentKama: Number.NaN,
      currentSc: Number.NaN,
      trend: "flat",
      trendChangeIndex: null,
      sampleSize: n,
      reasoning: `need at least ${erPeriod + 1} prices, got ${n}`,
    };
  }

  // Seed KAMA at index erPeriod with the seed price.
  kama[erPeriod] = prices[erPeriod]!;

  for (let i = erPeriod + 1; i < n; i++) {
    const window = prices.slice(i - erPeriod, i + 1);
    const er = computeEfficiencyRatio({ prices: window, period: erPeriod });
    const sc = Math.pow(er.efficiencyRatio * (fastSC - slowSC) + slowSC, 2);
    scs[i] = sc;
    kama[i] = kama[i - 1]! + sc * (prices[i]! - kama[i - 1]!);
  }

  // Trend filter: only count a flip if the period-over-period KAMA change
  // exceeds trendFilterMul × stdev(KAMA changes).
  const changes: number[] = [];
  for (let i = erPeriod + 2; i < n; i++) {
    if (Number.isFinite(kama[i]!) && Number.isFinite(kama[i - 1]!)) {
      changes.push(kama[i]! - kama[i - 1]!);
    }
  }
  let threshold = 0;
  if (changes.length > 1) {
    const mean = changes.reduce((a, b) => a + b, 0) / changes.length;
    let ss = 0;
    for (const c of changes) ss += (c - mean) * (c - mean);
    threshold = Math.sqrt(ss / (changes.length - 1)) * trendFilterMul;
  }

  // Identify current trend from last meaningful change.
  let trend: KamaTrend = "flat";
  let trendChangeIndex: number | null = null;
  for (let i = n - 1; i > erPeriod; i--) {
    const delta = kama[i]! - kama[i - 1]!;
    if (Math.abs(delta) > threshold) {
      trend = delta > 0 ? "up" : "down";
      // Walk backwards to find when this trend started.
      for (let j = i - 1; j > erPeriod; j--) {
        const dj = kama[j]! - kama[j - 1]!;
        if (Math.sign(dj) !== Math.sign(delta) || Math.abs(dj) <= threshold) {
          trendChangeIndex = j + 1;
          break;
        }
      }
      break;
    }
  }

  const currentKama = kama[n - 1]!;
  const currentSc = scs[n - 1]!;
  const reasoning =
    `KAMA ${currentKama.toFixed(4)}, sc ${currentSc.toFixed(4)} ` +
    `(${trend}${trendChangeIndex !== null ? ` since idx ${trendChangeIndex}` : ""})`;

  return {
    kama,
    smoothingConstants: scs,
    currentKama,
    currentSc,
    trend,
    trendChangeIndex,
    sampleSize: n,
    reasoning,
  };
}

export function kamaToPayload(result: KamaResult): Record<string, unknown> {
  return {
    kind: "kaufman_adaptive_ma.computed",
    currentKama: Number.isFinite(result.currentKama)
      ? Number(result.currentKama.toFixed(5))
      : null,
    currentSc: Number.isFinite(result.currentSc)
      ? Number(result.currentSc.toFixed(5))
      : null,
    trend: result.trend,
    sampleSize: result.sampleSize,
  };
}
