/**
 * VPIN — Volume-Synchronized Probability of Informed Trading
 *
 * Easley, López de Prado & O'Hara (2012), "Flow Toxicity and Liquidity in a
 * High-Frequency World" (Review of Financial Studies). The canonical order-flow
 * TOXICITY metric — famously elevated before the May 2010 Flash Crash.
 *
 * Pipeline: (1) Bulk Volume Classification (BVC) splits each bar's volume into
 * buy/sell fractions via Φ(Δp/σ) — the standard-normal CDF of the normalized
 * price change. (2) A volume clock re-buckets bars into equal-volume buckets
 * (splitting a bar's volume across a bucket boundary). (3) Per-bucket order
 * imbalance OI = |vBuy − vSell|. (4) VPIN is the rolling mean OI normalized by
 * bucket volume — the average one-sidedness of recent flow, in [0, 1].
 *
 * Distinct from microstructureToxicity.ts (depth-snapshot composite) and
 * adverseSelectionDetector.ts (fill-based): VPIN works on OHLCV bars alone.
 */

import type { Candle } from "./types.ts";
import { normalCdf } from "../numerics/index.ts";

export interface VpinResult {
  /** Latest VPIN value (4dp), null if not enough buckets */
  current: number | null;
  /** Per-bucket VPIN series (4dp); null before `window` buckets exist */
  values: (number | null)[];
  /** Number of completed equal-volume buckets formed */
  buckets: number;
  /** Volume per bucket (the volume-clock quantum) */
  bucketVolume: number;
  /** Percentile rank of `current` within the non-null VPIN series (0..1, 2dp) */
  percentile: number | null;
  /** Toxicity classification from percentile/current */
  signal: "toxic" | "elevated" | "benign";
  /** Rolling VPIN window in buckets */
  window: number;
  /** Human-readable interpretation */
  interpretation: string;
}

// Φ(x) for BVC is provided by the shared @stdlib-backed core/numerics module.

function neutralResult(window: number): VpinResult {
  return {
    current: null,
    values: [],
    buckets: 0,
    bucketVolume: 0,
    percentile: null,
    signal: "benign",
    window,
    interpretation: "Insufficient data/volume for VPIN",
  };
}

/**
 * Calculate VPIN from OHLCV candles.
 *
 * @param candles - OHLCV candle array (numeric open/high/low/close/volume)
 * @param opts.bucketVolume - explicit volume-clock bucket size; default = totalVolume / numBuckets
 * @param opts.numBuckets   - bucket count used to derive default bucketVolume (default 50)
 * @param opts.window       - rolling VPIN window in buckets (default 50)
 * @param opts.sigmaWindow  - lookback for the Δp standard deviation (default = full series)
 */
