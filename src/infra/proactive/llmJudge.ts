/**
 * LLM-Based Proposal Judge
 *
 * Alternative to the heuristic judge — uses an LLM to make the nuanced
 * "is this suggestion worth interrupting the user right now?" call. The
 * heuristic judge catches obvious wins and obvious misses (confidence
 * gate, cooldown, duplicates); the LLM judge catches the middle ground
 * where context and recent user activity matter.
 *
 * Design:
 *   1. Always run the heuristic judge first as a cheap floor. If it rejects
 *      for policy / cooldown / duplicate reasons, return that rejection
 *      immediately — no LLM call burned on definite-no cases.
 *   2. If the heuristic allows, build a compact JSON prompt with the
 *      candidate, recent similar suggestions, category stats, and policy
 *      state. Send to Gordon's configured runtime model.
 *   3. Parse the model's response (JSON with shouldFire/confidence/reasoning).
 *      On any failure — model unavailable, bad JSON, timeout — fall back to
 *      the heuristic verdict instead of crashing the engine.
 *
 * Activation: not active by default. Wire it in via `setActiveJudge(new LlmJudge())`
 * or the `set_proactive_judge` tool. The heuristic judge remains the default.
 *
 * Latency: each candidate incurs one model round-trip (typically 300-1500ms
 * depending on the model). Acceptable because proactive suggestions are not
 * latency-sensitive — users don't notice a 1-second delay before a card
 * appears. For bursty event loads the engine's sequential drain means
 * judges run one at a time, so total delay scales linearly.
 */

import { Agent } from "@mastra/core/agent";

import type { ProactiveSuggestion } from "./types.ts";
import type { ProposalJudge, JudgeVerdict } from "./proposalJudge.ts";
import { HeuristicJudge } from "./proposalJudge.ts";
import { getSuggestionStore } from "./suggestionStore.ts";
import { getCategoryPolicy } from "./categoryPolicy.ts";
import { resolveRuntimeModel } from "../agents/agentHelpers.ts";
import { createModuleLogger } from "../logger/index.ts";

const logger = createModuleLogger("proactive-llm-judge");

const JUDGE_SYSTEM_PROMPT = `You are Gordon's proactive judge. Your job is to decide whether a candidate trading suggestion should be surfaced to the user right now, or silently dropped.

The user is a discretionary trader. Gordon's job is to be HELPFUL without being noisy. A good judge fires when a suggestion is genuinely useful at this moment, stays silent when it would duplicate something the user already knows, and respects the user's recent dismissal patterns.

You will receive a JSON input describing:
- The candidate suggestion (category, title, body, heuristic confidence, triggers)
- Recent similar suggestions in the same category (status + age in minutes)
- Category statistics (accept/dismiss counts, acceptance rate)
- Category policy (cooldown, min confidence, hourly cap)

Output exactly this JSON shape (no prose, no markdown fences, no commentary):
{"shouldFire": boolean, "confidence": number, "reasoning": "one short sentence"}

Heuristics to apply:
- Default to shouldFire: false when in doubt. A missed helpful suggestion is usually less bad than a noisy false alarm.
- If the recent similar list shows 2+ dismissed suggestions in the last hour, drop to false.
- If the candidate is a near-duplicate of anything in recent similar (same symbol, same category, <30 min old), drop to false.
- Raise confidence when the trigger is high-signal (whale transfer, regime flip, stop approaching) and the user has no recent dismissals for this category.
- Lower confidence when the trigger is periodic / informational (journal prompt, session review) unless the timing is exactly right.
- Funding alerts fire when the user has open positions in the affected coin OR when funding is extreme (|annualized| > 40%).
- Never output null or undefined. Numbers must be finite; booleans must be true or false; reasoning must be a non-empty string.`;

// Lazy agent — built once on first call. Reuses Gordon's runtime model routing.
let judgeAgent: Agent | null = null;

function getJudgeAgent(): Agent {
  if (!judgeAgent) {
    judgeAgent = new Agent({
      id: "proactive-judge",
      name: "Proactive Judge",
      description: "Evaluates whether proactive suggestions should fire to the user.",
      instructions: JUDGE_SYSTEM_PROMPT,
      model: resolveRuntimeModel,
    });
  }
  return judgeAgent;
}

