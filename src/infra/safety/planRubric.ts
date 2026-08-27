/**
 * Plan Rubric (GORDON_PLAN_RUBRIC).
 *
 * Direct port of the evaluator rubric from learn-harness-engineering's
 * resource library: a 6-row 0-2 scoring grid producing one of three
 * verdicts: `accept`, `revise`, `block`.
 *
 * Gordon's critique phase already grades plans internally. This module
 * makes the rubric explicit and surfaceable so:
 *   - the plan card can display a structured score, not just a verdict
 *   - regressions are detectable across versions (compare two rubrics)
 *   - the critique stage has a stable schema for its output
 *
 * Six dimensions, each 0/1/2 (no/partial/yes):
 *   correctness      — does the plan match the requested intent?
 *   verification     — did the required pre-trade checks actually run, with evidence?
 *   scopeDiscipline  — did the plan stay inside the chosen mandate/universe?
 *   reliability      — does the plan tolerate restart/rerun without manual repair?
 *   maintainability  — is the plan and its observations clear for the next session?
 *   handoffReadiness — can a fresh session continue from the plan and audit log alone?
 *
 * Verdict mapping (matches the source rubric semantics):
 *   total >= 10 AND no zeros            → accept
 *   total >= 7  AND no dimension is 0   → revise
 *   otherwise                           → block
 */

import { flagEnv } from "../config/flagResolver.ts";

export type RubricScore = 0 | 1 | 2;

export interface PlanRubric {
  correctness: RubricScore;
  verification: RubricScore;
  scopeDiscipline: RubricScore;
  reliability: RubricScore;
  maintainability: RubricScore;
  handoffReadiness: RubricScore;
  notes?: Partial<Record<keyof Omit<PlanRubric, "notes">, string>>;
}

export type RubricVerdict = "accept" | "revise" | "block";

export const RUBRIC_DIMENSIONS = [
  "correctness",
  "verification",
  "scopeDiscipline",
  "reliability",
  "maintainability",
  "handoffReadiness",
] as const satisfies ReadonlyArray<keyof Omit<PlanRubric, "notes">>;

export type RubricDimension = (typeof RUBRIC_DIMENSIONS)[number];

export function isPlanRubricEnabled(env: NodeJS.ProcessEnv = flagEnv()): boolean {
  return env.GORDON_PLAN_RUBRIC === "1" || env.GORDON_PLAN_RUBRIC === "true";
}

export function rubricTotal(rubric: PlanRubric): number {
  return RUBRIC_DIMENSIONS.reduce((sum, dim) => sum + rubric[dim], 0);
}

export function rubricVerdict(rubric: PlanRubric): RubricVerdict {
  const hasZero = RUBRIC_DIMENSIONS.some((dim) => rubric[dim] === 0);
  const total = rubricTotal(rubric);
  if (total >= 10 && !hasZero) return "accept";
  if (total >= 7 && !hasZero) return "revise";
  return "block";
}

/**
 * Dimensions that scored 0. Surfaced to the user as the actionable
 * delta — "what to fix to move from block→revise→accept."
 */
export function blockingDimensions(rubric: PlanRubric): RubricDimension[] {
  return RUBRIC_DIMENSIONS.filter((dim) => rubric[dim] === 0);
}

/**
 * Compare two rubrics scored at different times (e.g. before-critique
 * vs after-critique). Returns the per-dimension delta and a regression
 * flag if any dimension went down.
 */
export interface RubricDelta {
  perDimension: Record<RubricDimension, number>;
  totalDelta: number;
  hasRegression: boolean;
  verdictChange: { from: RubricVerdict; to: RubricVerdict };
}

export function compareRubrics(before: PlanRubric, after: PlanRubric): RubricDelta {
  const perDimension = {} as Record<RubricDimension, number>;
  let hasRegression = false;
  for (const dim of RUBRIC_DIMENSIONS) {
    const delta = after[dim] - before[dim];
    perDimension[dim] = delta;
    if (delta < 0) hasRegression = true;
  }
  return {
    perDimension,
    totalDelta: rubricTotal(after) - rubricTotal(before),
    hasRegression,
    verdictChange: { from: rubricVerdict(before), to: rubricVerdict(after) },
  };
}

