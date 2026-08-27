/**
 * Edge Decay Monitor (GORDON_EDGE_DECAY).
 *
 * Port of Ch 7 from Wright. The cycle of edge decay: discovery →
 * imitation → crowding → inversion. The professional doesn't marry
 * the edge, they date it. Monitor per-strategy expectancy over time;
 * when realized R drops below a fraction of historical, scale down or
 * retire.
 *
 *   "When a setup that used to average +0.5R is now printing +0.2R,
 *    scale it down. When it drifts toward zero after costs, retire it
 *    and look for the next one."
 *
 * Computes a rolling expectancy window vs an earlier baseline window
 * and emits a decay verdict. Distinct from WW4 frictionTracker (which
 * measures cost) and `evals/tradeEvaluator` (ensemble PnL). This is
 * specifically: is my edge eroding?
 */

export type DecayState = "stable" | "degraded" | "retire";

export interface DecayInput {
  /** Strategy / setup identifier. */
  setupId: string;
  /** Realized R-multiples of trades, ordered most-recent first. */
  rMultiples: ReadonlyArray<number>;
  /** Number of trades to use as the "recent" window. Default 20. */
  recentWindow?: number;
  /**
   * Number of trades to use as the historical baseline (immediately
   * preceding the recent window). Default 40.
   */
  baselineWindow?: number;
  /**
   * Recent expectancy must be at least this fraction of baseline to
   * stay "stable". Default 0.6. Below half → retire.
   */
  degradedThreshold?: number;
  retireThreshold?: number;
}

export interface DecayResult {
  setupId: string;
  recentExpectancy: number;
  baselineExpectancy: number;
  ratio: number;
  state: DecayState;
  recommendedSizeMultiplier: number;
  reason: string;
}

const DEFAULT_RECENT = 20;
const DEFAULT_BASELINE = 40;
const DEFAULT_DEGRADED = 0.6;
const DEFAULT_RETIRE = 0.3;

function mean(xs: ReadonlyArray<number>): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

export function evaluateDecay(input: DecayInput): DecayResult {
  const recentWin = input.recentWindow ?? DEFAULT_RECENT;
  const baseWin = input.baselineWindow ?? DEFAULT_BASELINE;
  const degraded = input.degradedThreshold ?? DEFAULT_DEGRADED;
  const retire = input.retireThreshold ?? DEFAULT_RETIRE;

  const recent = input.rMultiples.slice(0, recentWin);
  const baseline = input.rMultiples.slice(recentWin, recentWin + baseWin);

  if (recent.length < recentWin || baseline.length < baseWin) {
    return {
      setupId: input.setupId,
      recentExpectancy: mean(recent),
      baselineExpectancy: mean(baseline),
      ratio: 1,
      state: "stable",
      recommendedSizeMultiplier: 1.0,
      reason: `Insufficient sample (${recent.length}+${baseline.length}/${recentWin}+${baseWin}) — assume stable until data accumulates`,
    };
  }

  const recentR = mean(recent);
  const baselineR = mean(baseline);
  const ratio = baselineR > 0 ? recentR / baselineR : recentR >= 0 ? 1 : 0;

  let state: DecayState;
  let mult: number;
  let reason: string;
  if (baselineR <= 0) {
    state = "stable";
    mult = 1.0;
    reason = `Baseline expectancy non-positive (${baselineR.toFixed(3)}) — decay undefined`;
  } else if (ratio < retire) {
    state = "retire";
    mult = 0;
    reason = `Recent ${recentR.toFixed(2)}R is ${(ratio * 100).toFixed(0)}% of baseline ${baselineR.toFixed(2)}R — retire setup`;
  } else if (ratio < degraded) {
    state = "degraded";
    mult = ratio;
    reason = `Recent ${recentR.toFixed(2)}R is ${(ratio * 100).toFixed(0)}% of baseline — scale down`;
  } else {
    state = "stable";
    mult = 1.0;
    reason = `Recent expectancy ${recentR.toFixed(2)}R within ${(ratio * 100).toFixed(0)}% of baseline — edge intact`;
  }

  return {
    setupId: input.setupId,
    recentExpectancy: recentR,
    baselineExpectancy: baselineR,
    ratio,
    state,
    recommendedSizeMultiplier: mult,
    reason,
  };
}

export function decayToPayload(result: DecayResult): Record<string, unknown> {
  return {
    kind: "edge_decay.evaluated",
    setupId: result.setupId,
    state: result.state,
    ratio: Number(result.ratio.toFixed(3)),
    recommendedSizeMultiplier: result.recommendedSizeMultiplier,
  };
}
