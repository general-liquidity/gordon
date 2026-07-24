/**
 * Recovery Factor (GORDON_RECOVERY_FACTOR).
 *
 * Port of Ch 1 (Popular Approaches → analytical indicators list) from
 * Dolzhenko, "Algorithmic Trading Systems and Strategies: A New Approach"
 * (Apress 2024).
 *
 * Recovery Factor = |net profit| / |max drawdown|.
 *
 * Direct quote: "The recovery factor is equal to the absolute value of net
 * profit divided by the maximum drawdown. The higher the recovery factor,
 * the faster the system recovers after a drawdown."
 *
 * A scale-free ratio that captures "how much net profit was earned per
 * unit of pain absorbed." Strategies with RF < 1 spend more in drawdown
 * than they earn. RF > 2 is typically considered acceptable; RF > 3
 * is strong.
 *
 * Computed from a per-period return series. The primitive walks the
 * equity curve once: O(N). Returns both raw recovery factor and the
 * underlying components (total return, max drawdown, peak/trough indices)
 * so callers can drill in.
 *
 * Complements Gordon's existing `backtest/metrics.ts` (which computes
 * Sharpe/Sortino/Calmar but not specifically Recovery Factor with
 * peak-trough metadata).
 *
 * Pure compute. No I/O.
 */

export interface RecoveryFactorInput {
  /** Per-period returns. e.g. [0.01, -0.02, 0.005, ...]. */
  returns: ReadonlyArray<number>;
  /** Starting equity (for cumulative curve). Default 1. */
  initialEquity?: number;
  /** How to compound: "simple" (sum returns) or "compound" (product of (1+r)). Default "compound". */
  compoundMode?: "simple" | "compound";
}

export interface RecoveryFactorResult {
  /** Net profit in the same units as returns × initialEquity. */
  netProfit: number;
  /** Max drawdown as a positive number (peak − trough on the equity curve). */
  maxDrawdown: number;
  /** Recovery factor = |net profit| / max drawdown. Infinity if max drawdown = 0. */
  recoveryFactor: number;
  /** Index of the equity-curve peak that preceded the largest drawdown. */
  peakIndex: number;
  /** Index of the equity-curve trough completing the largest drawdown. */
  troughIndex: number;
  /** Final equity value. */
  finalEquity: number;
  sampleSize: number;
  reasoning: string;
}

export function computeRecoveryFactor(input: RecoveryFactorInput): RecoveryFactorResult {
  const returns = input.returns;
  const N = returns.length;
  const initial = input.initialEquity ?? 1;
  const mode = input.compoundMode ?? "compound";

  if (N === 0) {
    return {
      netProfit: 0,
      maxDrawdown: 0,
      recoveryFactor: 0,
      peakIndex: -1,
      troughIndex: -1,
      finalEquity: initial,
      sampleSize: 0,
      reasoning: "empty returns; recovery factor undefined → 0",
    };
  }
  if (initial <= 0) {
    throw new Error("initialEquity must be positive");
  }

  // Build equity curve
  const equity = new Array<number>(N + 1);
  equity[0] = initial;
  for (let i = 0; i < N; i++) {
    if (mode === "compound") {
      equity[i + 1] = equity[i]! * (1 + returns[i]!);
    } else {
      equity[i + 1] = equity[i]! + returns[i]! * initial;
    }
  }

  // Walk to find the LARGEST peak-to-trough drawdown
  let runningPeak = equity[0]!;
  let runningPeakIdx = 0;
  let maxDD = 0;
  let bestPeakIdx = 0;
  let bestTroughIdx = 0;
  for (let i = 1; i <= N; i++) {
    if (equity[i]! > runningPeak) {
      runningPeak = equity[i]!;
      runningPeakIdx = i;
    }
    const dd = runningPeak - equity[i]!;
    if (dd > maxDD) {
      maxDD = dd;
      bestPeakIdx = runningPeakIdx;
      bestTroughIdx = i;
    }
  }

  const finalEquity = equity[N]!;
  const netProfit = finalEquity - initial;
  const recoveryFactor =
    maxDD > 0 ? Math.abs(netProfit) / maxDD : netProfit > 0 ? Number.POSITIVE_INFINITY : 0;

  const reasoning =
    `N=${N}, mode=${mode}; net profit=${netProfit.toFixed(6)}, ` +
    `max drawdown=${maxDD.toFixed(6)} (peak@${bestPeakIdx} → trough@${bestTroughIdx}), ` +
    `recovery factor=${Number.isFinite(recoveryFactor) ? recoveryFactor.toFixed(3) : "∞"}`;

  return {
    netProfit,
    maxDrawdown: maxDD,
    recoveryFactor,
    peakIndex: bestPeakIdx,
    troughIndex: bestTroughIdx,
    finalEquity,
    sampleSize: N,
    reasoning,
  };
}

export function recoveryFactorToPayload(
  result: RecoveryFactorResult,
): Record<string, unknown> {
  return {
    kind: "recovery_factor.computed",
    netProfit: Number(result.netProfit.toFixed(8)),
    maxDrawdown: Number(result.maxDrawdown.toFixed(8)),
    recoveryFactor: Number.isFinite(result.recoveryFactor)
      ? Number(result.recoveryFactor.toFixed(4))
      : null,
    peakIndex: result.peakIndex,
    troughIndex: result.troughIndex,
    finalEquity: Number(result.finalEquity.toFixed(8)),
    sampleSize: result.sampleSize,
  };
}
