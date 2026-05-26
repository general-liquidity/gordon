/**
 * Extended-thinking wiring — adapter that maps Gordon's WorkflowPhase
 * to Anthropic-native `providerOptions` shaped for Mastra agent calls.
 *
 * Always on. Phase-keyed thinking depth:
 *   scan / ops / compaction → off (cheap, no thinking)
 *   analysis                → low
 *   planning / execution    → medium
 *   critique                → high
 *
 * Callers can override per-call via `overrideDepth`. Returns `{}` only
 * when the phase resolves to "off" — safe to splat into agent.generate
 * options unconditionally.
 *
 * Pairs with the existing `extendedThinking.ts` helper.
 */

import { providerOptionsForDepth } from "../cognition/extendedThinking.ts";
import type { WorkflowPhase } from "../cognition/workflowPhase.ts";
import type { ThinkingDepth } from "../cognition/thinkingPhase.ts";

export function providerOptionsForPhase(
  phase: WorkflowPhase,
  options: { maxTokens?: number; overrideDepth?: ThinkingDepth } = {},
): Record<string, unknown> {
  const depth = options.overrideDepth ?? phaseToDepth(phase);
  if (depth === "off") return {};
  return providerOptionsForDepth(depth, { maxTokens: options.maxTokens });
}

function phaseToDepth(phase: WorkflowPhase): ThinkingDepth {
  switch (phase) {
    case "scan":
    case "ops":
    case "compaction":
      return "off";
    case "analysis":
      return "low";
    case "planning":
    case "execution":
      return "medium";
    case "critique":
      return "high";
    default:
      return "off";
  }
}
