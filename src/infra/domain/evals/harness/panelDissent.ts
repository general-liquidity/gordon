/**
 * Panel dissent: preserve judge disagreement instead of averaging it away.
 *
 * `panelJudge.ts` collapses N judges into one mean score. Three judges at
 * 0.9 / 0.9 / 0.9 and three at 0.2 / 0.9 / 1.6 both average to 0.9, yet one is
 * agreement and the other is an unresolved dispute. The CI gate treats both
 * numbers as equally trustworthy. This module computes, alongside the mean,
 * how much the panel actually disagreed, which judge was out of step, and
 * whether the number is safe to gate on at all.
 *
 * Provenance: the disagreement-preservation idea comes from the Sealed Joint
 * Search framework in "AI Trading's Alpha Singularity: Emergent Market
 * Reasoning through Agent-to-Agent Self-Evolution" (Panda AI, 2026), where
 * three independent evaluator instances write narrative reports that an
 * orchestrator aggregates "so adjudication carries forward disagreement rather
 * than collapsing it to a vote". Be honest about what that paper does and does
 * not establish: its headline is a holdout portfolio Sharpe of +1.87 against a
 * strongest baseline of +1.334 at a favourable seed and -0.755 on the
 * cross-seed mean, the full run is SINGLE-SEED, and the signal is short-side
 * concentrated. That result is not evidence for anything here. We adopt the
 * pattern because the averaging argument stands on its own terms, and its
 * Sharpe must not be cited as support for this module.
 *
 * The same paper makes a second point worth encoding: the scoring function is
 * itself a search artifact, so a search that converges against a fixed scorer
 * overfits whatever that scorer cannot penalise. A panel drifting toward
 * agreement over successive runs is therefore not necessarily getting more
 * accurate, which is what `detectDissentConvergence` surfaces.
 *
 * Pure and deterministic: no clock, no I/O, no randomness. Same inputs give
 * byte-identical output, so a dissent verdict can itself be a CI assertion.
 */

import type { EvalTrajectory, PanelJudgeEntry } from "./types.ts";

/** One judge's verdict on one trajectory, kept intact for minority reporting. */
export interface JudgeScoreEntry {
  judgeModel: string;
  score: number;
  explanation?: string;
}

/**
 * The panel's epistemic state on a single trajectory.
 *
 *   consensus    judges land close enough that the mean means something.
 *   dispersed    scores spread out roughly evenly, nobody clusters.
 *   polarised    two tight clusters far apart, with one larger than the other.
 *   split        two clusters of equal size, so there is no majority at all.
 *   unverifiable fewer than two judges scored it, so agreement is untestable.
 *
 * Polarised and dispersed are deliberately separate: a bimodal panel says the
 * trajectory sits on a genuine judgment boundary, which is a different signal
 * from judges being uniformly uncertain at the same spread.
 */
export type DissentPattern =
  | "consensus"
  | "dispersed"
  | "polarised"
  | "split"
  | "unverifiable";

/** Whether the consensus score is trustworthy enough to gate CI on. */
export type PanelVerdict =
  | "safe_to_gate"
  | "caution"
  | "unsafe_to_gate"
  | "unverifiable";

/**
 * Rank disagreement and magnitude disagreement are different failures and must
 * not be reported as one number. Judges can order trajectories identically
 * while disagreeing on level (a calibration difference, comparisons still
 * hold), or agree on level while ordering differently (the comparison itself
 * is contested, which is worse for a ranking harness).
 */
export type AgreementMode =
  | "aligned"
  | "level_disagreement"
  | "rank_disagreement"
  | "unverifiable";

