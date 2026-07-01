/**
 * Coordinate-descent RAG-config tuner.
 *
 * The hybrid retrieval stack here (BM25-lite + TF-IDF cosine + temporal decay +
 * MMR rerank) has knobs — chunk size, overlap, embedding, k, reranker, and the
 * keyword/semantic blend (hybridAlpha). This tuner searches that knob space
 * GREEDILY, one knob at a time (coordinate descent): hold every other knob
 * fixed, sweep one knob's candidate values, keep the best, move to the next.
 * It scores recall@k on an INJECTED labeled eval set.
 *
 * Overfitting is stopped at the gate, not priced in afterward: the search only
 * ever selects on the `train` split, gated by `holdoutAccessGate`. The holdout
 * split is `locked`, so no search step can ever touch it (a structural barrier,
 * verified by the gate). A single sanctioned honest read on the holdout happens
 * once, AFTER the search, to report generalization. The train split also carries
 * an eval budget, so the sweep stops (budget brake) rather than grinding an
 * unbounded multiple-testing burden.
 *
 * Pure + injected: no I/O, no globals. The caller supplies the knob space, the
 * scorer (recall@k over their labeled set), and the access policy. Deterministic
 * in its inputs; the trial log is returned for inspection rather than written.
 */

import {
  canEvaluate,
  emptyEvalState,
  recordEvaluation,
  type EvalState,
  type HoldoutAccessConfig,
} from "../../trading/ops/holdoutAccessGate.ts";

/** One point in the RAG knob space. */
export interface RagConfig {
  /** Document chunk size (tokens / chars — caller's unit). */
  chunkSize: number;
  /** Overlap between adjacent chunks. */
  overlap: number;
  /** Embedding model / method identifier. */
  embedding: string;
  /** Number of results retrieved (the k in recall@k). */
  k: number;
  /** Reranker identifier ("none", "mmr", a cross-encoder name, …). */
  reranker: string;
  /** Keyword-vs-semantic blend in [0,1]; higher leans keyword. */
  hybridAlpha: number;
}

/** The tunable knobs, by name. */
export type RagKnob = keyof RagConfig;

/** Candidate values for each knob. Each list must be non-empty. */
export interface RagKnobSpace {
  chunkSize: number[];
  overlap: number[];
  embedding: string[];
  k: number[];
  reranker: string[];
  hybridAlpha: number[];
}

/**
 * Scores a config on a split. Higher is better; recall@k lives in [0,1] but the
 * tuner only relies on the ordering, so any bounded fitness works.
 */
export type RagScorer = (config: RagConfig, split: string) => number;

/** A labeled retrieval query: the relevant (gold) doc ids for a question. */
export interface LabeledQuery {
  id: string;
  relevantDocIds: readonly string[];
}

/** Runs retrieval for a config against one labeled query on a split. */
export type RetrievalFn = (
  config: RagConfig,
  query: LabeledQuery,
  split: string,
) => readonly string[];

export const DEFAULT_KNOB_ORDER: readonly RagKnob[] = [
  "chunkSize",
  "overlap",
  "embedding",
  "k",
  "reranker",
  "hybridAlpha",
];

export interface RagTunerOptions {
  /** Candidate values per knob. */
  space: RagKnobSpace;
  /** Recall@k scorer over the caller's labeled eval set. */
  scorer: RagScorer;
  /**
   * Access policy. MUST declare the train split as `trainable` (ideally with a
   * budget) and the holdout split as `locked` so the search can never select on
   * it. Deny-first: an unknown split blocks.
   */
  access: HoldoutAccessConfig;
  /** Label of the trainable split the search selects on. Default "train". */
  trainSplit?: string;
  /** Label of the locked holdout for the final honest read. Default "holdout". */
  holdoutSplit?: string;
  /** Seed config; each knob defaults to the first candidate in its list. */
  initial?: Partial<RagConfig>;
  /** Knob visiting order. Default `DEFAULT_KNOB_ORDER`. */
  knobOrder?: readonly RagKnob[];
  /** Max full coordinate-descent passes before stopping. Default 3. */
  maxPasses?: number;
  /** Take the one sanctioned holdout read after the search. Default true. */
  finalHoldoutRead?: boolean;
}

/** One scored candidate in the trial log. */
export interface RagTrial {
  step: number;
  /** Which knob was being swept, or "seed" for the baseline evaluation. */
  knob: RagKnob | "seed";
  config: RagConfig;
  score: number;
  /** True when this candidate beat the running best and was adopted. */
  accepted: boolean;
}

export type RagTunerStopReason = "converged" | "budget_exhausted" | "max_passes";

export interface RagTunerResult {
  best: RagConfig;
  bestTrainScore: number;
  /** The single honest read on the locked holdout; null when not read. */
  holdoutScore: number | null;
  trials: RagTrial[];
  evalsUsed: number;
  passes: number;
  stopReason: RagTunerStopReason;
}

