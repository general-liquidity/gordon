/**
 * Explain-before-execute mode (GORDON_EXPLAIN_FIRST).
 *
 * Forces the user to articulate their thesis BEFORE Gordon's analysis is
 * revealed, so supervision skill stays sharp instead of decaying into
 * thumb-up rubber-stamping. Anti-atrophy defense from the "agentic
 * coding is a trap" critique applied to vibe trading: never delegate
 * what you couldn't do yourself.
 *
 * Flow:
 *   1. Agent prompts the user for their thesis when a plan is ready.
 *   2. recordUserThesis() stores it keyed by planId (session-scoped).
 *   3. execute_plan checks requiresUserThesis() before allowing.
 *   4. After execution, computeThesisDivergence() lets the ACE Reflector
 *      observe how the user's thesis compared to Gordon's rationale.
 */

import { flagEnv } from "../../config/flagResolver.ts";

export interface UserThesis {
  planId: string;
  thesis: string;
  capturedAt: string;
  source: "user_input" | "agent_summarized";
}

const thesisStore = new Map<string, UserThesis>();

export function isExplainFirstEnabled(
  env: NodeJS.ProcessEnv = flagEnv(),
): boolean {
  return env.GORDON_EXPLAIN_FIRST === "1" || env.GORDON_EXPLAIN_FIRST === "true";
}

export function recordUserThesis(
  planId: string,
  thesis: string,
  source: UserThesis["source"] = "user_input",
): UserThesis {
  if (!planId || planId.length === 0) {
    throw new Error("recordUserThesis: planId is required");
  }
  if (!thesis || thesis.trim().length < 10) {
    throw new Error(
      "recordUserThesis: thesis must be at least 10 characters — articulate why this setup makes sense in your own words",
    );
  }
  const entry: UserThesis = {
    planId,
    thesis: thesis.trim(),
    capturedAt: new Date().toISOString(),
    source,
  };
  thesisStore.set(planId, entry);
  return entry;
}

export function getUserThesis(planId: string): UserThesis | undefined {
  return thesisStore.get(planId);
}

export function clearUserThesis(planId: string): void {
  thesisStore.delete(planId);
}

export interface ThesisRequirement {
  required: boolean;
  reason?: string;
}

export function requiresUserThesis(
  planId: string,
  env: NodeJS.ProcessEnv = flagEnv(),
): ThesisRequirement {
  if (!isExplainFirstEnabled(env)) return { required: false };
  const thesis = thesisStore.get(planId);
  if (!thesis) {
    return {
      required: true,
      reason:
        "GORDON_EXPLAIN_FIRST is enabled. Before executing, capture the user's own thesis via recordUserThesis() — they must articulate why this setup makes sense in their own words BEFORE seeing Gordon's analysis. This builds supervision skill instead of eroding it.",
    };
  }
  return { required: false };
}

/**
 * Coarse Jaccard-divergence between user thesis and Gordon's rationale.
 * Returns score in [0,1] where 1 = highly divergent. Token-overlap
 * heuristic, not semantic — useful as an observation signal for the
 * ACE Reflector to flag interesting cases, not as a gate.
 */
export function computeThesisDivergence(
  thesis: string,
  rationale: string,
): number {
  const toks = (s: string): Set<string> =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((t) => t.length > 3),
    );
  const a = toks(thesis);
  const b = toks(rationale);
  if (a.size === 0 || b.size === 0) return 1;
  let overlap = 0;
  for (const t of a) if (b.has(t)) overlap++;
  const jaccard = overlap / (a.size + b.size - overlap);
  return 1 - jaccard;
}

export function _resetThesisStoreForTest(): void {
  thesisStore.clear();
}
