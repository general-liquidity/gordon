/**
 * Extended-thinking wiring — adapter that maps Gordon's WorkflowPhase
 * to Anthropic-native `providerOptions` shaped for Mastra agent calls.
 *
 * Activation:
 *   - `GORDON_EXTENDED_THINKING` env flag → "off" | "low" | "medium" | "high"
 *   - Caller can override per-call via the optional `depth` argument.
 *
 * Returns:
 *   - Empty object `{}` when disabled — safe to splat into agent.generate
 *     options unconditionally.
 *   - Anthropic-shaped `{ anthropic: { thinking: { ... } } }` otherwise.
 *
 * Pairs with the existing `extendedThinking.ts` helper. Callers that
 * want to use Anthropic native budget-tokens reach for
 * `providerOptionsForPhase()` rather than `providerOptionsForDepth()`
 * directly, so depth selection is workflow-aware.
 */

import { providerOptionsForDepth } from "../cognition/extendedThinking.ts";
import type { WorkflowPhase } from "../cognition/workflowPhase.ts";
import type { ThinkingDepth } from "../cognition/thinkingPhase.ts";

const FLAG_ENV = "GORDON_EXTENDED_THINKING";

/**
 * Maps a workflow phase to a sensible thinking depth, then to the
 * Anthropic provider-options block Mastra forwards to the API.
 *
 *   scan / ops / compaction → off (cheap, no thinking)
 *   analysis                → low
 *   planning / execution    → medium
 *   critique                → high
 *
 * Disabled entirely when GORDON_EXTENDED_THINKING is unset / set to "off".
 */
export function providerOptionsForPhase(
  phase: WorkflowPhase,
  options: { maxTokens?: number; overrideDepth?: ThinkingDepth } = {},
): Record<string, unknown> {
  const envValue = (process.env[FLAG_ENV] ?? "off").toLowerCase();
  if (envValue === "off" || envValue === "0" || envValue === "false") return {};

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

export function isExtendedThinkingEnabled(): boolean {
  const v = (process.env[FLAG_ENV] ?? "off").toLowerCase();
  return v !== "off" && v !== "0" && v !== "false";
}
