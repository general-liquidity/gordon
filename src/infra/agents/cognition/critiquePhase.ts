/**
 * Critique Phase — Reflexion-style self-evaluation chained after thinking
 *
 * Only runs when thinkingDepth === "high". Reviews the thinking trace for
 * logical gaps, faulty assumptions, and missed risks. Returns a one-sentence
 * actionable critique or an empty string if reasoning is sound.
 *
 * Based on OPENDEV paper §2.2.6: Extended ReAct pipeline with critique phase.
 */

import type { GordonContext } from "../types.ts";
import { resolveLegacyModelRouteForWorkflowPhase } from "./workflowPhase.ts";
import { createModuleLogger } from "../../logger/index.ts";
import {
  isPlanRubricEnabled,
  emptyRubric,
  type PlanRubric,
  type RubricScore,
} from "../../safety/planRubric.ts";

const logger = createModuleLogger("critique-phase");

const CRITIQUE_SYSTEM_PROMPT = `You are a reasoning critic for Gordon, an AI trading assistant. Review this thinking trace for: logical gaps, faulty assumptions, missed risks, or wrong tool/agent choices. Output one sentence of actionable critique under 50 words. If reasoning is sound, say "Reasoning is sound." Do not re-explain the task. Be direct.`;

/**
 * Run the critique phase on a completed thinking trace.
 * Only meaningful when thinkingDepth === "high" — callers should guard this.
 *
 * @param thinkingTrace - Output from the thinking phase
 * @param userMessage   - Original user request (for context)
 * @param context       - Gordon context (provides llm client + config)
 * @returns Critique string, or "" if trace was empty or critique failed
 */
export async function runCritiquePhase(
  thinkingTrace: string,
  userMessage: string,
  context: GordonContext,
): Promise<string> {
  if (!thinkingTrace.trim()) {
    return "";
  }

  try {
    // Use the main model for critique, not the fast one. Cognition's
    // "What's Actually Working" follow-up to "Don't Build Multi-Agents"
    // found that clean-context reviewers catch significantly more bugs
    // (~2/PR, 58% severe) when the reviewer is at least as capable as
    // the writer. Clean context alone isn't enough — capable + clean.
    // Critique only fires when thinkingDepth === "high" (explicit opt-in
    // for high-stakes work), so the cost increase is gated.
    const route = resolveLegacyModelRouteForWorkflowPhase("critique");

    const userContent = `Thinking trace:\n${thinkingTrace}\n\nUser request: ${userMessage.slice(0, 300)}`;

    const response = await context.llm.chatWithConfig(
      [
        { role: "system", content: CRITIQUE_SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      {
        provider: route.provider,
        model: route.model,
        temperature: 0.2,
        maxTokens: 100,
      },
    );

    const critique = response.content?.trim() ?? "";
    logger.debug("Critique phase complete", { critiqueLength: critique.length });
    return critique;
  } catch (error) {
    logger.warn("Critique phase failed, skipping", { error: (error as Error).message });
    return "";
  }
}

// ============================================================================
// Critique + plan rubric (GORDON_PLAN_RUBRIC=1)
// ============================================================================

const CRITIQUE_WITH_RUBRIC_PROMPT = `You are a plan evaluator for Gordon, an AI trading assistant. Review the thinking trace and score it on six dimensions, each 0/1/2:
- correctness: does the plan match the requested intent?
- verification: did pre-trade checks (risk classifier, mandate, universe) actually run with evidence?
- scopeDiscipline: did the plan stay inside the chosen mandate / sprint contract?
- reliability: does the plan tolerate restart or rerun without manual repair?
- maintainability: is the plan and its observations clear for the next session?
- handoffReadiness: can a fresh session continue from the plan and audit log alone?

Score each 0 (no), 1 (partial), or 2 (yes). Then output one sentence of actionable critique under 50 words. Reply ONLY as JSON in this exact shape:

{"correctness":N,"verification":N,"scopeDiscipline":N,"reliability":N,"maintainability":N,"handoffReadiness":N,"critique":"..."}`;

export interface CritiqueWithRubric {
  critique: string;
  rubric: PlanRubric;
}

/**
 * Run the critique phase AND score the thinking trace against the
 * 6-dimension plan rubric. Returns both. When the rubric flag is off
 * or the LLM response can't be parsed, returns an empty rubric (which
 * the rubricVerdict downstream will treat as `block` — the safe
 * default).
 *
 * This is additive over `runCritiquePhase` — existing callers don't
 * need to change. New callers wanting structured scoring use this.
 */
export async function runCritiqueWithRubric(
  thinkingTrace: string,
  userMessage: string,
  context: GordonContext,
): Promise<CritiqueWithRubric> {
  if (!isPlanRubricEnabled()) {
    // Fall back to plain critique with an empty rubric — caller can
    // still display the critique text, just without the structured
    // score.
    const critique = await runCritiquePhase(thinkingTrace, userMessage, context);
    return { critique, rubric: emptyRubric() };
  }

  if (!thinkingTrace.trim()) {
    return { critique: "", rubric: emptyRubric() };
  }

  try {
    const route = resolveLegacyModelRouteForWorkflowPhase("critique");
    const userContent = `Thinking trace:\n${thinkingTrace}\n\nUser request: ${userMessage.slice(0, 300)}`;
    const response = await context.llm.chatWithConfig(
      [
        { role: "system", content: CRITIQUE_WITH_RUBRIC_PROMPT },
        { role: "user", content: userContent },
      ],
      {
        provider: route.provider,
        model: route.model,
        temperature: 0.2,
        maxTokens: 250,
      },
    );

    const raw = response.content?.trim() ?? "";
    const parsed = parseCritiqueRubricJson(raw);
    if (!parsed) {
      logger.warn("Critique-with-rubric returned unparseable JSON, treating as empty", { sample: raw.slice(0, 120) });
      return { critique: raw, rubric: emptyRubric() };
    }
    return parsed;
  } catch (error) {
    logger.warn("Critique-with-rubric phase failed", { error: (error as Error).message });
    return { critique: "", rubric: emptyRubric() };
  }
}

function parseCritiqueRubricJson(text: string): CritiqueWithRubric | null {
  // Tolerate ```json fences around the body.
  const stripped = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  let body: unknown;
  try {
    body = JSON.parse(stripped);
  } catch {
    // Try to find the first {...} block.
    const match = stripped.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try { body = JSON.parse(match[0]); } catch { return null; }
  }
  if (!body || typeof body !== "object") return null;
  const obj = body as Record<string, unknown>;
  const dims: Array<keyof PlanRubric> = [
    "correctness", "verification", "scopeDiscipline",
    "reliability", "maintainability", "handoffReadiness",
  ];
  const rubric: Record<string, number> = {};
  for (const d of dims) {
    const v = obj[d];
    if (typeof v !== "number" || v < 0 || v > 2 || !Number.isInteger(v)) return null;
    rubric[d] = v;
  }
  const critique = typeof obj.critique === "string" ? obj.critique.trim() : "";
  return {
    critique,
    rubric: {
      correctness: rubric.correctness as RubricScore,
      verification: rubric.verification as RubricScore,
      scopeDiscipline: rubric.scopeDiscipline as RubricScore,
      reliability: rubric.reliability as RubricScore,
      maintainability: rubric.maintainability as RubricScore,
      handoffReadiness: rubric.handoffReadiness as RubricScore,
    },
  };
}
