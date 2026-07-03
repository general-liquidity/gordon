/**
 * Eval Harness types — agent-quality eval primitive.
 *
 * Distinct from the existing trade-outcome evals in this module
 * (`tradeEvaluator.ts` etc.) which score realized PnL after-the-fact.
 * This harness scores *agent behavior* on fixed scenarios, comparing
 * variants (different models, prompts, wiring flags) using LLM-as-
 * judge with relative ranking — the RULER pattern.
 *
 * Why relative ranking: LLMs are inconsistent at absolute scoring
 * ("rate this 0-100") but consistent at "rank these N in order".
 * GRPO-style normalization isn't relevant here (we don't train), but
 * the same property gives stable judgments across runs.
 */

import type { Message } from "../../../ai/llm/types.ts";

/**
 * Eval category — borrowed from CREAO's "Job 0 Categorical Router". The
 * judge sees a category-conditioned rubric so a "good planning answer"
 * and a "good analysis answer" are evaluated against different red flags.
 *
 * Compressed from CREAO's 12 to Gordon's 6: trading agents don't span
 * creative-writing / app-building / etc.
 */
export type EvalCategory =
  | "scan"
  | "analysis"
  | "planning"
  | "execution"
  | "education"
  | "recovery"
  | "memory";

/**
 * One user turn in a multi-turn / progressive-disclosure scenario. Models a
 * real trader's clarification dialogue: the initial request is underspecified
 * and constraints get revealed over turns. `expectedElicitation` names the
 * constraint the agent SHOULD have elicited (asked about) at/after this turn
 * before taking a material action — a judge hint + documentation, NOT a hard
 * assertion (deterministic action assertions live in `expectedActions`).
 */
export interface ScenarioTurn {
  /** The user message for this turn. */
  user: string;
  /** Optional: the missing constraint the agent should elicit before acting
   *  (e.g. "venue", "risk budget", "keep BTC"). */
  expectedElicitation?: string;
}

/**
 * A scenario is a fixed test case: system prompt + user input + tags.
 * Hand-curated and version-controlled — these define what "good
 * behavior" means for Gordon. Initial set is small; grow as evidence
 * accumulates.
 */
export interface EvalScenario {
  /** Stable identifier — also doubles as test name in reports. */
  id: string;
  /** Tags for filtering / grouping ("plan-card", "regime", "risk-gate", "compaction"). */
  tags: ReadonlyArray<string>;
  /** The system prompt the agent runs under for this scenario.
   *  Becomes the judge's implicit rubric. */
  systemPrompt: string;
  /** The user message that triggers agent behavior. */
  userInput: string;
  /** Human-readable description of what good output looks like.
   *  Documentation only — not seen by the judge. */
  notes?: string;
  /** Optional explicit rubric the judge layers ON TOP OF the system prompt. */
  extraRubric?: string;
  /**
   * Optional known-correct expected answer. When present, the judge prompt gains
   * a "# Expected (known-correct)" block so scoring anchors to FACT for numeric /
   * analysis scenarios — "assess quality" becomes "check against the known
   * answer". Absent => existing behavior (system prompt + rubric are the only
   * reference); scoring is unchanged. Additive.
   */
  expectedAnswer?: string;
  /** Optional eval category — drives category-conditioned rubric. */
  category?: EvalCategory;
  /**
   * Provenance — which authoritative spec this scenario was DERIVED from,
   * e.g. "constitution:MAX_POSITION_SIZE_PCT", "riskClassifier:Tail Risk",
   * "denylist:wallet_transfer", "categoryRubric:planning". Empty for
   * hand-authored scenarios. Lets a failure point straight back at the
   * spec line that motivated the test (ASSERT-style traceability).
   */
  derivedFrom?: string;
  /**
   * Required-action assertions (SWE-bench-Pro F2P analog). Each string is a
   * tool-name SUBSTRING that MUST appear among the trajectory's successfully
   * executed tool calls for the scenario to pass its deterministic assertion
   * check. e.g. `["downsize", "close_trade"]` asserts the downsize actually
   * happened. Absent => no required-action gate (existing behavior).
   *
   * Checked by `checkScenarioAssertions` and folded into the process-check
   * `passed` conjunction as block-severity violations. Distinct from the 5
   * GLOBAL process rules, which stay unchanged.
   */
  expectedActions?: ReadonlyArray<string>;
  /**
   * Forbidden-action assertions (P2P no-regression analog). Each string is a
   * tool-name SUBSTRING that MUST NOT appear anywhere in the trajectory's tool
   * calls (executed OR attempted). e.g. `["flip_short", "cancel_order"]`
   * asserts the agent did not touch an unrelated holding / cancel a standing
   * order while downsizing. Absent => no forbidden-action gate.
   */
  forbiddenActions?: ReadonlyArray<string>;
  /**
   * Multi-turn / progressive-disclosure representation. When present, the
   * scenario is a clarification dialogue: `userInput` remains the primary
   * (first) request for single-turn callers, and `turns` carries the full
   * ordered sequence so the trace adapter can preserve every user turn
   * instead of collapsing to one, and the judge can score whether the agent
   * ELICITED the missing constraint before acting. Absent => single-turn
   * (existing `userInput`-only behavior).
   */
  turns?: ReadonlyArray<ScenarioTurn>;
}

