/**
 * Prompt-optimization loop.
 *
 * Optimizes a system/instruction prompt against a LABELED eval set: rewrite the
 * prompt, score the candidate on the train split, keep the best-scoring prompt
 * (not the last one tried), and stop on a plateau or an exhausted budget. Thin
 * orchestration over primitives that already exist in the codebase — the new
 * parts are the driver and a prompt-mutation operator:
 *   - train/holdout selection is gated by `holdoutAccessGate` (the search never
 *     touches the locked holdout; a single honest read happens after the loop);
 *   - the plateau brake is `detectStagnation` from the genome module, fed the
 *     running-best-score trajectory.
 *
 * Distinct from ACE `/reflect`: ACE distills lessons from an action log into the
 * system prompt across sessions. This optimizes ONE prompt against a fixed
 * labeled dataset with a held-out generalization gate — a search, not a memory.
 *
 * Pure + injected: the caller supplies the scorer, the mutation operator, and
 * the access policy. Deterministic in its inputs; the trial log is returned.
 */

import {
  canEvaluate,
  emptyEvalState,
  recordEvaluation,
  type EvalState,
  type HoldoutAccessConfig,
} from "../../../trading/ops/holdoutAccessGate.ts";
import { detectStagnation } from "../../../../core/genome/stagnationDetector.ts";

/** A rewritten prompt plus a short label describing how it was produced. */
export interface PromptCandidate {
  prompt: string;
  /** Mutation label for the trial log ("append:risk-first", "shorten", …). */
  origin: string;
}

/**
 * Produces the next candidate from the current best prompt. This is the
 * "rewrite-prompt" operator — the one genuinely new piece. Kept injected so an
 * LLM-backed rewriter, a template mutator, or a deterministic test operator all
 * plug in the same way.
 */
export type PromptMutator = (best: string, iteration: number) => PromptCandidate;

/** Scores a prompt on a split against the labeled eval set. Higher is better. */
export type PromptScorer = (prompt: string, split: string) => number;

export interface PromptOptimizerOptions {
  /** The prompt to improve. */
  initialPrompt: string;
  /** The rewrite-prompt operator. */
  mutate: PromptMutator;
  /** Labeled-set scorer. */
  scorer: PromptScorer;
  /**
   * Access policy. MUST declare the train split `trainable` (ideally budgeted)
   * and the holdout split `locked`. Deny-first: an unknown split blocks.
   */
  access: HoldoutAccessConfig;
  /** Trainable split the search selects on. Default "train". */
  trainSplit?: string;
  /** Locked holdout for the final honest read. Default "holdout". */
  holdoutSplit?: string;
  /** Hard cap on rewrite iterations. Default 20. */
  maxIterations?: number;
  /** Plateau brake config forwarded to `detectStagnation`. */
  stagnation?: { epsilon?: number; window?: number };
  /** Take the one sanctioned holdout read after the search. Default true. */
  finalHoldoutRead?: boolean;
}

/** One scored rewrite in the trial log. */
export interface PromptTrial {
  iteration: number;
  origin: string;
  prompt: string;
  score: number;
  /** Keep-best-not-last: true only when the candidate beat the running best. */
  accepted: boolean;
  bestScoreSoFar: number;
}

export type PromptOptimizerStopReason = "plateau" | "budget_exhausted" | "max_iterations";

export interface PromptOptimizerResult {
  bestPrompt: string;
  bestTrainScore: number;
  /** The single honest read on the locked holdout; null when not read. */
  holdoutScore: number | null;
  trials: PromptTrial[];
  /** Running-best score after each evaluation — the series fed to the plateau brake. */
  bestScoreHistory: number[];
  iterations: number;
  evalsUsed: number;
  stopReason: PromptOptimizerStopReason;
}

/**
 * A simple deterministic mutation operator: cycle through `fragments`, appending
 * one per iteration to the current best prompt. Useful as a default and for
 * tests; swap in an LLM rewriter for real optimization.
 */
export function appendFragmentMutator(fragments: readonly string[]): PromptMutator {
  return (best, iteration) => {
    const frag = fragments.length > 0 ? fragments[(iteration - 1) % fragments.length]! : "";
    const prompt = frag ? `${best}\n${frag}` : best;
    return { prompt, origin: `append:${frag.slice(0, 24)}` };
  };
}

/**
 * Run the rewrite/score/keep-best loop. Stops on a detected plateau
 * (`plateau`), an exhausted train budget (`budget_exhausted`), or the iteration
 * cap (`max_iterations`). Reports the one honest holdout read afterward.
 */
export function optimizePrompt(options: PromptOptimizerOptions): PromptOptimizerResult {
  const trainSplit = options.trainSplit ?? "train";
  const holdoutSplit = options.holdoutSplit ?? "holdout";
  const maxIterations = options.maxIterations ?? 20;
  const finalHoldoutRead = options.finalHoldoutRead ?? true;

  const trials: PromptTrial[] = [];
  const bestScoreHistory: number[] = [];
  let state: EvalState = emptyEvalState();

  const holdoutRead = (prompt: string): number | null =>
    finalHoldoutRead ? options.scorer(prompt, holdoutSplit) : null;

  // Baseline: score the initial prompt on train (gated).
  if (!canEvaluate(options.access, trainSplit, state).allowed) {
    return {
      bestPrompt: options.initialPrompt,
      bestTrainScore: 0,
      holdoutScore: holdoutRead(options.initialPrompt),
      trials,
      bestScoreHistory,
      iterations: 0,
      evalsUsed: state.usage[trainSplit] ?? 0,
      stopReason: "budget_exhausted",
    };
  }
  let bestPrompt = options.initialPrompt;
  let bestScore = options.scorer(bestPrompt, trainSplit);
  state = recordEvaluation(state, trainSplit);
  trials.push({
    iteration: 0,
    origin: "initial",
    prompt: bestPrompt,
    score: bestScore,
    accepted: true,
    bestScoreSoFar: bestScore,
  });
  bestScoreHistory.push(bestScore);

  let stopReason: PromptOptimizerStopReason = "max_iterations";
  let iterations = 0;
  for (let iter = 1; iter <= maxIterations; iter++) {
    if (!canEvaluate(options.access, trainSplit, state).allowed) {
      stopReason = "budget_exhausted";
      break;
    }
    iterations = iter;
    const candidate = options.mutate(bestPrompt, iter);
    const score = options.scorer(candidate.prompt, trainSplit);
    state = recordEvaluation(state, trainSplit);

    const accepted = score > bestScore;
    if (accepted) {
      bestPrompt = candidate.prompt;
      bestScore = score;
    }
    trials.push({
      iteration: iter,
      origin: candidate.origin,
      prompt: candidate.prompt,
      score,
      accepted,
      bestScoreSoFar: bestScore,
    });
    bestScoreHistory.push(bestScore);

    const verdict = detectStagnation({
      fitnessHistory: bestScoreHistory,
      epsilon: options.stagnation?.epsilon,
      window: options.stagnation?.window,
    });
    if (verdict.recommendation === "structural_pivot") {
      stopReason = "plateau";
      break;
    }
  }

  return {
    bestPrompt,
    bestTrainScore: bestScore,
    holdoutScore: holdoutRead(bestPrompt),
    trials,
    bestScoreHistory,
    iterations,
    evalsUsed: state.usage[trainSplit] ?? 0,
    stopReason,
  };
}