export interface TrajectoryDissent {
  trajectoryId: string;
  /** Number of surviving judges that scored this trajectory. */
  judgeCount: number;
  /** Mean across judges. Mirrors what `averageScores` produces. */
  meanScore: number;
  /** Median, used as the dissent centre because the mean absorbs the outlier. */
  medianScore: number;
  /** max - min, on the score scale. */
  spread: number;
  /** Mean |score - median|: typical disagreement, not worst-case. */
  meanAbsoluteDeviation: number;
  /** 0..1 share of the spread explained by a two-cluster split. */
  polarisation: number;
  pattern: DissentPattern;
  /** The judge furthest from the median, and which way it leans. */
  dissenter?: {
    judgeModel: string;
    score: number;
    direction: "above" | "below";
    deviation: number;
  };
  /** The losing position, kept readable rather than discarded. */
  minorityView: ReadonlyArray<JudgeScoreEntry>;
  majorityView: ReadonlyArray<JudgeScoreEntry>;
  /** Every judge's raw verdict, in panel order. */
  perJudge: ReadonlyArray<JudgeScoreEntry>;
}

export interface PanelDissentReport {
  scenarioId: string;
  /** Surviving judges considered. */
  judgeCount: number;
  perTrajectory: ReadonlyArray<TrajectoryDissent>;
  /** Worst per-trajectory spread in the scenario. */
  maxSpread: number;
  /**
   * Mean pairwise Kendall tau-b across judges over their trajectory orderings,
   * in [-1, 1]. Undefined when there are fewer than two judges or fewer than
   * two trajectories, or when every judge scored everything identically.
   */
  rankAgreement?: number;
  agreementMode: AgreementMode;
  verdict: PanelVerdict;
  /** Convenience branch for callers that only need pass/hold. */
  safeToGate: boolean;
  /** Human-readable justification for the verdict. */
  reasons: ReadonlyArray<string>;
}

export interface PanelDissentOptions {
  /** Spread at or below which judges count as agreeing. Default 0.15. */
  consensusSpread?: number;
  /** Spread above which the consensus number stops being gateable. Default 0.35. */
  unsafeSpread?: number;
  /** Two-cluster share above which a panel counts as bimodal. Default 0.75. */
  polarisationRatio?: number;
  /** Kendall tau-b below which orderings count as contested. Default 0.5. */
  rankAgreementBar?: number;
}

export const DEFAULT_CONSENSUS_SPREAD = 0.15;
export const DEFAULT_UNSAFE_SPREAD = 0.35;
export const DEFAULT_POLARISATION_RATIO = 0.75;
export const DEFAULT_RANK_AGREEMENT_BAR = 0.5;

/**
 * Quantify disagreement across a panel without touching the consensus score.
 *
 * Statistic choice, and what was rejected:
 *
 * The headline magnitude statistic is the SPREAD (max - min), reported next to
 * the mean absolute deviation from the median. Spread lives on the same 0..1
 * scale as the scores, so a threshold like "0.35 apart" is directly meaningful
 * to an operator reading a gate failure, and it bounds the worst case: it is
 * the largest amount by which the mean could be misrepresenting some judge.
 *
 * Variance and standard deviation were rejected for the headline. Squaring
 * makes a single distant judge dominate, which conflates exactly the two
 * situations this module exists to separate: one judge out of step versus the
 * whole panel uncertain. Variance is also off-scale, so no threshold on it
 * reads as anything an operator can reason about.
 *
 * A purely rank-based statistic was rejected for magnitude because it is blind
 * by construction to a uniform level shift, and a panel that agrees on ordering
 * while disagreeing on level is a real and separate failure. Rank information
 * is not discarded: it is computed separately as Kendall tau-b and surfaced as
 * `rankAgreement` / `agreementMode`, so the two failures stay distinguishable
 * in the output. Kendall over Spearman because tau-b handles the tied scores a
 * judge routinely emits without ad-hoc rank averaging.
 *
 * Spread alone cannot tell bimodal from uniform, so it is paired with a
 * two-cluster fit (`polarisation`) that drives the pattern classification.
 */
