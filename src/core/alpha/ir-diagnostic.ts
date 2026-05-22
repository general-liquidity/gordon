/**
 * Information Ratio (IR) diagnostic — combines per-signal IC tracker
 * snapshots with effective-N to produce the operator-facing edge
 * estimate.
 *
 * Grinold-Kahn 1989/1995, "Active Portfolio Management":
 *
 *     IR ≈ IC × √(effective N)
 *
 * This module is purely diagnostic — does not feed into Gordon's
 * risk classifier or position sizer. It reports what the math implies
 * given current IC estimates + correlation structure, so the operator
 * can see whether their current signal stack has enough effective
 * breadth + per-signal IC to justify the position sizes being taken.
 *
 * Institutional reference IR tiers (canonical):
 *
 *   weak         IR < 0.25      not enough edge to overcome costs
 *   moderate     0.25 ≤ IR < 0.5   acceptable for a single-strategy fund
 *   strong       0.5  ≤ IR < 1.0   institutional-quality strategy
 *   exceptional  IR ≥ 1.0       rarefied territory; verify before believing
 *
 * NB the diagnostic is OPTIMISTIC by default — it doesn't subtract
 * transaction costs from per-signal IC. Combine with the
 * cost-aware Kelly path (shipped in commit e6a31f0c) for an honest
 * after-cost view.
 */

import type { IcSnapshot } from "./ic-tracker.ts";

export type IrVerdict = "weak" | "moderate" | "strong" | "exceptional" | "insufficient_data";

export interface IrDiagnostic {
  /** Mean of |IC| across signals that had a non-null IC. */
  meanAbsIc: number;
  /** Standard deviation of |IC| across signals. */
  icDispersion: number;
  /** Effective N input (caller supplies from `computeEffectiveN`). */
  effectiveN: number;
  /** Estimated combined IR = meanAbsIc × √effectiveN. */
  estimatedIr: number;
  /** Approximate 95% CI half-width on the IR estimate. */
  ir95HalfWidth: number;
  /** Number of signals included (with non-null IC). */
  signalsUsed: number;
  /** Signals excluded (null IC, noise verdict, etc.). */
  signalsExcluded: string[];
  /** Operator-facing tier. */
  verdict: IrVerdict;
  /** Human-readable summary. */
  summary: string;
}

export interface IrDiagnosticOptions {
  /** IR < this → weak. Default 0.25. */
  weakThreshold?: number;
  /** IR < this → moderate. Default 0.5. */
  moderateThreshold?: number;
  /** IR < this → strong. Default 1.0. */
  strongThreshold?: number;
  /** When true, exclude signals with verdict ∈ {noise, decaying, unstable, insufficient_data}. Default true. */
  excludeInactive?: boolean;
}

const DEFAULT_OPTIONS: Required<IrDiagnosticOptions> = {
  weakThreshold: 0.25,
  moderateThreshold: 0.5,
  strongThreshold: 1.0,
  excludeInactive: true,
};

/**
 * Compute the combined IR diagnostic.
 *
 * @param snapshots Per-signal IC snapshots from `trackIc`
 * @param effectiveN Effective N from `computeEffectiveN` (use snapshots.length when no correlation data available)
 */
export function computeIrDiagnostic(
  snapshots: IcSnapshot[],
  effectiveN: number,
  options: IrDiagnosticOptions = {},
): IrDiagnostic {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const excluded: string[] = [];
  const usableAbsIcs: number[] = [];
  const usableHalfWidths: number[] = [];

  for (const snap of snapshots) {
    if (snap.ic === null) {
      excluded.push(`${snap.signalName} (null IC)`);
      continue;
    }
    if (
      opts.excludeInactive &&
      (snap.verdict === "noise" ||
        snap.verdict === "decaying" ||
        snap.verdict === "unstable" ||
        snap.verdict === "insufficient_data")
    ) {
      excluded.push(`${snap.signalName} (${snap.verdict})`);
      continue;
    }
    usableAbsIcs.push(Math.abs(snap.ic));
    usableHalfWidths.push(snap.ic95HalfWidth);
  }

  if (usableAbsIcs.length === 0 || effectiveN <= 0) {
    return {
      meanAbsIc: 0,
      icDispersion: 0,
      effectiveN,
      estimatedIr: 0,
      ir95HalfWidth: 0,
      signalsUsed: 0,
      signalsExcluded: excluded,
      verdict: "insufficient_data",
      summary:
        excluded.length > 0
          ? `No active signals usable for IR (excluded: ${excluded.join(", ")})`
          : "No signals submitted",
    };
  }

  const meanAbsIc =
    usableAbsIcs.reduce((sum, v) => sum + v, 0) / usableAbsIcs.length;
  const variance =
    usableAbsIcs.length > 1
      ? usableAbsIcs.reduce((sum, v) => sum + (v - meanAbsIc) ** 2, 0) /
        (usableAbsIcs.length - 1)
      : 0;
  const dispersion = Math.sqrt(variance);

  const sqrtN = Math.sqrt(effectiveN);
  const estimatedIr = meanAbsIc * sqrtN;

  // Approx IR 95% CI: propagate the mean-IC CI through the √N scaling.
  // SE_IC ≈ mean of per-signal IC half-widths / √k where k = signals used.
  const meanHalfWidth =
    usableHalfWidths.reduce((s, v) => s + v, 0) / usableHalfWidths.length;
  const seIc = meanHalfWidth / Math.sqrt(usableAbsIcs.length);
  const ir95 = seIc * sqrtN;

  let verdict: IrVerdict;
  if (estimatedIr < opts.weakThreshold) verdict = "weak";
  else if (estimatedIr < opts.moderateThreshold) verdict = "moderate";
  else if (estimatedIr < opts.strongThreshold) verdict = "strong";
  else verdict = "exceptional";

  const summary =
    `${usableAbsIcs.length} signals, |IC| mean=${meanAbsIc.toFixed(3)} ` +
    `(σ=${dispersion.toFixed(3)}), effective N=${effectiveN.toFixed(2)} → ` +
    `IR ${estimatedIr.toFixed(3)} ± ${ir95.toFixed(3)} → ${verdict}`;

  return {
    meanAbsIc,
    icDispersion: dispersion,
    effectiveN,
    estimatedIr,
    ir95HalfWidth: ir95,
    signalsUsed: usableAbsIcs.length,
    signalsExcluded: excluded,
    verdict,
    summary,
  };
}
