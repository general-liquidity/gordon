/**
 * Edge Attribution (GORDON_EDGE_ATTRIBUTION).
 *
 * Port of Wright Ch 7. Implements the BAIT framework + the Alpha Check
 * pre-trade question:
 *
 *   "I am taking the other side of [specific participant] who is
 *    forced to transact because [specific constraint]."
 *
 * Four edge types (BAIT):
 *   - Behavioral: exploit predictable irrational patterns
 *   - Analytical: process information better than consensus
 *   - Informational: knowing something material the market doesn't
 *   - Technical (structural): mechanics + forced flows
 *
 * Lebron's test: if you can't explain your edge in 5 minutes, you don't
 * have one. This module forces explicit attribution before order send.
 * Composes with WW17 marginalParticipantClassifier (the counterparty
 * side of the equation) and `confluenceScorer` (raises the floor: an
 * A* setup with no attributable edge is suspect).
 */

export type EdgeType = "behavioral" | "analytical" | "informational" | "structural";

export interface EdgeAttributionInput {
  edgeType: EdgeType;
  /** The counterparty whose other side you're taking. */
  counterparty: string;
  /** Specific reason they're forced/biased to transact. */
  constraint: string;
  /** Free-text articulation of the edge (Lebron's 5-min test). */
  edgeArticulation: string;
}

export interface EdgeAttributionResult {
  edgeType: EdgeType;
  counterparty: string;
  constraint: string;
  edgeArticulation: string;
  passesFiveMinTest: boolean;
  verdict: "valid_edge" | "weak_edge" | "no_edge";
  reasons: string[];
}

const MIN_ARTICULATION_WORDS = 15;
const MIN_COUNTERPARTY_LENGTH = 5;
const MIN_CONSTRAINT_LENGTH = 8;

export function attributeEdge(input: EdgeAttributionInput): EdgeAttributionResult {
  const reasons: string[] = [];
  const counterparty = input.counterparty.trim();
  const constraint = input.constraint.trim();
  const articulation = input.edgeArticulation.trim();
  const wordCount = articulation.split(/\s+/).filter(Boolean).length;

  if (counterparty.length < MIN_COUNTERPARTY_LENGTH) {
    reasons.push("Counterparty too vague (need a specific participant)");
  }
  if (constraint.length < MIN_CONSTRAINT_LENGTH) {
    reasons.push("Constraint too vague (need a specific reason they must trade)");
  }
  if (wordCount < MIN_ARTICULATION_WORDS) {
    reasons.push(`Edge articulation under ${MIN_ARTICULATION_WORDS} words — fails 5-min test`);
  }

  const passesFiveMinTest = wordCount >= MIN_ARTICULATION_WORDS;
  let verdict: EdgeAttributionResult["verdict"];
  if (reasons.length === 0) verdict = "valid_edge";
  else if (reasons.length === 1) verdict = "weak_edge";
  else verdict = "no_edge";

  return {
    edgeType: input.edgeType,
    counterparty,
    constraint,
    edgeArticulation: articulation,
    passesFiveMinTest,
    verdict,
    reasons,
  };
}

export function attributionToPayload(result: EdgeAttributionResult): Record<string, unknown> {
  return {
    kind: "edge_attribution.evaluated",
    edgeType: result.edgeType,
    verdict: result.verdict,
    passesFiveMinTest: result.passesFiveMinTest,
    blockerCount: result.reasons.length,
  };
}
