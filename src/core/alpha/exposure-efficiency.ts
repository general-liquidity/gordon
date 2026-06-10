/**
 * Exposure Efficiency — return per unit of time-at-risk ("Inactivity Pays").
 *
 * From the "Inactivity Pays" framing: a strategy that earns its return in a
 * FRACTION of the time it could be in the market is more capital-efficient and
 * more tail-safe than one earning the same return always-on. Two strategies
 * with identical total return are not equal if one is exposed 20% of the time
 * and the other 100% — the first leaves capital free and spends 80% of the
 * window out of reach of a gap/flash-crash. Total return alone hides this; this
 * metric normalizes return by the time capital was actually at risk.
 *
 * Distinct from time-under-water.ts (drawdown DURATION below a prior peak) and
 * risk-ratio-triple.ts (Calmar/Sortino — return over a RISK denominator). Here
 * the denominator is EXPOSURE-TIME, not volatility or drawdown: a low-vol
 * always-on strategy and a high-vol rarely-on strategy can share a Sharpe yet
 * have opposite exposure efficiency. Also surfaces "leaking" exposure — time
 * held at risk that produced no return, i.e. tail exposure bought for nothing.
 *
 * Durations are in PERIODS (the caller's bar size). Pure compute, O(N).
 */

export interface ExposureEfficiencyInput {
  /** Per-period strategy returns, e.g. [0.01, 0, -0.004, ...]. */
  returns: ReadonlyArray<number>;
  /**
   * Per-period market exposure in [0,1] — 1 = fully invested, 0 = flat/cash,
   * fractional for partial sizing. Length must equal returns. If omitted,
   * exposure is inferred as 1 whenever returns[i] !== 0 and 0 otherwise — a
   * coarse proxy that treats a flat-but-held period as out-of-market.
   */
  exposure?: ReadonlyArray<number>;
  /** "compound" (product of 1+r) or "simple" (sum). Default "compound". */
  compoundMode?: "simple" | "compound";
  /** Periods per year — enables the annualized in-market rate. Omit to skip. */
  periodsPerYear?: number;
}

export interface ExposureEfficiencyResult {
  /** Exposure-weighted fraction of time capital was at risk (mean exposure). */
  timeInMarketFraction: number;
  /** Sum of per-period exposure — the exposure-periods denominator for rates. */
  exposurePeriods: number;
  /** Total strategy return over the full window (compound or simple). */
  totalReturn: number;
  /**
   * Total return per unit of exposure-time — the headline efficiency. Equals
   * totalReturn / timeInMarketFraction: the return you would have earned at
   * this rate if fully deployed the whole window. 0 when never in market.
   */
  returnPerExposureUnit: number;
  /** In-market return rate annualized over exposure-time; null w/o periodsPerYear. */
  annualizedReturnPerExposure: number | null;
  /** Exposure-weighted fraction of in-market time that produced non-positive returns. */
  leakingExposureFraction: number;
  /** Sum of the negative per-period returns realized while exposed (a drag estimate). */
  returnDragFromLeak: number;
  sampleSize: number;
  interpretation: string;
}

const round = (x: number, n: number) => parseFloat(x.toFixed(n));

export function computeExposureEfficiency(
  input: ExposureEfficiencyInput,
): ExposureEfficiencyResult {
  const returns = input.returns;
  const N = returns.length;
  const mode = input.compoundMode ?? "compound";

  const neutral: ExposureEfficiencyResult = {
    timeInMarketFraction: 0,
    exposurePeriods: 0,
    totalReturn: 0,
    returnPerExposureUnit: 0,
    annualizedReturnPerExposure: null,
    leakingExposureFraction: 0,
    returnDragFromLeak: 0,
    sampleSize: N,
    interpretation: "Insufficient data for exposure efficiency",
  };
  if (N === 0) return neutral;

  const exposure = input.exposure;
  if (exposure && exposure.length !== N) {
    throw new Error("exposure length must equal returns length");
  }

  let exposurePeriods = 0;
  let totalReturn = mode === "compound" ? 1 : 0;
  let leakingExposure = 0;
  let returnDragFromLeak = 0;

  for (let i = 0; i < N; i++) {
    const r = returns[i]!;
    const e = exposure ? exposure[i]! : r !== 0 ? 1 : 0;
    if (e < 0 || e > 1) throw new Error("exposure must be within [0, 1]");

    totalReturn = mode === "compound" ? totalReturn * (1 + r) : totalReturn + r;
    exposurePeriods += e;
    if (e > 0 && r <= 0) {
      leakingExposure += e;
      if (r < 0) returnDragFromLeak += r;
    }
  }
  if (mode === "compound") totalReturn -= 1;

  const timeInMarketFraction = exposurePeriods / N;
  const returnPerExposureUnit =
    exposurePeriods > 0 ? totalReturn / timeInMarketFraction : 0;
  const leakingExposureFraction =
    exposurePeriods > 0 ? leakingExposure / exposurePeriods : 0;

  let annualizedReturnPerExposure: number | null = null;
  if (input.periodsPerYear && input.periodsPerYear > 0 && exposurePeriods > 0) {
    annualizedReturnPerExposure =
      mode === "compound"
        ? Math.pow(1 + totalReturn, input.periodsPerYear / exposurePeriods) - 1
        : (totalReturn / exposurePeriods) * input.periodsPerYear;
  }

  const interpretation =
    `${N} periods: ${(timeInMarketFraction * 100).toFixed(1)}% time in market, ` +
    `total return ${(totalReturn * 100).toFixed(2)}%, ` +
    `${(returnPerExposureUnit * 100).toFixed(2)}% per unit of exposure-time` +
    (annualizedReturnPerExposure !== null
      ? ` (${(annualizedReturnPerExposure * 100).toFixed(1)}% annualized while deployed)`
      : "") +
    `; ${(leakingExposureFraction * 100).toFixed(1)}% of in-market time leaking (non-positive). ` +
    (exposurePeriods === 0
      ? "Never in market — no capital at risk."
      : timeInMarketFraction < 0.5 && returnPerExposureUnit > totalReturn
        ? "Inactivity premium: most of the window is spent out of harm's way at this return rate."
        : "High time-in-market — most of the return rate is paid for with continuous tail exposure.");

  return {
    timeInMarketFraction: round(timeInMarketFraction, 6),
    exposurePeriods: round(exposurePeriods, 4),
    totalReturn: round(totalReturn, 6),
    returnPerExposureUnit: round(returnPerExposureUnit, 6),
    annualizedReturnPerExposure:
      annualizedReturnPerExposure === null ? null : round(annualizedReturnPerExposure, 6),
    leakingExposureFraction: round(leakingExposureFraction, 6),
    returnDragFromLeak: round(returnDragFromLeak, 6),
    sampleSize: N,
    interpretation,
  };
}