export function computePanelDissent(
  scenarioId: string,
  panel: ReadonlyArray<PanelJudgeEntry>,
  trajectories: ReadonlyArray<EvalTrajectory>,
  options: PanelDissentOptions = {},
): PanelDissentReport {
  const consensusSpread = options.consensusSpread ?? DEFAULT_CONSENSUS_SPREAD;
  const unsafeSpread = options.unsafeSpread ?? DEFAULT_UNSAFE_SPREAD;
  const polarisationBar = options.polarisationRatio ?? DEFAULT_POLARISATION_RATIO;
  const rankBar = options.rankAgreementBar ?? DEFAULT_RANK_AGREEMENT_BAR;

  const surviving = panel.filter((e) => !e.failed && e.scored.length > 0);

  const byTrajectory = new Map<string, JudgeScoreEntry[]>();
  for (const entry of surviving) {
    for (const scored of entry.scored) {
      const bucket = byTrajectory.get(scored.id) ?? [];
      bucket.push({
        judgeModel: entry.judgeModel,
        score: scored.score,
        explanation: scored.explanation || undefined,
      });
      byTrajectory.set(scored.id, bucket);
    }
  }

  const perTrajectory = trajectories.map((t) =>
    analyseTrajectory(t.id, byTrajectory.get(t.id) ?? [], consensusSpread, polarisationBar),
  );

  const maxSpread = perTrajectory.reduce((m, d) => Math.max(m, d.spread), 0);
  const rankAgreement = meanPairwiseKendallTau(surviving);

  const reasons: string[] = [];
  let agreementMode: AgreementMode;
  if (surviving.length < 2) {
    agreementMode = "unverifiable";
  } else if (rankAgreement !== undefined && rankAgreement < rankBar) {
    agreementMode = "rank_disagreement";
    reasons.push(
      `judges order trajectories differently (kendall tau-b ${round(rankAgreement)} < ${rankBar})`,
    );
  } else if (maxSpread > consensusSpread) {
    agreementMode = "level_disagreement";
    reasons.push(
      `judges agree on ordering but not on level (max spread ${round(maxSpread)} > ${consensusSpread})`,
    );
  } else {
    agreementMode = "aligned";
  }

  const contested = perTrajectory.filter(
    (d) => d.pattern === "polarised" || d.pattern === "split",
  );
  const dispersed = perTrajectory.filter((d) => d.pattern === "dispersed");

  let verdict: PanelVerdict;
  if (surviving.length === 0) {
    verdict = "unverifiable";
    reasons.push("no judge survived, so there is no panel score to trust");
  } else if (surviving.length === 1) {
    // Zero measured disagreement because nobody could disagree is not
    // agreement. Reporting a lone judge as perfect consensus would launder a
    // single-judge score, and single-judge self-preference is the bias the
    // panel exists to cancel.
    verdict = "unverifiable";
    reasons.push(
      `only ${surviving[0]?.judgeModel ?? "one judge"} survived, so agreement is untestable`,
    );
  } else if (contested.length > 0 || maxSpread > unsafeSpread) {
    verdict = "unsafe_to_gate";
    for (const d of contested) {
      reasons.push(`${d.trajectoryId}: ${d.pattern} panel (spread ${round(d.spread)})`);
    }
    if (maxSpread > unsafeSpread) {
      reasons.push(`max spread ${round(maxSpread)} exceeds gate tolerance ${unsafeSpread}`);
    }
  } else if (dispersed.length > 0 || agreementMode === "rank_disagreement") {
    verdict = "caution";
    for (const d of dispersed) {
      reasons.push(`${d.trajectoryId}: dispersed panel (spread ${round(d.spread)})`);
    }
  } else {
    verdict = "safe_to_gate";
  }

  return {
    scenarioId,
    judgeCount: surviving.length,
    perTrajectory,
    maxSpread: round(maxSpread),
    rankAgreement: rankAgreement === undefined ? undefined : round(rankAgreement),
    agreementMode,
    verdict,
    safeToGate: verdict === "safe_to_gate",
    reasons,
  };
}

