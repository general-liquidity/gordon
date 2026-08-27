/**
 * Triangular Rationale Consistency Gate.
 *
 * Gordon requires a rationale on safety-critical actions (`execute_plan`, the
 * `cancel_*` family). Fluency and support are different properties, and only
 * the first one is currently observable: a rationale that reads well passes
 * the same as one that is actually entailed by the evidence.
 *
 * Trade-R1 (2026) supplies the shape. Over the triple (retrieved evidence E,
 * reasoning chain c, decision d), score three pairwise relations:
 *   Factuality  S(E to c): is the reasoning supported by the evidence.
 *   Deduction   S(c to d): does the decision follow from the reasoning.
 *   Consistency S(E to d): does the decision align with the evidence directly.
 * The mean of the three is the headline score, but each leg is reported
 * separately: an ungrounded rationale and a non-sequitur are different
 * failures with different remedies, and the mean cannot tell them apart.
 *
 * ASYMMETRY IS THE LOAD-BEARING PART. When a consistency score is combined
 * with a realized outcome, a symmetric product (outcome * score) hands the
 * model a way out: on a losing trade a smaller self-reported score shrinks
 * the penalty, so the model learns to mark its own homework down exactly when
 * the rationale mattered most. Trade-R1 measured the drift: similarity fell
 * from 0.711 on profitable samples to 0.578 on losing ones while hallucination
 * rose from 0.104 to 0.176. The fix is to scale gains by (0.5 + s) and losses
 * by (2 - s), so a bad rationale on a loss is punished more, never less. See
 * `applyAsymmetricOutcomeGate`.
 *
 * Retrieve before judging. Hard-match the entities named in the decision, then
 * rank the rest by embedding similarity and keep top-k. In the paper this cut
 * judge context from ~30K to ~10K tokens, halved evaluation time, and cut
 * score variance from +/-0.252 to +/-0.060. `narrowEvidence` is that seam,
 * with both the matcher and the ranker injected so no embedding model is
 * required to exercise it.
 *
 * The judge itself is an injected function. The module performs no LLM call,
 * reads no clock, and is fully deterministic under a stub judge.
 */

export type ConsistencyLeg = "factuality" | "deduction" | "consistency";

export const CONSISTENCY_LEGS: readonly ConsistencyLeg[] = [
  "factuality",
  "deduction",
  "consistency",
] as const;

/** Which pair of the triple each leg relates, for prompt construction and reporting. */
export const LEG_RELATION: Record<ConsistencyLeg, { from: string; to: string; question: string }> =
  {
    factuality: {
      from: "evidence",
      to: "reasoning",
      question: "Is every substantive claim in the reasoning supported by the evidence?",
    },
    deduction: {
      from: "reasoning",
      to: "decision",
      question: "Does the decision follow from the reasoning, with no unstated leap?",
    },
    consistency: {
      from: "evidence",
      to: "decision",
      question: "Does the decision align with the evidence directly, ignoring the reasoning?",
    },
  };

export interface EvidenceChunk {
  id: string;
  text: string;
  /** Where the chunk came from (tool call id, headline url, filing accession). */
  source?: string;
}

export interface RationaleTriple {
  /** Retrieved evidence E, ideally already narrowed by `narrowEvidence`. */
  evidence: readonly EvidenceChunk[];
  /** Reasoning chain c: the rationale text the agent produced. */
  reasoning: string;
  /** Decision d: the action being justified, in whatever form the caller logs it. */
  decision: string;
}

export interface TriangularJudgeRequest {
  leg: ConsistencyLeg;
  triple: RationaleTriple;
  /** Fully rendered prompt for this leg. Stub judges may ignore it. */
  prompt: string;
}

export interface TriangularJudgeVerdict {
  /** Must be a finite number in [0, 1]. Anything else is treated as malformed. */
  score: number;
  justification?: string;
}

/**
 * The injected judge. May return null/undefined or throw: both are treated as
 * a malformed response, never as a passing score.
 */
