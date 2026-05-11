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
  }>;
  /** Mean score across scenarios. */
  aggregate: number;
  /** Number of scenarios this variant won outright. */
  winCount: number;
  /** Total scenarios run. */
  scenarioCount: number;
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
  /** True when at least one regression exceeded the tolerance threshold. */
  hasBlockingRegression: boolean;
}