/**
 * Fixed failure-mode taxonomy (SWE-bench-Pro error_analysis analog),
 * trading-flavored. Judge-assigned on a FAILED / low-scoring trajectory to
 * name the dominant reasoning failure — a categorical dimension the scalar
 * score and the `genericNonActionable` anti-metric don't capture.
 *
 *   misread_regime         — traded against the prevailing regime / trend.
 *   over_sized             — position size breached risk budget / vol-adjusted sizing.
 *   hallucinated_fill      — claimed a fill / price / holding that never existed.
 *   ignored_news           — acted against material news / event the context surfaced.
 *   generic_non_actionable — platitudes with no concrete trigger/stop/target/size.
 *   other                  — a real failure that fits none of the above.
 */
export type FailureMode =
  | "misread_regime"
  | "over_sized"
  | "hallucinated_fill"
  | "ignored_news"
  | "generic_non_actionable"
  | "other";

/** All taxonomy members, for validation / rollup seeding. */
export const FAILURE_MODES: ReadonlyArray<FailureMode> = [
  "misread_regime",
  "over_sized",
  "hallucinated_fill",
  "ignored_news",
  "generic_non_actionable",
  "other",
];

/**
 * Runtime cost of producing a trajectory (or the aggregate cost of a whole
 * variant run). All fields optional so pure-text / fixture trajectories that
 * were never metered carry nothing — a missing field is treated as "unknown"
 * and disables the cost gate rather than counting as zero. Populated from the
 * runtime `costTracker.ts` snapshot when trajectories are captured live.
 */
export interface TrajectoryCost {
  /** Dollar cost of the API calls that produced this trajectory. */
  costUsd?: number;
  /** Total tokens (input + output + cache) consumed. */
  tokens?: number;
  /** Wall-clock latency in milliseconds. */
  latencyMs?: number;
}

/**
 * A trajectory is one variant's response to a scenario. The variant
 * label distinguishes which model / prompt-version / flag combo
 * produced it, so downstream reports can attribute regressions.
 */
export interface EvalTrajectory {
  /** Unique within a scoring call — usually the variant label. */
  id: string;
  /** The full message sequence produced by the variant. */
  messages: ReadonlyArray<Message>;
  /** Free-form metadata (model name, env flags, prompt hash, etc.). */
  metadata?: Record<string, string | number | boolean>;
  /**
   * Retrieved tool-output summaries produced along this trajectory, grounded
   * on the audit trace's `NormalizedToolCall.outputSummary`. Surfaced to the
   * judge so it can score Information Utilization — whether the final answer
   * actually reflects/uses the data the agent retrieved, rather than ignoring
   * or misinterpreting it (FinTrace's universal-bottleneck finding). Absent
   * for pure-text trajectories that called no tools; when absent the judge
   * simply skips the dimension.
   */
  toolOutputs?: ReadonlyArray<{ name: string; outputSummary?: string }>;
  /**
   * Runtime cost of producing this trajectory (tokens / dollars / latency),
   * grounded on the `costTracker.ts` snapshot captured while the trajectory
   * ran. Surfaced so `detectRegressions` can gate an equal-or-worse candidate
   * that costs materially more — the token/cost/latency axis the score-only
   * gate is blind to. Absent for fixtures that were never metered.
   */
  cost?: TrajectoryCost;
}

