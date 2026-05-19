/**
 * Autoresearch Loop Decision Engine (GORDON_RESEARCH_LOOP).
 *
 * Pure-compute orchestrator for a Karpathy-style "keep / revert" research
 * loop. Given a history of strategy experiments — each with a hypothesis,
 * a parent baseline, a walk-forward score, and a strategy family — this
 * module produces the keep/revert decision for the most recent candidate,
 * the current best baseline, and (when the recent history clusters in
 * one family) a diversity-steering hint that nudges the next exploration
 * away from local optima.
 *
 * Pattern from `autoresearch-trading-main/agent.py`:
 *   - The agent proposes a strategy
 *   - The framework optimizes parameters + walk-forward scores it
 *   - This decision engine compares to baseline + decides keep/revert
 *   - Curated history (best / recent / per-family) feeds the next prompt
 *
 * Pure compute. No side effects, no LLM calls, no git operations. The
 * caller (researcher agent or orchestrator) holds the actual artifacts;
 * this module decides what the next move should be.
 */

export const RESEARCH_LOOP_FLAG_ENV = "GORDON_RESEARCH_LOOP";

export function isResearchLoopEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[RESEARCH_LOOP_FLAG_ENV] === "1" || env[RESEARCH_LOOP_FLAG_ENV] === "true";
}

export type ExperimentStatus = "candidate" | "kept" | "reverted" | "errored";

export interface Experiment {
  id: string;
  /** Baseline this experiment derived from. null = root experiment. */
  parentId: string | null;
  hypothesis: string;
  /** Walk-forward score (higher is better). NaN if errored. */
  score: number;
  /** Strategy family for diversity steering. Examples: "momentum", "mean-reversion", "breakout", "vol-targeting". */
  family: string;
  /** Unix ms when the experiment finished. */
  timestamp: number;
  status: ExperimentStatus;
}

export interface ResearchLoopInput {
  /** Full experiment history, oldest first. */
  experiments: ReadonlyArray<Experiment>;
  /** The candidate just completed and awaiting a keep/revert decision. */
  candidate: Experiment;
  /** Minimum improvement over baseline to count as a "keep". Default 0.0 (any positive delta). */
  keepThreshold?: number;
  /** Window for family-clustering detection. Default 6 recent kept-or-reverted experiments. */
  diversityWindow?: number;
  /** Fraction of the diversity window that must share a family to trigger a diversity hint. Default 0.66. */
  diversityClusterFraction?: number;
}

export type KeepRevertDecision = "keep" | "revert" | "investigate";

export interface CuratedHistory {
  /** Top-K kept experiments by score, descending. */
  topKept: Experiment[];
  /** Most recent kept-or-reverted experiments. */
  recent: Experiment[];
  /** Per-family best kept experiment. */
  bestByFamily: Record<string, Experiment>;
  /** Notable failures (high-potential families that were close misses). */
  closeMisses: Experiment[];
}

export interface ResearchLoopResult {
  decision: KeepRevertDecision;
  /** Current best baseline AFTER applying this decision. */
  baseline: Experiment | null;
  /** Improvement vs. previous baseline (score delta). NaN if baseline was null. */
  scoreDelta: number;
  /** Curated history blocks the agent should consult next turn. */
  curated: CuratedHistory;
  /** Diversity hint — when set, suggests the agent should propose something different. */
  diversityHint: {
    /** Family the recent window is over-saturated with. */
    dominantFamily: string;
    /** Fraction of recent slots occupied by it. */
    saturation: number;
    /** Suggested families to explore instead. */
    suggestedAlternatives: string[];
  } | null;
  reasoning: string;
}

const DEFAULT_KEEP_THRESHOLD = 0.0;
const DEFAULT_DIVERSITY_WINDOW = 6;
const DEFAULT_CLUSTER_FRACTION = 0.66;
const TOP_KEPT_K = 3;
const RECENT_K = 5;
const CLOSE_MISS_RATIO = 0.9;

function bestKeptExperiment(experiments: ReadonlyArray<Experiment>): Experiment | null {
  let best: Experiment | null = null;
  for (const e of experiments) {
    if (e.status !== "kept") continue;
    if (!Number.isFinite(e.score)) continue;
    if (!best || e.score > best.score) best = e;
  }
  return best;
}

