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
