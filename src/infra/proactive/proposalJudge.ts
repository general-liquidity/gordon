/**
 * Proactive Proposal Judge
 *
 * Evaluates whether a candidate suggestion is worth firing. Inspired by
 * ProactiveAgent-main's reward model pattern: a separate scoring layer that
 * rates {observation, proposed_task} independently from the candidate
 * generator. Prevents the engine from firing everything it thinks of.
 *
 * v1 implementation is a rule-based heuristic judge — fast, deterministic,
 * no LLM call. Intentionally pluggable so an LLM judge can be added later
 * without changing callers. A candidate must pass:
 *
 *   1. Confidence gate (candidate.confidence >= threshold)
 *   2. Category policy (cooldown, suppression, hourly cap)
 *   3. Recency gate (no near-duplicate in the last 10 minutes)
 *   4. Relevance heuristic (trigger metadata makes sense for the category)
 *
 * The LLM judge slot is exposed via the `ProposalJudge` interface so a
 * future implementation can do {observation → LLM call → confidence + reason}
 * while keeping the same public API.
 */

import type { ProactiveSuggestion, ProactiveCategory } from "./types.ts";
import { getCategoryPolicy } from "./categoryPolicy.ts";
import { getSuggestionStore } from "./suggestionStore.ts";

// ============================================================================
// Judge interface
// ============================================================================

export interface JudgeVerdict {
  shouldFire: boolean;
  confidence: number;
  reasoning: string;
  rejections: string[];
}

export interface ProposalJudge {
  /** Judge a candidate. Does not mutate store or policy. */
  evaluate(candidate: ProactiveSuggestion): Promise<JudgeVerdict>;
  /** Optional name for diagnostics. */
  name: string;
}

// ============================================================================
// Heuristic judge — the default
// ============================================================================

export class HeuristicJudge implements ProposalJudge {
  name = "heuristic-v1";

  async evaluate(candidate: ProactiveSuggestion): Promise<JudgeVerdict> {
    const rejections: string[] = [];
    const policy = getCategoryPolicy();
    const store = getSuggestionStore();

    // 1. Category policy (cooldown, rate limit, suppression, confidence)
    const policyCheck = policy.canFire(candidate.category, candidate.confidence);
    if (!policyCheck.allowed) {
      rejections.push(`policy: ${policyCheck.reason}`);
    }

    // 2. Recency / near-duplicate check
    const recent = store.getRecent(20, { category: candidate.category });
    const tenMinAgo = Date.now() - 10 * 60 * 1000;
    const nearDup = recent.find((s) => {
      if (new Date(s.createdAt).getTime() < tenMinAgo) return false;
      return (
        s.triggers.symbol === candidate.triggers.symbol &&
        s.triggers.eventType === candidate.triggers.eventType
      );
    });
    if (nearDup) {
      rejections.push(`duplicate of ${nearDup.id} within 10min`);
    }

    // 3. Category-specific relevance heuristics
    const relevanceCheck = this.checkRelevance(candidate);
    if (!relevanceCheck.ok) {
      rejections.push(`relevance: ${relevanceCheck.reason}`);
    }

    const shouldFire = rejections.length === 0;
    const reasoning = shouldFire
      ? `Passed: confidence=${candidate.confidence.toFixed(2)}, policy OK, no duplicates, relevance OK`
      : `Rejected: ${rejections.join("; ")}`;

    return {
      shouldFire,
      confidence: candidate.confidence,
      reasoning,
      rejections,
    };
  }

  private checkRelevance(
    candidate: ProactiveSuggestion,
  ): { ok: boolean; reason?: string } {
    const { category, triggers } = candidate;
    switch (category) {
      case "whale_alert":
      case "stop_loss_tighten":
      case "missed_entry":
      case "volatility_spike":
      case "funding_alert":
        if (!triggers.symbol) {
          return { ok: false, reason: `${category} needs a symbol` };
        }
        return { ok: true };

      case "regime_flip":
        if (!triggers.eventType && !triggers.metadata) {
          return { ok: false, reason: "regime_flip needs a regime transition" };
        }
        return { ok: true };

      case "portfolio_drift":
      case "position_review":
      case "risk_warning":
        return { ok: true }; // Portfolio-level, no single symbol needed

      case "journal_prompt":
      case "session_review":
        return { ok: true }; // Always relevant at end of session

      case "playbook_suggest":
      case "news_event":
        return { ok: true };

      default:
        return { ok: true };
    }
  }
}

// ============================================================================
// Active judge (singleton with pluggable strategy)
// ============================================================================

let activeJudge: ProposalJudge = new HeuristicJudge();

export function getActiveJudge(): ProposalJudge {
  return activeJudge;
}

export function setActiveJudge(judge: ProposalJudge): void {
  activeJudge = judge;
}

export async function judgeCandidate(
  candidate: ProactiveSuggestion,
): Promise<JudgeVerdict> {
  return activeJudge.evaluate(candidate);
}

// Re-export for convenience
export type { ProactiveCategory };