export type TriangularJudge = (
  request: TriangularJudgeRequest,
) => Promise<TriangularJudgeVerdict | null | undefined> | TriangularJudgeVerdict | null | undefined;

export interface LegScore {
  leg: ConsistencyLeg;
  score: number;
  justification: string;
}

export interface ScoredConsistencyResult {
  scored: true;
  legs: Record<ConsistencyLeg, LegScore>;
  factuality: number;
  deduction: number;
  consistency: number;
  /** Mean of the three legs, in [0, 1]. */
  mean: number;
  evidenceCount: number;
}

export interface UnscoredConsistencyResult {
  scored: false;
  /** Human-readable reason the triple could not be scored. */
  reason: string;
  /** Legs whose judge response was missing or malformed. */
  failedLegs: ConsistencyLeg[];
  /** Legs that did return a usable score, for diagnosis only. */
  partialLegs: LegScore[];
  evidenceCount: number;
}

export type TriangularConsistencyResult = ScoredConsistencyResult | UnscoredConsistencyResult;

/**
 * Score used for an unscored triple when it has to be reduced to a number.
 * Absence of evidence of quality is not evidence of quality, so the worst
 * possible score is the only safe reduction.
 */
export const UNSCORED_CONSISTENCY_SCORE = 0;

// ============================================================================
// Prompting
// ============================================================================

function renderEvidence(evidence: readonly EvidenceChunk[]): string {
  if (evidence.length === 0) return "(no evidence retrieved)";
  return evidence
    .map((chunk) => `[${chunk.id}]${chunk.source ? ` (${chunk.source})` : ""} ${chunk.text}`)
    .join("\n");
}

export function buildLegPrompt(leg: ConsistencyLeg, triple: RationaleTriple): string {
  const relation = LEG_RELATION[leg];
  const lines: string[] = [
    `You are scoring ONE relation of a trading rationale: ${relation.from} -> ${relation.to}.`,
    "",
    relation.question,
    "",
    "Score 0.0 to 1.0. 1.0 means fully supported with no unsupported step. 0.0 means",
    "unsupported or contradicted. Judge only this relation: do not reward fluency,",
    "confidence, or the parts of the triple this relation does not cover.",
    "",
    'Output JSON only: { "score": <number 0..1>, "justification": "<one sentence>" }',
    "",
  ];
  if (leg !== "deduction") {
    lines.push("EVIDENCE:", renderEvidence(triple.evidence), "");
  }
  if (leg !== "consistency") {
    lines.push("REASONING:", triple.reasoning, "");
  }
  if (leg !== "factuality") {
    lines.push("DECISION:", triple.decision, "");
  }
  return lines.join("\n");
}

// ============================================================================
// Triangular scoring
// ============================================================================

