/**
 * Conviction Calibration Gate (GORDON_CONVICTION_CALIBRATION).
 *
 * Port of Ch 9's calibration mandate from Ryan Wright. Direct quote:
 *
 *   "Until you have a dataset of at least 100 trades showing a statistical
 *    correlation between your conviction rating (three stars vs. five
 *    stars) and your realized Sharpe ratio, you're forbidden from using
 *    conviction sizing. ... You don't get to use conviction sizing until
 *    your data proves your conviction has value."
 *
 * The intuition is strong: feel certain → bet bigger. The intuition is
 * usually wrong: most traders' "high conviction" trades underperform
 * their standard setups because confirmation bias inflates conviction
 * without inflating accuracy. This module is the structural defense.
 *
 * Sits in front of `pathDependentSizer.ts` (WW1). When the gate is closed
 * (insufficient calibration data, or correlation too weak), the only
 * allowed tier is "I" — Type II/III conviction sizing is blocked, the
 * operator is forced to flat-size everything at 1R until they've earned
 * the privilege through data.
 *
 * Computes Pearson correlation between the operator's per-trade conviction
 * rating and the realized R-multiple. Threshold defaults are conservative:
 *   - minimum trades: 100 (Wright's number, statistical floor for 55%/50%
 *     win-rate distinction at typical effect sizes)
 *   - minimum positive correlation r ≥ 0.30 (a meaningful but not heroic
 *     effect; below this, your stars are noise)
 */

export const CONVICTION_CALIBRATION_FLAG_ENV = "GORDON_CONVICTION_CALIBRATION";

export function isConvictionCalibrationEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    env[CONVICTION_CALIBRATION_FLAG_ENV] === "1" ||
    env[CONVICTION_CALIBRATION_FLAG_ENV] === "true"
  );
}

export interface CalibrationTrade {
  /** Operator's pre-trade conviction rating. Free scale (1-5, 1-10, etc). */
  convictionRating: number;
  /** Realized R-multiple (profit/loss ÷ initial risk). Negative for losses. */
  rMultiple: number;
}

export interface CalibrationInput {
  trades: ReadonlyArray<CalibrationTrade>;
  /** Minimum sample size before calibration becomes evaluable. Default 100. */
  minTrades?: number;
  /** Pearson r required to grant conviction sizing. Default 0.30. */
  minCorrelation?: number;
}

export type CalibrationStatus =
  | "insufficient_data"
  | "uncorrelated"
  | "negatively_correlated"
  | "calibrated";

export interface CalibrationResult {
  status: CalibrationStatus;
  /** True only when status === "calibrated". Direct gate value. */
  allowsConvictionSizing: boolean;
  tradesSeen: number;
  minTrades: number;
  pearsonR: number | null;
  minCorrelation: number;
  reason: string;
}

const DEFAULT_MIN_TRADES = 100;
const DEFAULT_MIN_CORRELATION = 0.3;

function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 2) return null;
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    sumX += xs[i]!;
    sumY += ys[i]!;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  let num = 0;
  let denomX = 0;
  let denomY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - meanX;
    const dy = ys[i]! - meanY;
    num += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }
  const denom = Math.sqrt(denomX * denomY);
  if (denom === 0) return null;
  return num / denom;
}

export function evaluateCalibration(input: CalibrationInput): CalibrationResult {
  const minTrades = input.minTrades ?? DEFAULT_MIN_TRADES;
  const minCorrelation = input.minCorrelation ?? DEFAULT_MIN_CORRELATION;
  const n = input.trades.length;

  if (n < minTrades) {
    return {
      status: "insufficient_data",
      allowsConvictionSizing: false,
      tradesSeen: n,
      minTrades,
      pearsonR: null,
      minCorrelation,
      reason: `${n}/${minTrades} trades — flat-size at 1R until calibration sample complete`,
    };
  }

  const xs = input.trades.map((t) => t.convictionRating);
  const ys = input.trades.map((t) => t.rMultiple);
  const r = pearson(xs, ys);

  if (r === null) {
    return {
      status: "uncorrelated",
      allowsConvictionSizing: false,
      tradesSeen: n,
      minTrades,
      pearsonR: null,
      minCorrelation,
      reason: "Conviction or outcome variance is zero — no signal to evaluate",
    };
  }

  if (r < 0) {
    return {
      status: "negatively_correlated",
      allowsConvictionSizing: false,
      tradesSeen: n,
      minTrades,
      pearsonR: r,
      minCorrelation,
      reason: `Pearson r=${r.toFixed(3)} negative — high-conviction trades UNDERPERFORM, conviction sizing actively harmful`,
    };
  }

  if (r < minCorrelation) {
    return {
      status: "uncorrelated",
      allowsConvictionSizing: false,
      tradesSeen: n,
      minTrades,
      pearsonR: r,
      minCorrelation,
      reason: `Pearson r=${r.toFixed(3)} below floor ${minCorrelation} — conviction is noise`,
    };
  }

  return {
    status: "calibrated",
    allowsConvictionSizing: true,
    tradesSeen: n,
    minTrades,
    pearsonR: r,
    minCorrelation,
    reason: `Pearson r=${r.toFixed(3)} ≥ ${minCorrelation} over ${n} trades — conviction sizing earned`,
  };
}

/**
 * Convenience filter for use ahead of `pathDependentSizer.sizePosition`.
 * Returns the highest tier the operator is currently allowed to claim.
 * When calibrated: caller's requested tier. Otherwise: always "I".
 */
export function clampTierToCalibration<T extends "I" | "II" | "III">(
  requestedTier: T,
  result: CalibrationResult,
): "I" | T {
  if (result.allowsConvictionSizing) return requestedTier;
  return "I";
}

export function calibrationToPayload(
  result: CalibrationResult,
): Record<string, unknown> {
  return {
    kind: "conviction_calibration.evaluated",
    status: result.status,
    allowsConvictionSizing: result.allowsConvictionSizing,
    tradesSeen: result.tradesSeen,
    pearsonR: result.pearsonR === null ? null : Number(result.pearsonR.toFixed(3)),
  };
}