function analyseTrajectory(
  trajectoryId: string,
  perJudge: ReadonlyArray<JudgeScoreEntry>,
  consensusSpread: number,
  polarisationBar: number,
): TrajectoryDissent {
  if (perJudge.length === 0) {
    return {
      trajectoryId,
      judgeCount: 0,
      meanScore: 0,
      medianScore: 0,
      spread: 0,
      meanAbsoluteDeviation: 0,
      polarisation: 0,
      pattern: "unverifiable",
      minorityView: [],
      majorityView: [],
      perJudge: [],
    };
  }

  const scores = perJudge.map((j) => j.score);
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const median = medianOf(scores);
  const sorted = [...scores].sort((a, b) => a - b);
  const lo = sorted[0] ?? 0;
  const hi = sorted[sorted.length - 1] ?? 0;
  const spread = hi - lo;
  const mad = scores.reduce((a, s) => a + Math.abs(s - median), 0) / scores.length;

  const split = bestTwoClusterSplit(sorted);
  const polarisation = spread === 0 ? 0 : 1 - split.withinSpread / spread;

  let pattern: DissentPattern;
  if (perJudge.length < 2) {
    pattern = "unverifiable";
  } else if (spread <= consensusSpread) {
    pattern = "consensus";
  } else if (polarisation >= polarisationBar) {
    // Equal-size clusters mean no side outweighs the other, so the panel is
    // split rather than merely polarised: there is no majority to defer to.
    pattern = split.lowerCount === perJudge.length - split.lowerCount ? "split" : "polarised";
  } else {
    pattern = "dispersed";
  }

  const ordered = [...perJudge].sort((a, b) => a.score - b.score);
  const lowerSide = ordered.slice(0, split.lowerCount);
  const upperSide = ordered.slice(split.lowerCount);
  // On an equal-size split the lower side is the minority by convention, so the
  // choice is deterministic rather than dependent on judge ordering.
  const minorityIsLower = lowerSide.length <= upperSide.length;
  const minorityView = pattern === "consensus" || pattern === "unverifiable"
    ? []
    : minorityIsLower
      ? lowerSide
      : upperSide;
  const majorityView = pattern === "consensus" || pattern === "unverifiable"
    ? []
    : minorityIsLower
      ? upperSide
      : lowerSide;

  let dissenter: TrajectoryDissent["dissenter"];
  if (perJudge.length >= 2 && spread > 0) {
    let worst = perJudge[0] as JudgeScoreEntry;
    let worstDeviation = Math.abs(worst.score - median);
    for (const j of perJudge) {
      const deviation = Math.abs(j.score - median);
      if (deviation > worstDeviation) {
        worst = j;
        worstDeviation = deviation;
      }
    }
    dissenter = {
      judgeModel: worst.judgeModel,
      score: worst.score,
      direction: worst.score >= median ? "above" : "below",
      deviation: round(worstDeviation),
    };
  }

  return {
    trajectoryId,
    judgeCount: perJudge.length,
    meanScore: round(mean),
    medianScore: round(median),
    spread: round(spread),
    meanAbsoluteDeviation: round(mad),
    polarisation: round(polarisation),
    pattern,
    dissenter,
    minorityView,
    majorityView,
    perJudge,
  };
}

/**
 * Cheapest two-cluster partition of an ascending score list: the split point
 * that minimises the summed within-cluster spread. With at most a handful of
 * judges the exhaustive scan is trivially cheap and exactly optimal, so no
 * clustering heuristic is warranted.
 */
function bestTwoClusterSplit(sorted: ReadonlyArray<number>): {
  lowerCount: number;
  withinSpread: number;
} {
  if (sorted.length < 2) return { lowerCount: sorted.length, withinSpread: 0 };
  let bestCount = 1;
  let bestWithin = Number.POSITIVE_INFINITY;
  for (let k = 1; k < sorted.length; k += 1) {
    const lowLo = sorted[0] ?? 0;
    const lowHi = sorted[k - 1] ?? 0;
    const highLo = sorted[k] ?? 0;
    const highHi = sorted[sorted.length - 1] ?? 0;
    const within = lowHi - lowLo + (highHi - highLo);
    if (within < bestWithin) {
      bestWithin = within;
      bestCount = k;
    }
  }
  return { lowerCount: bestCount, withinSpread: bestWithin };
}

