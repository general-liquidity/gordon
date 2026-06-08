/**
 * Goal-progress stall detection.
 *
 * Gordon's autonomous loop already halts on the obvious conditions — goal
 * achieved/failed, mandate expiry, token/cost budget, max iterations, identical-
 * fingerprint doom-loops, and A-B-A-B cycles. None of those catch a SEMANTIC
 * stall: the loop making varied, coherent moves cycle after cycle while goal
 * progress plateaus. That's the "different-but-coherent action amplification" gap
 * (a spinning money-agent burning tokens without advancing), and the third
 * guardrail every serious agent-loop design requires (no-progress detection)
 * alongside the iteration-cap and budget halt Gordon already has.
 *
 * Detection is over the per-cycle progressPct sequence, using a WINDOWED-best
 * comparison (did the best-so-far advance by ≥ minDelta over the last `patience`
 * cycles?) — so slow-but-real progress is NOT flagged, only a genuine plateau.
 * Pure; never throws.
 */

export interface GoalStallOptions {
  /** Minimum best-progress gain over the patience window to count as advancing. Default 0.01 (1pp). */
  minDelta?: number;
  /** Cycles of no meaningful new progress before halting. Default 6. */
  patience?: number;
}

export interface GoalStallResult {
  stalled: boolean;
  /** Cycles since progress last set a new high (any amount). */
  cyclesSinceImprovement: number;
  bestProgressPct: number;
  latestProgressPct: number;
  /** Best-progress gain over the last `patience` cycles. */
  windowGain: number;
  patience: number;
  recommendation: "continue" | "stall_warning" | "halt";
  interpretation: string;
}

const COMPLETE = 0.999;

export function detectGoalStall(progressHistory: number[], opts: GoalStallOptions = {}): GoalStallResult {
  const minDelta = opts.minDelta && opts.minDelta > 0 ? opts.minDelta : 0.01;
  const patience = Math.max(2, Math.floor(opts.patience ?? 6));
  const h = (progressHistory ?? []).filter((x) => Number.isFinite(x));
  const n = h.length;

  const base = (rec: GoalStallResult["recommendation"], interp: string, extra: Partial<GoalStallResult> = {}): GoalStallResult => ({
    stalled: rec === "halt",
    cyclesSinceImprovement: 0,
    bestProgressPct: n > 0 ? Math.max(...h) : 0,
    latestProgressPct: n > 0 ? h[n - 1]! : 0,
    windowGain: 0,
    patience,
    recommendation: rec,
    interpretation: interp,
    ...extra,
  });

  if (n === 0) return base("continue", "no progress data yet");

  const latest = h[n - 1]!;
  const bestNow = Math.max(...h);

  // Cycles since a new running-max high (for reporting).
  let runningMax = h[0]!;
  let lastHighIdx = 0;
  for (let i = 1; i < n; i++) {
    if (h[i]! > runningMax) {
      runningMax = h[i]!;
      lastHighIdx = i;
    }
  }
  const cyclesSinceImprovement = n - 1 - lastHighIdx;

  if (latest >= COMPLETE) {
    return base("continue", `progress ${(latest * 100).toFixed(0)}% — effectively complete, not stalled`, { cyclesSinceImprovement });
  }
  if (n <= patience) {
    return base("continue", `only ${n} cycle(s) of progress — too early to judge stall (patience ${patience})`, { cyclesSinceImprovement });
  }

  const bestBefore = Math.max(...h.slice(0, n - patience));
  const windowGain = bestNow - bestBefore;
  const stalled = windowGain < minDelta;
  const warn = !stalled && cyclesSinceImprovement >= Math.ceil(patience / 2);

  const recommendation: GoalStallResult["recommendation"] = stalled ? "halt" : warn ? "stall_warning" : "continue";
  const interpretation = stalled
    ? `STALLED — best progress advanced only ${(windowGain * 100).toFixed(1)}pp over the last ${patience} cycles (< ${(minDelta * 100).toFixed(1)}pp); loop is spinning without advancing → halt`
    : warn
      ? `${cyclesSinceImprovement} cycles since a new progress high (best ${(bestNow * 100).toFixed(0)}%) — watch for stall`
      : `progressing: +${(windowGain * 100).toFixed(1)}pp best-progress over the last ${patience} cycles`;

  return {
    stalled,
    cyclesSinceImprovement,
    bestProgressPct: parseFloat(bestNow.toFixed(4)),
    latestProgressPct: parseFloat(latest.toFixed(4)),
    windowGain: parseFloat(windowGain.toFixed(4)),
    patience,
    recommendation,
    interpretation,
  };
}