function buildInitial(space: RagKnobSpace, initial?: Partial<RagConfig>): RagConfig {
  const pick = <K extends RagKnob>(knob: K): RagConfig[K] => {
    const seeded = initial?.[knob];
    if (seeded !== undefined) return seeded as RagConfig[K];
    const candidates = space[knob];
    if (candidates.length === 0) {
      throw new Error(`ragConfigTuner: knob "${knob}" has no candidate values`);
    }
    return candidates[0] as RagConfig[K];
  };
  return {
    chunkSize: pick("chunkSize"),
    overlap: pick("overlap"),
    embedding: pick("embedding"),
    k: pick("k"),
    reranker: pick("reranker"),
    hybridAlpha: pick("hybridAlpha"),
  };
}

/**
 * Recall@k for one query: fraction of the gold-relevant docs that appear in the
 * top-k retrieved. A query with no relevant docs contributes 1.0 (nothing to
 * miss); filter such queries upstream if that would skew your metric.
 */
export function recallAtK(
  retrieved: readonly string[],
  relevant: readonly string[],
  k: number,
): number {
  if (relevant.length === 0) return 1;
  const top = new Set(retrieved.slice(0, Math.max(0, k)));
  let hit = 0;
  for (const r of relevant) if (top.has(r)) hit++;
  return hit / relevant.length;
}

/**
 * Build a `RagScorer` that averages recall@k across a labeled query set, using
 * the config's own `k` as the cutoff. This is the injected labeled-eval-set
 * scorer the tuner selects on.
 */
export function makeRecallScorer(
  queries: readonly LabeledQuery[],
  retrieval: RetrievalFn,
): RagScorer {
  return (config, split) => {
    if (queries.length === 0) return 0;
    let sum = 0;
    for (const q of queries) {
      const retrieved = retrieval(config, q, split);
      sum += recallAtK(retrieved, q.relevantDocIds, config.k);
    }
    return sum / queries.length;
  };
}

/**
 * Run coordinate descent over the knob space, selecting on the train split only.
 * Stops when a full pass yields no improvement (`converged`), the train budget
 * is exhausted (`budget_exhausted`), or `maxPasses` passes complete
 * (`max_passes`). Reports the one honest holdout read afterward.
 */
export function tuneRagConfig(options: RagTunerOptions): RagTunerResult {
  const trainSplit = options.trainSplit ?? "train";
  const holdoutSplit = options.holdoutSplit ?? "holdout";
  const knobOrder = options.knobOrder ?? DEFAULT_KNOB_ORDER;
  const maxPasses = options.maxPasses ?? 3;
  const finalHoldoutRead = options.finalHoldoutRead ?? true;

  const trials: RagTrial[] = [];
  let state: EvalState = emptyEvalState();
  let step = 0;

  // Gated train evaluation. Returns null when the train budget is exhausted.
  const scoreOnTrain = (config: RagConfig, knob: RagKnob | "seed"): number | null => {
    if (!canEvaluate(options.access, trainSplit, state).allowed) return null;
    const score = options.scorer(config, trainSplit);
    state = recordEvaluation(state, trainSplit);
    trials.push({ step: step++, knob, config, score, accepted: false });
    return score;
  };

  let best = buildInitial(options.space, options.initial);
  const baseline = scoreOnTrain(best, "seed");
  if (baseline === null) {
    return {
      best,
      bestTrainScore: 0,
      holdoutScore: finalHoldoutRead ? options.scorer(best, holdoutSplit) : null,
      trials,
      evalsUsed: countUsage(state, trainSplit),
      passes: 0,
      stopReason: "budget_exhausted",
    };
  }
  trials[trials.length - 1]!.accepted = true;
  let bestScore = baseline;

  let stopReason: RagTunerStopReason = "max_passes";
  let passes = 0;
  outer: for (let pass = 0; pass < maxPasses; pass++) {
    passes = pass + 1;
    let improvedThisPass = false;
    for (const knob of knobOrder) {
      for (const value of options.space[knob]) {
        if (value === best[knob]) continue;
        const candidate: RagConfig = { ...best, [knob]: value };
        const score = scoreOnTrain(candidate, knob);
        if (score === null) {
          stopReason = "budget_exhausted";
          break outer;
        }
        if (score > bestScore) {
          best = candidate;
          bestScore = score;
          improvedThisPass = true;
          trials[trials.length - 1]!.accepted = true;
        }
      }
    }
    if (!improvedThisPass) {
      stopReason = "converged";
      break;
    }
  }

  return {
    best,
    bestTrainScore: bestScore,
    holdoutScore: finalHoldoutRead ? options.scorer(best, holdoutSplit) : null,
    trials,
    evalsUsed: countUsage(state, trainSplit),
    passes,
    stopReason,
  };
}

function countUsage(state: EvalState, split: string): number {
  return state.usage[split] ?? 0;
}