function isUsableScore(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

/**
 * Score all three legs of the triple. Any leg whose judge response is missing
 * or malformed makes the whole result unscored: a two-leg mean would silently
 * pass a rationale whose third leg was never checked.
 */
export async function scoreTriangularConsistency(
  triple: RationaleTriple,
  judge: TriangularJudge,
): Promise<TriangularConsistencyResult> {
  const scores: Partial<Record<ConsistencyLeg, LegScore>> = {};
  const failedLegs: ConsistencyLeg[] = [];
  const failureNotes: string[] = [];

  for (const leg of CONSISTENCY_LEGS) {
    const prompt = buildLegPrompt(leg, triple);
    let verdict: TriangularJudgeVerdict | null | undefined;
    try {
      verdict = await judge({ leg, triple, prompt });
    } catch (error) {
      failedLegs.push(leg);
      failureNotes.push(
        `${leg}: judge threw (${error instanceof Error ? error.message : String(error)})`,
      );
      continue;
    }
    if (verdict === null || verdict === undefined) {
      failedLegs.push(leg);
      failureNotes.push(`${leg}: judge returned no verdict`);
      continue;
    }
    if (!isUsableScore(verdict.score)) {
      failedLegs.push(leg);
      failureNotes.push(`${leg}: score ${JSON.stringify(verdict.score)} is not a number in [0,1]`);
      continue;
    }
    scores[leg] = {
      leg,
      score: verdict.score,
      justification: verdict.justification ?? "",
    };
  }

  const evidenceCount = triple.evidence.length;

  if (failedLegs.length > 0) {
    return {
      scored: false,
      reason: failureNotes.join("; "),
      failedLegs,
      partialLegs: CONSISTENCY_LEGS.map((leg) => scores[leg]).filter(
        (s): s is LegScore => s !== undefined,
      ),
      evidenceCount,
    };
  }

  const factuality = scores.factuality!.score;
  const deduction = scores.deduction!.score;
  const consistency = scores.consistency!.score;

  return {
    scored: true,
    legs: {
      factuality: scores.factuality!,
      deduction: scores.deduction!,
      consistency: scores.consistency!,
    },
    factuality,
    deduction,
    consistency,
    mean: (factuality + deduction + consistency) / 3,
    evidenceCount,
  };
}

/** Reduce a result to a single score, mapping unscored to the worst score. */
export function consistencyScoreOf(result: TriangularConsistencyResult): number {
  return result.scored ? result.mean : UNSCORED_CONSISTENCY_SCORE;
}

/** The leg that failed hardest, so a caller can say which relation broke. */
export function weakestLeg(result: ScoredConsistencyResult): LegScore {
  return CONSISTENCY_LEGS.map((leg) => result.legs[leg]).reduce((worst, current) =>
    current.score < worst.score ? current : worst,
  );
}

// ============================================================================
// Asymmetric outcome gate
// ============================================================================

export type OutcomeDirection = "gain" | "loss";

export interface AsymmetricGateResult {
  /** Consistency score fed into the gate, in [0, 1]. */
  score: number;
  /** Realized outcome before adjustment (signed PnL, R-multiple, whatever the caller uses). */
  rawOutcome: number;
  direction: OutcomeDirection;
  /** (0.5 + s) on a gain, (2 - s) on a loss. */
  multiplier: number;
  adjustedOutcome: number;
  /** True when the adjustment moved the outcome against the agent. */
  penalized: boolean;
}

/**
 * The gameable baseline, exported so callers and tests can show what the
 * asymmetric gate replaces. Under this, a losing agent shrinks its own
 * penalty by lowering its own score.
 */
export function symmetricOutcomeProduct(rawOutcome: number, score: number): number {
  return rawOutcome * score;
}

/**
 * Combine a realized outcome with a consistency score, asymmetrically.
 *
 * Gains scale by (0.5 + s): a low-consistency win is still discounted, because
 * being right for unsupported reasons is luck and should not reinforce.
 * Losses scale by (2 - s): a low-consistency loss is amplified, which closes
 * the penalty-evasion channel that a symmetric product leaves open.
 *
 * An outcome of exactly zero is treated as a gain direction: the multiplier is
 * irrelevant at zero and calling it a loss would imply a penalty that is not there.
 */
export function applyAsymmetricOutcomeGate(
  rawOutcome: number,
  score: number,
): AsymmetricGateResult {
  const clamped = Math.min(1, Math.max(0, score));
  const direction: OutcomeDirection = rawOutcome >= 0 ? "gain" : "loss";
  const multiplier = direction === "gain" ? 0.5 + clamped : 2 - clamped;
  const adjustedOutcome = rawOutcome * multiplier;
  return {
    score: clamped,
    rawOutcome,
    direction,
    multiplier,
    adjustedOutcome,
    penalized: adjustedOutcome < rawOutcome,
  };
}

/** Convenience wrapper: an unscored triple enters the gate at the worst score. */
export function gateOutcomeByConsistency(
  rawOutcome: number,
  result: TriangularConsistencyResult,
): AsymmetricGateResult {
  return applyAsymmetricOutcomeGate(rawOutcome, consistencyScoreOf(result));
}

// ============================================================================
// Retrieval narrowing
// ============================================================================

/** Extracts the entities a decision names (symbols, venues, instruments). */
export type EntityMatcher = (decision: string) => readonly string[];

/** Ranks a chunk against the decision. Higher is more relevant. Embedding similarity in production. */
export type ChunkRanker = (chunk: EvidenceChunk, decision: string) => number;

export interface NarrowEvidenceOptions {
  matcher: EntityMatcher;
  ranker: ChunkRanker;
  /** How many ranked (non hard-matched) chunks to keep. Default 5. */
  topK?: number;
}

export interface NarrowEvidenceResult {
  evidence: EvidenceChunk[];
  /** Chunks kept because they name an entity from the decision. */
  hardMatched: EvidenceChunk[];
  /** Chunks kept on ranker score alone. */
  ranked: EvidenceChunk[];
  entities: string[];
  droppedCount: number;
}

/**
 * Narrow the full context down to the evidence a judge actually needs.
 *
 * Hard matches are unconditional: a chunk that names an entity from the
 * decision is the evidence most likely to contradict it, and a ranker that
 * scores it low would hide exactly the disconfirming material. topK applies
 * only to the remainder.
 */
export function narrowEvidence(
  context: readonly EvidenceChunk[],
  decision: string,
  options: NarrowEvidenceOptions,
): NarrowEvidenceResult {
  const topK = options.topK ?? 5;
  const entities = options
    .matcher(decision)
    .map((entity) => entity.trim())
    .filter((entity) => entity.length > 0);
  const needles = entities.map((entity) => entity.toLowerCase());

  const hardMatched: EvidenceChunk[] = [];
  const remainder: EvidenceChunk[] = [];
  for (const chunk of context) {
    const haystack = `${chunk.text} ${chunk.source ?? ""}`.toLowerCase();
    if (needles.some((needle) => haystack.includes(needle))) hardMatched.push(chunk);
    else remainder.push(chunk);
  }

  const ranked = remainder
    .map((chunk, index) => ({ chunk, index, score: options.ranker(chunk, decision) }))
    // Index breaks ties so the same input always yields the same ordering.
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, Math.max(0, topK))
    .map((entry) => entry.chunk);

  return {
    evidence: [...hardMatched, ...ranked],
    hardMatched,
    ranked,
    entities,
    droppedCount: context.length - hardMatched.length - ranked.length,
  };
}

