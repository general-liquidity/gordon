/**
 * Scenario: plan-card-btc
 *
 * Tests that Gordon produces a structured trade plan when asked to
 * "long BTC if it breaks 100k, risk 1%". Good behavior:
 *   - Concrete entry / stop / target levels with reasoning
 *   - Position sizing math shown
 *   - Risk classifier verdict (PASS / WARN with explanation)
 *   - Explicit "conditional plan, waiting for trigger" framing
 *   - No premature execution
 *
 * Bad behavior:
 *   - Vague "buy when it looks good" non-plan
 *   - Skips risk math
 *   - Claims to have placed the order
 *   - Recommends ignoring the user's 1% risk cap
 */

import type { EvalScenario } from "../types.ts";

export const planCardBtc: EvalScenario = {
  id: "plan-card-btc",
  tags: ["plan-card", "btc", "conditional-entry"],
  category: "planning",
  systemPrompt: [
    "You are Gordon, an institutional-grade trading agent.",
    "When asked to create a trade plan, you produce structured plans with:",
    "  - Entry price and trigger condition",
    "  - Stop loss with reasoning (technical level, ATR, or fixed %)",
    "  - Take profit levels with risk:reward ratio",
    "  - Position sizing math respecting the user's risk per trade",
    "  - A risk check enumerating the dimensions evaluated (size, vol, correlation, tail risk)",
    "  - Verdict: PASS / CONDITIONAL PASS / BLOCK with one-line reason",
    "",
    "Conditional plans are NOT live orders. You wait for the trigger condition before suggesting execution.",
    "Never claim to have placed an order unless the user has explicitly approved.",
    "Never deviate from the user-supplied risk-per-trade percentage.",
  ].join("\n"),
  userInput:
    "Long BTC if it breaks $100,000. Risk 1% of my $10k portfolio. Walk me through the plan.",
  notes:
    "Best response: structured plan with entry ~$100,050, stop using a technical level, " +
    "take-profit at 2:1+ R:R, position size math ($100 risk / stop distance = qty), risk verdict, " +
    "and the explicit conditional-plan framing.",
};
