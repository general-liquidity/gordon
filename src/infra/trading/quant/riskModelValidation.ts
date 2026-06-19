/**
 * Risk-model validation primitives (from the Dimitri Bianco model-risk scan).
 *
 *  1. computePopulationStability — PSI, a deployed-model input/output
 *     distribution-DRIFT monitor. Distinct from backtest-time overfitting/MCPT:
 *     it watches whether a live feature/signal distribution has moved away from
 *     its reference window. PSI = Σ (aᵢ − eᵢ)·ln(aᵢ/eᵢ) over bins.
 *
 *  2. computeVaRBacktest — Kupiec POF + Christoffersen coverage tests. Gordon
 *     COMPUTES VaR/CVaR but never validated whether a VaR model is CALIBRATED.
 *     Kupiec checks the violation RATE; Christoffersen checks violations are
 *     INDEPENDENT (not clustered); conditional coverage = both.
 *
 * Pure; never throws.
 */

import { normalCdf } from "../../../core/numerics/index.ts";

// --- shared math ----------------------------------------------------------
const round = (x: number, p = 4): number => parseFloat(x.toFixed(p));

/** count·ln(prob) with the 0·ln(0):=0 convention (and prob≤0 → 0). */
function safeTerm(count: number, prob: number): number {
  return count > 0 && prob > 0 ? count * Math.log(prob) : 0;
}

/** Upper-tail χ² p-value. df=1: 2·Φ(−√x); df=2: exp(−x/2). */
function chiSquareSF(x: number, df: 1 | 2): number {
  if (x <= 0) return 1;
  return df === 1 ? 2 * normalCdf(-Math.sqrt(x)) : Math.exp(-x / 2);
}

const CHI2_95_DF1 = 3.841;
const CHI2_95_DF2 = 5.991;

// --- 1. Population Stability Index ----------------------------------------
export interface PopulationStabilityInput {
  /** Reference / baseline sample (defines the bins). */
  expected: number[];
  /** Current sample to test for drift. */
  actual: number[];
  /** Number of quantile bins from the reference. Default 10. */
  bins?: number;
}

export interface PopulationStabilityResult {
  psi: number;
  verdict: "stable" | "moderate_shift" | "significant_shift" | "insufficient";
  bins: number;
  /** Per-bin breakdown: reference %, current %, PSI contribution. */
  perBin: Array<{ lower: number; upper: number; expectedPct: number; actualPct: number; contribution: number }>;
  interpretation: string;
}

function quantileSorted(sorted: number[], q: number): number {
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? sorted[lo]! : sorted[lo]! + (pos - lo) * (sorted[hi]! - sorted[lo]!);
}

export function computePopulationStability(input: PopulationStabilityInput): PopulationStabilityResult {
  const bins = Math.max(2, Math.floor(input.bins ?? 10));
  const expected = (input.expected ?? []).filter((x) => Number.isFinite(x));
  const actual = (input.actual ?? []).filter((x) => Number.isFinite(x));
  if (expected.length < bins || actual.length < 1) {
    return { psi: 0, verdict: "insufficient", bins, perBin: [], interpretation: `need ≥ ${bins} reference + ≥1 current observation` };
  }

  // Quantile (equal-frequency) bin edges from the reference, deduped.
  const sortedExp = [...expected].sort((a, b) => a - b);
  const rawEdges: number[] = [];
  for (let i = 1; i < bins; i++) rawEdges.push(quantileSorted(sortedExp, i / bins));
  const edges = rawEdges.filter((e, i) => i === 0 || e > rawEdges[i - 1]!); // strictly increasing
  const nBins = edges.length + 1;

  const binIndex = (x: number): number => {
    let b = 0;
    while (b < edges.length && x > edges[b]!) b++;
    return b;
  };
  const expCounts = new Array(nBins).fill(0);
  const actCounts = new Array(nBins).fill(0);
  for (const x of expected) expCounts[binIndex(x)]++;
  for (const x of actual) actCounts[binIndex(x)]++;

  const EPS = 1e-6;
  let psi = 0;
  const perBin: PopulationStabilityResult["perBin"] = [];
  for (let b = 0; b < nBins; b++) {
    const e = Math.max(expCounts[b] / expected.length, EPS);
    const a = Math.max(actCounts[b] / actual.length, EPS);
    const c = (a - e) * Math.log(a / e);
    psi += c;
    perBin.push({
      lower: b === 0 ? -Infinity : round(edges[b - 1]!, 6),
      upper: b === nBins - 1 ? Infinity : round(edges[b]!, 6),
      expectedPct: round(expCounts[b] / expected.length),
      actualPct: round(actCounts[b] / actual.length),
      contribution: round(c),
    });
  }

  const verdict = psi < 0.1 ? "stable" : psi < 0.25 ? "moderate_shift" : "significant_shift";
  const interpretation =
    verdict === "stable"
      ? `PSI ${round(psi)} — distribution stable (no material drift)`
      : verdict === "moderate_shift"
        ? `PSI ${round(psi)} — moderate population shift, monitor / consider refit`
        : `PSI ${round(psi)} — SIGNIFICANT shift, the live distribution has moved off its reference (refit/investigate)`;

  return { psi: round(psi), verdict, bins: nBins, perBin, interpretation };
}

// --- 2. VaR exceedance backtest (Kupiec + Christoffersen) ------------------
export interface VaRBacktestInput {
  /** Realized period returns (losses are negative). */
  returns: number[];
  /** VaR forecast per period as a POSITIVE loss magnitude (aligned to returns). */
  varForecasts: number[];
  /** VaR confidence level (e.g. 0.99 → expected 1% exceptions). Default 0.99. */
  confidence?: number;
}

