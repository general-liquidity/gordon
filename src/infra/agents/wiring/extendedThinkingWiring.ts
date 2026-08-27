/**
 * Extended-thinking wiring — adapter that maps Gordon's WorkflowPhase
 * to Anthropic-native `providerOptions` shaped for Mastra agent calls.
 *
 * Always on. Depth resolves through the same order as the tool-free
 * cognition pass: per-call override → config.thinkingDepth →
 * GORDON_THINKING_DEPTH → workflow phase default.
 *
 * Callers can override per-call via `overrideDepth`. Returns `{}` only
 * when the phase resolves to "off" — safe to splat into agent.generate
 * options unconditionally.
 *
 * Pairs with the existing `extendedThinking.ts` helper.
 */

import { providerOptionsForDepth } from "../cognition/extendedThinking.ts";
import type { WorkflowPhase } from "../cognition/workflowPhase.ts";
import { resolveThinkingDepth, type ThinkingDepth } from "../cognition/thinkingPhase.ts";
import type { GordonContext } from "../types.ts";

export function providerOptionsForPhase(
  phase: WorkflowPhase,
  options: { maxTokens?: number; overrideDepth?: ThinkingDepth; context?: GordonContext } = {},
): Record<string, unknown> {
  const { depth } = resolveThinkingDepth({
    context: options.context,
    phase,
    overrideDepth: options.overrideDepth,
  });
  if (depth === "off") return {};
  return providerOptionsForDepth(depth, { maxTokens: options.maxTokens });
}
