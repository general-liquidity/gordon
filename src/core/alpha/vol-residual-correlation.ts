/**
 * Vol-Residual Correlation — the hidden correlation raw matrices mask.
 *
 * From Kieran Duff, "Correlation: the silent killer in your strategy mix".
 * Strategy correlation matrices computed on RAW returns embed volatility
 * timing: two strategies that both cut size in high-vol regimes and add in
 * calm ones look uncorrelated on raw returns even when they share directional
 * exposure. "Strip the vol exposure out and the green-and-yellow matrix turns
 * red." This regresses each series on a common volatility factor and correlates
 * the RESIDUALS — surfacing the correlation the vol-timing was hiding.
 *
 * Distinct from correlationLimits.ts (raw Pearson correlation — exactly the
 * matrix the letter warns about). Reports raw vs residual correlation per pair
 * and flags "hidden" pairs (residual materially above raw).
 *
 * Pure compute. No I/O.
 */

import { sampleCorrelation, linearRegression, mean } from "../stats/index.ts";

export interface VolResidualCorrelationInput {
  /** Aligned per-period return series keyed by strategy/symbol. Need >= 2. */
  returnsBySymbol: Record<string, ReadonlyArray<number>>;
  /**
   * Common volatility factor series to regress out (e.g. realized book vol or
   * VIX). If omitted, a proxy is built: per-period mean |return| across series.
   */
  volFactor?: ReadonlyArray<number>;
  /** Residual correlation at/above which a pair is "high". Default 0.5. */
  highCorrThreshold?: number;
  /** Min (residual − raw) jump for a pair to be flagged "hidden". Default 0.15. */
  hiddenDelta?: number;
}

export interface VolResidualPair {
  a: string;
  b: string;
  rawCorr: number;
  residualCorr: number;
  /** residualCorr − rawCorr. Positive = vol-timing was masking the link. */
  delta: number;
  /** residualCorr ≥ highCorrThreshold AND delta ≥ hiddenDelta. */
  hidden: boolean;
}

export interface VolResidualCorrelationResult {
  pairs: VolResidualPair[];
  volFactorSource: "provided" | "proxy";
  maxRawCorr: number;
  maxResidualCorr: number;
  hiddenPairCount: number;
  worstPair: VolResidualPair | null;
  sampleSize: number;
  interpretation: string;
}

function pearson(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;
  return sampleCorrelation(a.slice(0, n), b.slice(0, n));
}

/** Residuals of y after OLS regression on x: y_i − (a + b·x_i). */
function residualize(y: ReadonlyArray<number>, x: ReadonlyArray<number>): number[] {
  const n = Math.min(y.length, x.length);
  if (n < 3) return y.slice(0, n);
  const ys = y.slice(0, n);
  const xs = x.slice(0, n);
  let { slope, intercept } = linearRegression(xs, ys);
  // var(x)=0 makes the OLS slope undefined; fall back to a flat fit
  // (mean-removed passthrough), matching the prior varX===0 branch.
  if (!Number.isFinite(slope)) {
    slope = 0;
    intercept = mean(ys);
  }
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = ys[i]! - (intercept + slope * xs[i]!);
  return out;
}

const round = (x: number, n: number) => parseFloat(x.toFixed(n));

export function computeVolResidualCorrelation(
  input: VolResidualCorrelationInput,
): VolResidualCorrelationResult {
  const symbols = Object.keys(input.returnsBySymbol);
  const highThreshold = input.highCorrThreshold ?? 0.5;
  const hiddenDelta = input.hiddenDelta ?? 0.15;

  const neutral: VolResidualCorrelationResult = {
    pairs: [],
    volFactorSource: input.volFactor ? "provided" : "proxy",
    maxRawCorr: 0,
    maxResidualCorr: 0,
    hiddenPairCount: 0,
    worstPair: null,
    sampleSize: 0,
    interpretation: "Need at least 2 return series for correlation analysis",
  };
  if (symbols.length < 2) return neutral;

  // Align all series (and the vol factor) to the shortest length.
  let minLen = Infinity;
  for (const s of symbols) minLen = Math.min(minLen, input.returnsBySymbol[s]!.length);
  if (input.volFactor) minLen = Math.min(minLen, input.volFactor.length);
  if (!Number.isFinite(minLen) || minLen < 3) return { ...neutral, sampleSize: Number.isFinite(minLen) ? minLen : 0 };

  const series: Record<string, number[]> = {};
  for (const s of symbols) series[s] = input.returnsBySymbol[s]!.slice(0, minLen);

  // Volatility factor: provided, or per-period mean |return| across series.
  let volFactor: number[];
  let volFactorSource: "provided" | "proxy";
  if (input.volFactor) {
    volFactor = input.volFactor.slice(0, minLen);
    volFactorSource = "provided";
  } else {
    volFactor = new Array<number>(minLen);
    for (let i = 0; i < minLen; i++) {
      let acc = 0;
      for (const s of symbols) acc += Math.abs(series[s]![i]!);
      volFactor[i] = acc / symbols.length;
    }
    volFactorSource = "proxy";
  }

  const residuals: Record<string, number[]> = {};
  for (const s of symbols) residuals[s] = residualize(series[s]!, volFactor);

  const pairs: VolResidualPair[] = [];
  let maxRawCorr = 0;
  let maxResidualCorr = 0;
  let worstPair: VolResidualPair | null = null;

  for (let i = 0; i < symbols.length; i++) {
    for (let j = i + 1; j < symbols.length; j++) {
      const a = symbols[i]!;
      const b = symbols[j]!;
      const rawCorr = round(pearson(series[a]!, series[b]!), 4);
      const residualCorr = round(pearson(residuals[a]!, residuals[b]!), 4);
      const delta = round(residualCorr - rawCorr, 4);
      const hidden = residualCorr >= highThreshold && delta >= hiddenDelta;
      const pair: VolResidualPair = { a, b, rawCorr, residualCorr, delta, hidden };
      pairs.push(pair);
      if (Math.abs(rawCorr) > Math.abs(maxRawCorr)) maxRawCorr = rawCorr;
      if (residualCorr > maxResidualCorr) maxResidualCorr = residualCorr;
      if (!worstPair || residualCorr > worstPair.residualCorr) worstPair = pair;
    }
  }

  const hiddenPairCount = pairs.filter((p) => p.hidden).length;
  const interpretation =
    `${symbols.length} series, ${pairs.length} pair(s), vol factor: ${volFactorSource}. ` +
    `Max raw |corr| ${maxRawCorr}, max residual corr ${maxResidualCorr}. ` +
    (hiddenPairCount > 0
      ? `${hiddenPairCount} HIDDEN pair(s) — correlation masked by shared vol-timing on raw returns` +
        (worstPair ? ` (worst: ${worstPair.a}/${worstPair.b}, raw ${worstPair.rawCorr} → residual ${worstPair.residualCorr})` : "") +
        ". Size for the residual matrix, not the raw one."
      : "No hidden correlation surfaced — raw and residual matrices agree.");

  return {
    pairs,
    volFactorSource,
    maxRawCorr,
    maxResidualCorr,
    hiddenPairCount,
    worstPair,
    sampleSize: minLen,
    interpretation,
  };
}