function medianOf(scores: ReadonlyArray<number>): number {
  const sorted = [...scores].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/**
 * Mean Kendall tau-b over every judge pair, computed on the trajectories both
 * members of the pair scored. Undefined when no pair has two shared
 * trajectories, or when every comparable pair is fully tied on one side.
 */
function meanPairwiseKendallTau(
  surviving: ReadonlyArray<PanelJudgeEntry>,
): number | undefined {
  if (surviving.length < 2) return undefined;
  const taus: number[] = [];
  for (let i = 0; i < surviving.length; i += 1) {
    for (let j = i + 1; j < surviving.length; j += 1) {
      const a = surviving[i];
      const b = surviving[j];
      if (!a || !b) continue;
      const tau = kendallTauB(a, b);
      if (tau !== undefined) taus.push(tau);
    }
  }
  if (taus.length === 0) return undefined;
  return taus.reduce((x, y) => x + y, 0) / taus.length;
}

function kendallTauB(a: PanelJudgeEntry, b: PanelJudgeEntry): number | undefined {
  const bScores = new Map(b.scored.map((s) => [s.id, s.score]));
  const paired: Array<{ x: number; y: number }> = [];
  for (const s of a.scored) {
    const y = bScores.get(s.id);
    if (y === undefined) continue;
    paired.push({ x: s.score, y });
  }
  if (paired.length < 2) return undefined;

  let concordant = 0;
  let discordant = 0;
  let tiedX = 0;
  let tiedY = 0;
  for (let i = 0; i < paired.length; i += 1) {
    for (let j = i + 1; j < paired.length; j += 1) {
      const p = paired[i];
      const q = paired[j];
      if (!p || !q) continue;
      const dx = Math.sign(p.x - q.x);
      const dy = Math.sign(p.y - q.y);
      if (dx === 0 && dy === 0) {
        tiedX += 1;
        tiedY += 1;
      } else if (dx === 0) {
        tiedX += 1;
      } else if (dy === 0) {
        tiedY += 1;
      } else if (dx === dy) {
        concordant += 1;
      } else {
        discordant += 1;
      }
    }
  }
  const total = (paired.length * (paired.length - 1)) / 2;
  const denominator = Math.sqrt((total - tiedX) * (total - tiedY));
  if (denominator === 0) return undefined;
  return (concordant - discordant) / denominator;
}

export interface DissentTrend {
  /** Number of reports in the history. */
  n: number;
  /** Least-squares slope of max spread over run index. */
  slope: number;
  /** Mean max spread across the history. */
  meanSpread: number;
  /**
   * True when dissent is falling run over run. Read as a warning, not a win:
   * a panel converging against a fixed scorer may be overfitting what that
   * scorer cannot penalise rather than getting more accurate.
   */
  converging: boolean;
}

/**
 * Track whether the panel is drifting toward agreement across runs. Ordered
 * oldest first. Pure: index position stands in for time, no clock is read.
 */
export function detectDissentConvergence(
  history: ReadonlyArray<PanelDissentReport>,
  options: { slopeBar?: number } = {},
): DissentTrend {
  const slopeBar = options.slopeBar ?? 0.01;
  const spreads = history.map((h) => h.maxSpread);
  const n = spreads.length;
  if (n < 2) {
    return { n, slope: 0, meanSpread: round(spreads[0] ?? 0), converging: false };
  }
  const meanX = (n - 1) / 2;
  const meanY = spreads.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = i - meanX;
    num += dx * ((spreads[i] ?? 0) - meanY);
    den += dx * dx;
  }
  const slope = den === 0 ? 0 : num / den;
  return {
    n,
    slope: round(slope),
    meanSpread: round(meanY),
    converging: slope <= -slopeBar,
  };
}

function round(value: number): number {
  return Number(value.toFixed(4));
}