export function calculateVpin(
  candles: Candle[],
  opts?: { bucketVolume?: number; numBuckets?: number; window?: number; sigmaWindow?: number }
): VpinResult {
  const numBuckets = opts?.numBuckets ?? 50;
  const window = opts?.window ?? 50;
  const sigmaWindow = opts?.sigmaWindow;

  if (candles.length < 2) return neutralResult(window);

  let totalVolume = 0;
  for (let i = 0; i < candles.length; i++) totalVolume += candles[i]!.volume;
  if (totalVolume <= 0) return neutralResult(window);

  // --- price deltas (i >= 1) ---
  const deltas: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    deltas.push(candles[i]!.close - candles[i - 1]!.close);
  }

  // --- sigma of deltas (full series, or last sigmaWindow deltas) ---
  const sigmaSlice =
    sigmaWindow != null && sigmaWindow > 0 && sigmaWindow < deltas.length
      ? deltas.slice(deltas.length - sigmaWindow)
      : deltas;
  let mean = 0;
  for (let i = 0; i < sigmaSlice.length; i++) mean += sigmaSlice[i]!;
  mean /= sigmaSlice.length;
  let variance = 0;
  for (let i = 0; i < sigmaSlice.length; i++) {
    const d = sigmaSlice[i]! - mean;
    variance += d * d;
  }
  variance /= sigmaSlice.length;
  const sigma = Math.sqrt(variance);

  // --- BVC per bar (i >= 1) → buy/sell volume ---
  // Bar i (i>=1) uses deltas[i-1]. Bar 0 has no delta → treat as balanced.
  type BarFlow = { vBuy: number; vSell: number };
  const flows: BarFlow[] = [];
  flows.push({ vBuy: candles[0]!.volume * 0.5, vSell: candles[0]!.volume * 0.5 });
  for (let i = 1; i < candles.length; i++) {
    const vol = candles[i]!.volume;
    const buyFraction = sigma <= 0 ? 0.5 : normalCdf(deltas[i - 1]! / sigma);
    flows.push({ vBuy: vol * buyFraction, vSell: vol * (1 - buyFraction) });
  }

  // --- bucket volume (volume clock quantum) ---
  const rawBucketVolume =
    opts?.bucketVolume != null && opts.bucketVolume > 0
      ? opts.bucketVolume
      : totalVolume / numBuckets;
  if (rawBucketVolume <= 0) return neutralResult(window);

  // --- fill equal-volume buckets, splitting bars across boundaries ---
  type Bucket = { vBuy: number; vSell: number };
  const completed: Bucket[] = [];
  let cur: Bucket = { vBuy: 0, vSell: 0 };
  let curFilled = 0;

  for (let i = 0; i < flows.length; i++) {
    let remBuy = flows[i]!.vBuy;
    let remSell = flows[i]!.vSell;
    let remTotal = remBuy + remSell;

    while (remTotal > 0) {
      const space = rawBucketVolume - curFilled;
      if (remTotal <= space + 1e-9) {
        cur.vBuy += remBuy;
        cur.vSell += remSell;
        curFilled += remTotal;
        remBuy = 0;
        remSell = 0;
        remTotal = 0;
        if (curFilled >= rawBucketVolume - 1e-9) {
          completed.push(cur);
          cur = { vBuy: 0, vSell: 0 };
          curFilled = 0;
        }
      } else {
        // split this bar proportionally to exactly fill the bucket
        const frac = space / remTotal;
        const takeBuy = remBuy * frac;
        const takeSell = remSell * frac;
        cur.vBuy += takeBuy;
        cur.vSell += takeSell;
        completed.push(cur);
        cur = { vBuy: 0, vSell: 0 };
        curFilled = 0;
        remBuy -= takeBuy;
        remSell -= takeSell;
        remTotal = remBuy + remSell;
      }
    }
  }

  if (completed.length < window + 1) return neutralResult(window);

  // --- per-bucket order imbalance ---
  const oi: number[] = completed.map((b) => Math.abs(b.vBuy - b.vSell));

  // --- rolling VPIN per bucket ---
  const denom = window * rawBucketVolume;
  const values: (number | null)[] = completed.map(() => null);
  for (let t = window - 1; t < completed.length; t++) {
    let sum = 0;
    for (let j = t - window + 1; j <= t; j++) sum += oi[j]!;
    let v = sum / denom;
    if (v < 0) v = 0;
    if (v > 1) v = 1;
    values[t] = parseFloat(v.toFixed(4));
  }

  const current = values[values.length - 1] ?? null;

  // --- percentile rank of current within non-null VPIN series ---
  const nonNull = values.filter((v): v is number => v !== null);
  let percentile: number | null = null;
  if (current !== null && nonNull.length >= 2) {
    let countLe = 0;
    for (let i = 0; i < nonNull.length; i++) if (nonNull[i]! <= current) countLe++;
    percentile = parseFloat((countLe / nonNull.length).toFixed(2));
  }

  // --- signal: toxic if pct>=0.8 or current>=0.5; elevated if pct>=0.5; else benign ---
  // Thresholds per Easley et al.: VPIN is a [0,1] toxicity gauge, so high
  // ABSOLUTE flow imbalance (current>=0.5) is toxic outright; otherwise we use
  // the value's own-history percentile (>=0.8 toxic, >=0.5 elevated). A near-zero
  // VPIN is balanced two-sided flow and is benign regardless of percentile —
  // this guard prevents a degenerate flat/symmetric series (where every bucket
  // VPIN is 0, so the rank trivially saturates) from being mislabeled toxic.
  const FLOOR = 0.05;
  let signal: "toxic" | "elevated" | "benign" = "benign";
  if (current !== null) {
    if (current >= 0.5) {
      signal = "toxic";
    } else if (current >= FLOOR) {
      if (percentile !== null && percentile >= 0.8) signal = "toxic";
      else if (percentile !== null && percentile >= 0.5) signal = "elevated";
    }
  }

  const interpretation = buildInterpretation(current, percentile, signal);

  return {
    current,
    values,
    buckets: completed.length,
    bucketVolume: parseFloat(rawBucketVolume.toFixed(4)),
    percentile,
    signal,
    window,
    interpretation,
  };
}

function buildInterpretation(
  current: number | null,
  percentile: number | null,
  signal: "toxic" | "elevated" | "benign"
): string {
  if (current === null) return "Insufficient data/volume for VPIN.";
  const v = current.toFixed(4);
  const pct = percentile === null ? "n/a" : `${(percentile * 100).toFixed(0)}th pct`;
  const base =
    "Higher VPIN = more one-sided/informed order flow = order-flow toxicity; " +
    "liquidity providers respond by widening spreads or pulling quotes, and " +
    "elevated VPIN has historically preceded volatility events (e.g. the 2010 Flash Crash).";
  if (signal === "toxic") {
    return `VPIN ${v} (${pct}) — TOXIC: flow is heavily one-sided. ${base}`;
  }
  if (signal === "elevated") {
    return `VPIN ${v} (${pct}) — ELEVATED: above-median flow imbalance. ${base}`;
  }
  return `VPIN ${v} (${pct}) — BENIGN: balanced two-sided flow, low toxicity. ${base}`;
}