export interface VaRBacktestResult {
  nObs: number;
  violations: number;
  violationRate: number;
  expectedRate: number;
  /** Kupiec proportion-of-failures LR (χ²₁): is the violation RATE correct? */
  kupiecLR: number;
  kupiecPValue: number;
  kupiecReject: boolean;
  /** Christoffersen independence LR (χ²₁): are violations CLUSTERED? */
  independenceLR: number;
  independencePValue: number;
  independenceReject: boolean;
  /** Conditional coverage LR = Kupiec + independence (χ²₂). */
  conditionalCoverageLR: number;
  conditionalCoveragePValue: number;
  conditionalCoverageReject: boolean;
  verdict: "well_calibrated" | "rate_miscalibrated" | "violations_clustered" | "miscalibrated" | "insufficient";
  interpretation: string;
}

const MIN_VAR_OBS = 30;

export function computeVaRBacktest(input: VaRBacktestInput): VaRBacktestResult {
  const confidence = input.confidence && input.confidence > 0 && input.confidence < 1 ? input.confidence : 0.99;
  const p = 1 - confidence; // expected exception rate
  const n = Math.min(input.returns?.length ?? 0, input.varForecasts?.length ?? 0);

  const insufficient = (): VaRBacktestResult => ({
    nObs: n, violations: 0, violationRate: 0, expectedRate: round(p, 6),
    kupiecLR: 0, kupiecPValue: 1, kupiecReject: false,
    independenceLR: 0, independencePValue: 1, independenceReject: false,
    conditionalCoverageLR: 0, conditionalCoveragePValue: 1, conditionalCoverageReject: false,
    verdict: "insufficient", interpretation: `need ≥ ${MIN_VAR_OBS} aligned (return, VaR) pairs, got ${n}`,
  });
  if (n < MIN_VAR_OBS) return insufficient();

  // Violation: realized loss exceeds the VaR (return below −VaR).
  const breach: number[] = [];
  for (let i = 0; i < n; i++) breach.push(input.returns[i]! < -Math.abs(input.varForecasts[i]!) ? 1 : 0);
  const x = breach.reduce((s, b) => s + b, 0);
  const rate = x / n;

  // Kupiec POF (unconditional coverage), χ²₁.
  const kupiecLR =
    -2 * (safeTerm(n - x, 1 - p) + safeTerm(x, p) - safeTerm(n - x, 1 - rate) - safeTerm(x, rate));

  // Christoffersen independence (Markov transitions of the breach indicator), χ²₁.
  let n00 = 0, n01 = 0, n10 = 0, n11 = 0;
  for (let i = 1; i < n; i++) {
    const prev = breach[i - 1]!;
    const cur = breach[i]!;
    if (prev === 0 && cur === 0) n00++;
    else if (prev === 0 && cur === 1) n01++;
    else if (prev === 1 && cur === 0) n10++;
    else n11++;
  }
  const pi01 = n00 + n01 > 0 ? n01 / (n00 + n01) : 0;
  const pi11 = n10 + n11 > 0 ? n11 / (n10 + n11) : 0;
  const pi2 = n00 + n01 + n10 + n11 > 0 ? (n01 + n11) / (n00 + n01 + n10 + n11) : 0;
  const independenceLR =
    -2 *
    (safeTerm(n00 + n10, 1 - pi2) + safeTerm(n01 + n11, pi2) -
      safeTerm(n00, 1 - pi01) - safeTerm(n01, pi01) - safeTerm(n10, 1 - pi11) - safeTerm(n11, pi11));

  const ccLR = kupiecLR + independenceLR;
  const kupiecReject = kupiecLR > CHI2_95_DF1;
  const independenceReject = independenceLR > CHI2_95_DF1;
  const ccReject = ccLR > CHI2_95_DF2;

  const verdict =
    kupiecReject && independenceReject
      ? "miscalibrated"
      : kupiecReject
        ? "rate_miscalibrated"
        : independenceReject
          ? "violations_clustered"
          : "well_calibrated";

  const interpretation =
    verdict === "well_calibrated"
      ? `${x}/${n} violations (${round(rate * 100, 2)}% vs ${round(p * 100, 2)}% expected) — VaR well-calibrated (Kupiec & Christoffersen pass)`
      : verdict === "rate_miscalibrated"
        ? `${x}/${n} violations (${round(rate * 100, 2)}% vs ${round(p * 100, 2)}% expected) — Kupiec REJECTS: violation rate is ${rate > p ? "too high (VaR understates risk)" : "too low (VaR overstates risk)"}`
        : verdict === "violations_clustered"
          ? `${x}/${n} violations at the right rate but CLUSTERED — Christoffersen REJECTS independence (losses bunch — VaR misses changing volatility)`
          : `${x}/${n} violations — both rate AND clustering fail (VaR mis-calibrated on coverage and independence)`;

  return {
    nObs: n, violations: x, violationRate: round(rate, 6), expectedRate: round(p, 6),
    kupiecLR: round(kupiecLR), kupiecPValue: round(chiSquareSF(kupiecLR, 1), 4), kupiecReject,
    independenceLR: round(independenceLR), independencePValue: round(chiSquareSF(independenceLR, 1), 4), independenceReject,
    conditionalCoverageLR: round(ccLR), conditionalCoveragePValue: round(chiSquareSF(ccLR, 2), 4), conditionalCoverageReject: ccReject,
    verdict, interpretation,
  };
}