/** A single trajectory's score after the judge has ranked the group. */
export interface ScoredTrajectory {
  id: string;
  /** 0..1 score, relative to siblings. Higher is better. */
  score: number;
  /** One-line judge rationale. */
  explanation: string;
  /** Rank within the group (1 = best). */
  rank: number;
  /**
   * Independently-gated anti-metric: true when the answer is generic
   * non-actionable trading advice (recommends action with no concrete
   * trigger/stop/target/size, or falls back to platitudes). OPTIONAL —
   * judges that don't emit it leave it undefined, treated as false
   * downstream. Tracked SEPARATELY from `score` so a candidate can't
   * mask a rise in this rate by lifting the aggregate.
   */
  genericNonActionable?: boolean;
  /**
   * Judge-assigned failure-mode label from the fixed taxonomy. Only
   * meaningful on a FAILED / low-scoring trajectory; judges omit it for
   * good trajectories. OPTIONAL — undefined means the judge did not (or
   * had no reason to) classify a failure. Rolled up in the review queue
   * for a suite-level error-mode view.
   */
  failureMode?: FailureMode;
  /**
   * Information Utilization score in [0, 1] — how well the final answer
   * reflects/uses the retrieved tool-output data (1 = fully grounded in and
   * consistent with the data, 0 = ignores or misinterprets it). OPTIONAL:
   * only meaningful when the trajectory carried `toolOutputs`; judges that
   * don't emit it (or trajectories with no retrieved data) leave it
   * undefined. Tracked alongside `score` as a distinct quality dimension —
   * FinTrace's headline finding is that data-utilization, not retrieval or
   * planning, is the universal bottleneck.
   */
  informationUtilization?: number;
}

export interface JudgeResult {
  scenarioId: string;
  judgeModel: string;
  /** Sorted by rank ascending (best first). */
  scored: ReadonlyArray<ScoredTrajectory>;
  /** Wall-clock the judge call took (ms). */
  durationMs: number;
  /** Set when the judge failed and we fell back to passthrough scoring. */
  fallback?: { reason: string };
}

export interface JudgeRequest {
  scenario: EvalScenario;
  trajectories: ReadonlyArray<EvalTrajectory>;
  /** Default Sonnet 4.6 — caller can override with Haiku for cheaper runs. */
  judgeModel?: string;
  /** When true, prefix each trajectory's content with its id in the prompt. */
  includeIds?: boolean;
}

/**
 * Per-judge entry in a panel result. `failed` is set when the judge
 * call threw or returned malformed JSON; that judge is dropped from
 * the consensus average.
 */
export interface PanelJudgeEntry {
  judgeModel: string;
  scored: ReadonlyArray<ScoredTrajectory>;
  durationMs: number;
  failed?: { reason: string };
}

/**
 * Tri-judge panel result — borrowed from CREAO's anti-bias setup. Runs
 * N judges from different model families concurrently, averages
 * surviving scores. Consensus is the mean across surviving judges.
 */
export interface PanelJudgeResult {
  scenarioId: string;
  /** One entry per panel member, including failed ones (for audit). */
  panel: ReadonlyArray<PanelJudgeEntry>;
  /** Consensus ranking — average score across surviving judges. */
  consensus: ReadonlyArray<ScoredTrajectory>;
  /** Number of judges that returned a usable score. */
  quorum: number;
  /** Wall-clock from kickoff to last judge return (ms). */
  durationMs: number;
}

/**
 * Run result — output of scoring one variant against the full scenario
 * suite. Aggregate score is the average across all scenarios.
 */
