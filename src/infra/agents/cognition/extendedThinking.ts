/**
 * Extended Thinking Budget Helper
 *
 * Anthropic's Claude 4.x models support in-band "extended thinking" — the
 * model emits a separate `thinking` content block before its visible
 * answer, with a configurable token budget. This is structurally
 * different from Gordon's existing `thinkingPhase.ts` (a separate
 * tool-free LLM call): extended thinking runs in the *same* round-trip
 * as the action call, sharing context and skipping the network hop.
 *
 * Use the two together rather than one or the other:
 *   - thinkingPhase  : tool-free deliberation when the user message
 *                      itself needs framing (>200 chars or planning phase)
 *   - extendedThinking: in-band "scratchpad" for the action call,
 *                      letting the model reason through tool selection
 *                      before acting
 *
 * This module produces the provider-options payload for Anthropic
 * through Mastra. It does NOT auto-wire into agent calls — callers
 * pick when to enable extended thinking, since it materially changes
 * latency and token cost.
 */

import type { ThinkingDepth } from "./thinkingPhase.ts";

// ============================================================================
// Budget tiers
// ============================================================================

/**
 * Token budgets per depth level. Values picked to land at meaningful
 * cost/latency steps:
 *   - low     :  2,048 ≈ a paragraph of reasoning, ~1s extra latency
 *   - medium  :  8,192 ≈ multi-step plan with branches, ~3s extra
 *   - high    : 24,576 ≈ deep analytical pass, ~8s extra
 *   - max     : 65,536 ≈ Anthropic's published max for Sonnet/Opus 4.x
 *
 * Anthropic requires `budget_tokens >= 1024` and `< max_tokens` of the
 * outer request; the helper enforces this when an outer `maxTokens` is
 * supplied.
 */
export const EXTENDED_THINKING_BUDGETS: Record<Exclude<ThinkingDepth, "off">, number> = {
  low: 2_048,
  medium: 8_192,
  high: 24_576,
};

/** Hard upper bound — Anthropic-published cap for current Claude 4 models. */
export const MAX_THINKING_BUDGET = 65_536;
/** Anthropic-required minimum. */
export const MIN_THINKING_BUDGET = 1_024;

// ============================================================================
// Config types
// ============================================================================

export interface ExtendedThinkingConfig {
  /** Pass-through for Anthropic's `thinking` request field. */
  type: "enabled" | "disabled";
  /** Budget in tokens. Only meaningful when type === "enabled". */
  budgetTokens: number;
}

export interface BuildOptions {
  /** Outer-request maxTokens cap. budgetTokens will be clamped below this. */
  maxTokens?: number;
  /** Override the depth-derived budget with an explicit value. */
  budgetOverride?: number;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Build an extended-thinking config block from a depth level. Returns
 * `{ type: "disabled", budgetTokens: 0 }` for depth=off so the caller
 * can splat the result into provider options unconditionally.
 *
 * The budget is clamped to:
 *   - >= MIN_THINKING_BUDGET (Anthropic requirement)
 *   - <= MAX_THINKING_BUDGET (model cap)
 *   - <= maxTokens - 1 (Anthropic requires budget < outer maxTokens)
 */
export function buildExtendedThinkingConfig(
  depth: ThinkingDepth,
  options: BuildOptions = {},
): ExtendedThinkingConfig {
  if (depth === "off") return { type: "disabled", budgetTokens: 0 };

  const requested = options.budgetOverride ?? EXTENDED_THINKING_BUDGETS[depth];
  let budget = Math.max(MIN_THINKING_BUDGET, Math.min(MAX_THINKING_BUDGET, requested));

  if (typeof options.maxTokens === "number" && options.maxTokens > 0) {
    // Anthropic requires budget_tokens < max_tokens of the outer request.
    budget = Math.min(budget, options.maxTokens - 1);
    if (budget < MIN_THINKING_BUDGET) {
      // Outer request is too small for any meaningful thinking — disable.
      return { type: "disabled", budgetTokens: 0 };
    }
  }

  return { type: "enabled", budgetTokens: budget };
}

/**
 * Convert the helper's config into the shape Mastra's `providerOptions`
 * expects when routing through Anthropic. The Anthropic provider key
 * is `anthropic`; the body matches the SDK's `thinking` request field.
 *
 * Usage:
 *   const cfg = buildExtendedThinkingConfig("high", { maxTokens: 4096 });
 *   await agent.generate(messages, {
 *     providerOptions: toMastraProviderOptions(cfg),
 *   });
 */
export function toMastraProviderOptions(
  config: ExtendedThinkingConfig,
): { anthropic: { thinking: { type: "enabled"; budgetTokens: number } } } | Record<string, never> {
  if (config.type === "disabled") return {};
  return {
    anthropic: {
      thinking: { type: "enabled", budgetTokens: config.budgetTokens },
    },
  };
}

/**
 * Convenience: build the provider-options block in one call for a given
 * depth + outer maxTokens. Returns an empty object when thinking is
 * disabled, so callers can spread it into their existing options:
 *
 *   ...providerOptionsForDepth("medium", { maxTokens: 8192 })
 */
export function providerOptionsForDepth(
  depth: ThinkingDepth,
  options: BuildOptions = {},
): { anthropic: { thinking: { type: "enabled"; budgetTokens: number } } } | Record<string, never> {
  return toMastraProviderOptions(buildExtendedThinkingConfig(depth, options));
}
