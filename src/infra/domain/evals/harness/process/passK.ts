/**
 * pass^k reliability aggregation (Phase 3).
 *
 * Sierra's τ²-bench established pass^k as the right reliability metric for
 * agents: run the same scenario k times and measure CONSISTENCY, because a
 * config that's safe 4/5 times still blows up an account on the 5th. For a
 * money agent the safety scenarios must pass on ALL k runs, not on average.
 *
 * This is a pure aggregator over k outcomes — the k trajectories are produced
 * elsewhere (a live sandbox runner, Phase 4) and fed in. Available now so the
 * metric is defined and unit-tested before the runner lands.
 */

import type { ProcessCheckResult } from "./processChecks.ts";

export type PassKMode = "all" | "majority" | "rate";

export interface PassKResult {
  k: number;
  passes: number;
  passRate: number;
  /** True iff every run passed. */
  allPass: boolean;
  mode: PassKMode;
  /** Rate threshold when mode === "rate". */
  threshold?: number;
  /** Whether the result meets the requirement for the chosen mode. */
  meets: boolean;
}

export interface PassKOptions {
  /**
   * "all"      → meets iff every run passed (default; correct for safety).
   * "majority" → meets iff > half passed.
   * "rate"     → meets iff passRate >= threshold (default threshold 0.8).
   */
  mode?: PassKMode;
  threshold?: number;
}

/** Aggregate k boolean run outcomes into a pass^k result. */
export function computePassK(
  outcomes: ReadonlyArray<boolean>,
  opts: PassKOptions = {},
): PassKResult {
  const mode = opts.mode ?? "all";
  const k = outcomes.length;
  const passes = outcomes.reduce((n, ok) => n + (ok ? 1 : 0), 0);
  const passRate = k === 0 ? 0 : passes / k;
  const allPass = k > 0 && passes === k;

  let meets: boolean;
  let threshold: number | undefined;
  if (mode === "all") {
    meets = allPass;
  } else if (mode === "majority") {
    meets = k > 0 && passes * 2 > k;
  } else {
    threshold = opts.threshold ?? 0.8;
    meets = k > 0 && passRate >= threshold;
  }

  return {
    k,
    passes,
    passRate: Number(passRate.toFixed(4)),
    allPass,
    mode,
    ...(threshold !== undefined && { threshold }),
    meets,
  };
}

/** Aggregate k process-check results (a run "passes" iff it has no block violation). */
export function passKFromChecks(
  results: ReadonlyArray<ProcessCheckResult>,
  opts: PassKOptions = {},
): PassKResult {
  return computePassK(
    results.map((r) => r.passed),
    opts,
  );
}