export interface VariantRunResult {
  variantLabel: string;
  judgeModel: string;
  /** When this run was executed. */
  ranAt: string;
  /** Per-scenario scores for this variant. */
  perScenario: ReadonlyArray<{
    scenarioId: string;
    score: number;
    rank: number;
    explanation: string;
    /** Anti-metric carried from the judge; missing = not flagged (false). */
    genericNonActionable?: boolean;
    /** Failure-mode label carried from the judge; missing = unclassified. */
    failureMode?: FailureMode;
  }>;
  /** Mean score across scenarios. */
  aggregate: number;
  /** Number of scenarios this variant won outright. */
  winCount: number;
  /** Total scenarios run. */
  scenarioCount: number;
  /**
   * Fraction of scored scenarios flagged `genericNonActionable`
   * (0..1). DERIVED from `perScenario`; missing flags count as false.
   * Gated INDEPENDENTLY of `aggregate` by `detectRegressions` so a
   * doubling of generic-advice rate is caught even when the aggregate
   * score improves. Optional for backward compatibility — absent on
   * VariantRunResults built before this field existed (treated as 0).
   */
  genericAdviceRate?: number;
  /**
   * Aggregate runtime cost across all scored scenarios for this variant —
   * tokens / dollars summed, latency summed (total wall-clock). DERIVED from
   * the per-scenario trajectories' `cost` fields; absent when no trajectory
   * was metered. Consumed by `detectRegressions`'s cost leg so a candidate
   * that matches the baseline's quality while burning materially more tokens
   * or dollars is caught. A field that is missing on either run disables that
   * metric's comparison rather than counting as zero.
   */
  cost?: TrajectoryCost;
}

/**
 * Regression report — compares two run results, flags scenarios where
 * the new variant scored worse than the baseline by more than the
 * tolerance threshold.
 */
export interface RegressionReport {
  baselineLabel: string;
  candidateLabel: string;
  toleranceDelta: number;
  /** Total aggregate-score change. */
  aggregateDelta: number;
  regressions: ReadonlyArray<{
    scenarioId: string;
    baselineScore: number;
    candidateScore: number;
    delta: number;
  }>;
  improvements: ReadonlyArray<{
    scenarioId: string;
    baselineScore: number;
    candidateScore: number;
    delta: number;
  }>;
  /**
   * Independent anti-metric gate. Set when the candidate's
   * `genericAdviceRate` rose past `genericAdviceRateTolerance` relative
   * to the baseline — a BLOCKING regression even if `aggregateDelta` is
   * positive. Undefined when within tolerance (or neither run carried
   * the field). The lesson from the creative-strategy eval write-up:
   * aggregate score can improve while a specific bad-behavior rate
   * doubles, and only a separately-gated metric catches it.
   */
  genericAdviceRegression?: {
    baselineRate: number;
    candidateRate: number;
    delta: number;
    tolerance: number;
  };
  /**
   * Independent cost gate. Set when the candidate scored equal-or-worse than
   * the baseline yet consumed materially more (tokens or dollars) than the
   * `costToleranceRatio` allows — the token/cost/latency axis the scalar score
   * is blind to. `blocking` reflects the opt-in `blockOnCostRegression` option:
   * true makes it a blocking regression, false leaves it advisory (warn-only).
   * Undefined when within tolerance, when the candidate improved (extra spend
   * is justified by a better score), or when neither run carried metered cost.
   */
  costRegression?: {
    /** Which axis tripped — dollars preferred when both runs are metered. */
    metric: "costUsd" | "tokens";
    baselineValue: number;
    candidateValue: number;
    /** candidateValue / baselineValue - 1 (fractional overspend). */
    ratio: number;
    tolerance: number;
    /** candidate.aggregate - baseline.aggregate (<= 0 to trip the gate). */
    scoreDelta: number;
    blocking: boolean;
  };
  /**
   * True when at least one per-scenario regression exceeded the
   * tolerance threshold, OR the independent generic-advice gate tripped,
   * OR a blocking cost regression fired.
   */
  hasBlockingRegression: boolean;
}