// ============================================================================
// Judge implementation
// ============================================================================

export class LlmJudge implements ProposalJudge {
  name = "llm-judge-v1";
  private fallback = new HeuristicJudge();

  async evaluate(candidate: ProactiveSuggestion): Promise<JudgeVerdict> {
    // Always run heuristic first — if it rejects on policy/cooldown/duplicate,
    // no need to burn an LLM call. Only nuance cases reach the model.
    const heuristicResult = await this.fallback.evaluate(candidate);
    if (!heuristicResult.shouldFire) {
      return {
        ...heuristicResult,
        reasoning: `heuristic-pre-reject: ${heuristicResult.reasoning}`,
      };
    }

    const prompt = buildJudgePrompt(candidate);

    try {
      const agent = getJudgeAgent();
      const response = await (agent.generate as (p: string, o: Record<string, unknown>) => Promise<unknown>)(prompt, {
        temperature: 0.2,
        maxSteps: 1,
      });
      const rawText = typeof response === "object" && response !== null && "text" in response
        ? String((response as { text: string }).text)
        : String(response);

      const parsed = parseJudgeResponse(rawText);
      if (!parsed) {
        logger.warn("LLM judge returned unparseable response", { preview: rawText.slice(0, 200) });
        return this.appendFallbackNote(heuristicResult, "LLM returned unparseable response");
      }

      return {
        shouldFire: parsed.shouldFire,
        confidence: clamp01(parsed.confidence),
        reasoning: `LLM: ${parsed.reasoning}`,
        rejections: parsed.shouldFire ? [] : [parsed.reasoning],
      };
    } catch (err) {
      logger.warn("LLM judge call failed, using heuristic fallback", { err: String(err) });
      return this.appendFallbackNote(heuristicResult, `LLM error: ${(err as Error).message}`);
    }
  }

  private appendFallbackNote(heuristicResult: JudgeVerdict, note: string): JudgeVerdict {
    return {
      ...heuristicResult,
      reasoning: `${heuristicResult.reasoning} (fallback: ${note})`,
    };
  }
}

// ============================================================================
// Prompt / parsing helpers
// ============================================================================

function buildJudgePrompt(candidate: ProactiveSuggestion): string {
  const store = getSuggestionStore();
  const policy = getCategoryPolicy();
  const recent = store.getRecent(5, { category: candidate.category });
  const stats = store.getCategoryStats(candidate.category, 60 * 60 * 1000);
  const policyState = policy.get(candidate.category);

  const input = {
    candidate: {
      category: candidate.category,
      title: candidate.title,
      body: candidate.body.slice(0, 300),
      action: candidate.action,
      heuristicConfidence: Number(candidate.confidence.toFixed(3)),
      triggers: candidate.triggers,
    },
    recentSimilar: recent.map((s) => ({
      title: s.title.slice(0, 80),
      status: s.status,
      ageMinutes: Math.round((Date.now() - new Date(s.createdAt).getTime()) / 60_000),
    })),
    categoryStatsLastHour: {
      fired: stats.fired,
      accepted: stats.accepted,
      dismissed: stats.dismissed,
      acceptanceRate: Number(stats.acceptanceRate.toFixed(2)),
    },
    categoryPolicy: {
      cooldownMinutes: Math.round(policyState.cooldownMs / 60_000),
      minConfidence: policyState.minConfidence,
      maxPerHour: policyState.maxPerHour,
    },
  };

  return JSON.stringify(input, null, 2);
}

function parseJudgeResponse(text: string): {
  shouldFire: boolean;
  confidence: number;
  reasoning: string;
} | null {
  // Extract first { ... } block — models sometimes wrap in fences or add prose
  const match = text.match(/\{[\s\S]*?\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    const shouldFire = parsed.shouldFire === true;
    const confidence = Number(parsed.confidence);
    const reasoning = typeof parsed.reasoning === "string" ? parsed.reasoning : "";
    if (!Number.isFinite(confidence)) return null;
    if (!reasoning) return null;
    return { shouldFire, confidence, reasoning };
  } catch {
    return null;
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

// Re-export for convenience so callers can import from one place
export { setActiveJudge } from "./proposalJudge.ts";