function curateHistory(experiments: ReadonlyArray<Experiment>): CuratedHistory {
  const kept = experiments.filter((e) => e.status === "kept" && Number.isFinite(e.score));
  const topKept = [...kept].sort((a, b) => b.score - a.score).slice(0, TOP_KEPT_K);

  const recent = experiments
    .filter((e) => e.status === "kept" || e.status === "reverted")
    .slice(-RECENT_K);

  const bestByFamily: Record<string, Experiment> = {};
  for (const e of kept) {
    const current = bestByFamily[e.family];
    if (!current || e.score > current.score) bestByFamily[e.family] = e;
  }

  const topScore = topKept[0]?.score ?? 0;
  const closeMissThreshold = topScore * CLOSE_MISS_RATIO;
  const closeMisses = experiments
    .filter(
      (e) =>
        e.status === "reverted" &&
        Number.isFinite(e.score) &&
        e.score >= closeMissThreshold &&
        e.score > 0,
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_KEPT_K);

  return { topKept, recent, bestByFamily, closeMisses };
}

function detectDiversityCluster(
  experiments: ReadonlyArray<Experiment>,
  window: number,
  fraction: number,
): ResearchLoopResult["diversityHint"] {
  const tail = experiments
    .filter((e) => e.status === "kept" || e.status === "reverted")
    .slice(-window);
  if (tail.length < window) return null;

  const counts: Record<string, number> = {};
  for (const e of tail) counts[e.family] = (counts[e.family] ?? 0) + 1;

  let dominantFamily = "";
  let dominantCount = 0;
  for (const [family, count] of Object.entries(counts)) {
    if (count > dominantCount) {
      dominantFamily = family;
      dominantCount = count;
    }
  }
  const saturation = dominantCount / tail.length;
  if (saturation < fraction) return null;

  const familiesSeen = new Set(experiments.map((e) => e.family));
  const suggested = Array.from(familiesSeen).filter((f) => f !== dominantFamily).slice(0, 3);

  return {
    dominantFamily,
    saturation,
    suggestedAlternatives: suggested,
  };
}

export function evaluateResearchLoop(input: ResearchLoopInput): ResearchLoopResult {
  const experiments = input.experiments;
  const candidate = input.candidate;
  const keepThreshold = input.keepThreshold ?? DEFAULT_KEEP_THRESHOLD;
  const window = input.diversityWindow ?? DEFAULT_DIVERSITY_WINDOW;
  const fraction = input.diversityClusterFraction ?? DEFAULT_CLUSTER_FRACTION;

  // Decide on the candidate.
  const priorBaseline = bestKeptExperiment(experiments);
  let decision: KeepRevertDecision;
  let scoreDelta: number;

  if (candidate.status === "errored" || !Number.isFinite(candidate.score)) {
    decision = "investigate";
    scoreDelta = Number.NaN;
  } else if (!priorBaseline) {
    decision = candidate.score > 0 ? "keep" : "revert";
    scoreDelta = candidate.score;
  } else {
    scoreDelta = candidate.score - priorBaseline.score;
    decision = scoreDelta > keepThreshold ? "keep" : "revert";
  }

  // After-decision experiments (synthetic — assumes the caller will mark status accordingly).
  const finalCandidate: Experiment = {
    ...candidate,
    status:
      decision === "keep" ? "kept" : decision === "revert" ? "reverted" : candidate.status,
  };
  const finalExperiments = [...experiments, finalCandidate];

  const baseline = bestKeptExperiment(finalExperiments);
  const curated = curateHistory(finalExperiments);
  const diversityHint = detectDiversityCluster(finalExperiments, window, fraction);

  const reasoning =
    decision === "keep"
      ? `Keep ${candidate.id}: score ${candidate.score.toFixed(4)} vs baseline ${priorBaseline?.score.toFixed(4) ?? "none"} (Δ${Number.isFinite(scoreDelta) ? scoreDelta.toFixed(4) : "n/a"})`
      : decision === "revert"
        ? `Revert ${candidate.id}: score ${candidate.score.toFixed(4)} ≤ baseline ${priorBaseline?.score.toFixed(4) ?? "0"} (Δ${Number.isFinite(scoreDelta) ? scoreDelta.toFixed(4) : "n/a"})`
        : `Investigate ${candidate.id}: errored or NaN score`;

  return { decision, baseline, scoreDelta, curated, diversityHint, reasoning };
}

export function researchLoopToPayload(result: ResearchLoopResult): Record<string, unknown> {
  return {
    kind: "research_loop.evaluated",
    decision: result.decision,
    scoreDelta: Number.isFinite(result.scoreDelta) ? Number(result.scoreDelta.toFixed(4)) : null,
    baselineId: result.baseline?.id ?? null,
    baselineScore: result.baseline ? Number(result.baseline.score.toFixed(4)) : null,
    diversitySaturation: result.diversityHint
      ? Number(result.diversityHint.saturation.toFixed(2))
      : null,
    dominantFamily: result.diversityHint?.dominantFamily ?? null,
    topKeptCount: result.curated.topKept.length,
  };
}