// ============================================================================
// Reporting
// ============================================================================

export function formatConsistencyResult(result: TriangularConsistencyResult): string {
  if (!result.scored) {
    return [
      `Rationale consistency: UNSCORED (${result.failedLegs.join(", ")})`,
      `  reason: ${result.reason}`,
      `  treated as score ${UNSCORED_CONSISTENCY_SCORE.toFixed(2)}`,
    ].join("\n");
  }
  const weakest = weakestLeg(result);
  return [
    `Rationale consistency: ${result.mean.toFixed(2)} over ${result.evidenceCount} evidence chunks`,
    `  factuality (E->c):  ${result.factuality.toFixed(2)}`,
    `  deduction  (c->d):  ${result.deduction.toFixed(2)}`,
    `  consistency (E->d): ${result.consistency.toFixed(2)}`,
    `  weakest leg: ${weakest.leg}${weakest.justification ? `: ${weakest.justification}` : ""}`,
  ].join("\n");
}

export function consistencyResultToPayload(
  result: TriangularConsistencyResult,
): Record<string, unknown> {
  if (!result.scored) {
    return {
      kind: "rationale_consistency.unscored",
      scored: false,
      failedLegs: result.failedLegs,
      reason: result.reason,
      evidenceCount: result.evidenceCount,
    };
  }
  return {
    kind: "rationale_consistency.scored",
    scored: true,
    factuality: Number(result.factuality.toFixed(3)),
    deduction: Number(result.deduction.toFixed(3)),
    consistency: Number(result.consistency.toFixed(3)),
    mean: Number(result.mean.toFixed(3)),
    weakestLeg: weakestLeg(result).leg,
    evidenceCount: result.evidenceCount,
  };
}