/**
 * Default-zero rubric — useful as a starting point when the critique
 * stage hasn't filled anything in yet. The verdict for an all-zero
 * rubric is `block`, which is the safe default ("nothing scored
 * means nothing accepted").
 */
export function emptyRubric(): PlanRubric {
  return {
    correctness: 0,
    verification: 0,
    scopeDiscipline: 0,
    reliability: 0,
    maintainability: 0,
    handoffReadiness: 0,
  };
}

export function rubricToPayload(rubric: PlanRubric): Record<string, unknown> {
  const verdict = rubricVerdict(rubric);
  return {
    kind: "plan.rubric_recorded",
    scores: {
      correctness: rubric.correctness,
      verification: rubric.verification,
      scopeDiscipline: rubric.scopeDiscipline,
      reliability: rubric.reliability,
      maintainability: rubric.maintainability,
      handoffReadiness: rubric.handoffReadiness,
    },
    total: rubricTotal(rubric),
    verdict,
    blockingDimensions: blockingDimensions(rubric),
    notes: rubric.notes ?? {},
  };
}

/**
 * Human-readable one-line summary. Useful for plan-card rendering.
 */
export function formatRubric(rubric: PlanRubric): string {
  const verdict = rubricVerdict(rubric);
  const total = rubricTotal(rubric);
  const scores = RUBRIC_DIMENSIONS.map((d) => `${shortName(d)}:${rubric[d]}`).join(" ");
  return `${verdict.toUpperCase()} (${total}/12) — ${scores}`;
}

function shortName(dim: RubricDimension): string {
  switch (dim) {
    case "correctness":
      return "corr";
    case "verification":
      return "verif";
    case "scopeDiscipline":
      return "scope";
    case "reliability":
      return "rel";
    case "maintainability":
      return "maint";
    case "handoffReadiness":
      return "hand";
  }
}

/** Minimal plan shape for heuristic rubric scoring at approval time. */
export interface ScorePlanRubricInput {
  plan: {
    id: string;
    symbol: string;
    strategy: string;
    reasoning?: string;
    stopLoss: { price: number };
    takeProfit: Array<{ price: number }>;
    entry: { type: string; price: number | null };
    allocation: { percentOfPortfolio: number };
  };
  reflection?: {
    isValid: boolean;
    issues: string[];
    confidence: number;
  };
}

export interface CritiqueWithRubricResult {
  rubric: PlanRubric;
  verdict: RubricVerdict;
  total: number;
  blockingDimensions: RubricDimension[];
}

/**
 * Heuristic 6-dimension rubric from plan + reflection signals.
 * Cheap enough to run in-band at plan-approval time when the flag is on.
 */
export function scorePlanRubric(input: ScorePlanRubricInput): PlanRubric {
  const rubric = emptyRubric();
  const reflection = input.reflection;

  if (reflection?.isValid) rubric.correctness = 2;
  else if (reflection && reflection.issues.length <= 2) rubric.correctness = 1;

  if (!reflection) rubric.verification = 0;
  else if (reflection.issues.length === 0) rubric.verification = 2;
  else rubric.verification = 1;

  rubric.scopeDiscipline =
    input.plan.stopLoss.price > 0 && input.plan.takeProfit.length > 0 ? 2 : 1;

  rubric.reliability = input.plan.id && input.plan.entry.type ? 2 : input.plan.id ? 1 : 0;

  const reasoningLen = input.plan.reasoning?.length ?? 0;
  rubric.maintainability = reasoningLen > 100 ? 2 : reasoningLen > 20 ? 1 : 0;

  rubric.handoffReadiness = input.plan.id && input.plan.reasoning ? 2 : input.plan.id ? 1 : 0;

  return rubric;
}

/** Score + aggregate verdict for plan-card rendering. */
export function runCritiqueWithRubric(input: ScorePlanRubricInput): CritiqueWithRubricResult {
  const rubric = scorePlanRubric(input);
  return {
    rubric,
    verdict: rubricVerdict(rubric),
    total: rubricTotal(rubric),
    blockingDimensions: blockingDimensions(rubric),
  };
}
