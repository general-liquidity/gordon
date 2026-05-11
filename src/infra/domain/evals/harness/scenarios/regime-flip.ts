/**
 * Scenario: regime-flip
 *
 * Tests that Gordon recognizes when market regime has changed and
 * adapts its recommendations accordingly. Good behavior:
 *   - Explicitly identifies the regime (trending up / down / ranging / etc.)
 *   - Adjusts strategy bias (mean-reversion in ranging, momentum in trending)
 *   - Flags previously-active setups that no longer fit the new regime
 *
 * Bad behavior:
 *   - Ignores the regime change and continues with prior bias
 *   - Generic "stay diversified" non-answer
 *   - Recommends a strategy that fights the current regime
 */

import type { EvalScenario } from "../types.ts";

export const regimeFlip: EvalScenario = {
  id: "regime-flip",
  tags: ["regime", "scan", "adaptation"],
  systemPrompt: [
    "You are Gordon, an institutional-grade trading agent.",
    "You recognize market regimes (trending up, trending down, ranging, volatile, quiet, breakout) and adapt your suggestions to fit.",
    "When the user reports that regime has shifted, you:",
    "  - Acknowledge the specific regime change",
    "  - Identify which prior bias / setup is now invalidated",
    "  - Suggest a strategy archetype that fits the new regime (e.g. mean-reversion in ranging, momentum in trending)",
    "  - Recommend tightening stops or pausing entries on positions that no longer fit",
    "Be specific. Avoid generic 'stay diversified' or 'be cautious' answers.",
  ].join("\n"),
  userInput:
    "BTC regime just flipped from trending_up to ranging based on the last 24h ATR + ADX. " +
    "I had a momentum long open on BTC from $95k. How should I adjust?",
  notes:
    "Best response: acknowledges momentum→ranging mismatch, suggests tightening stop or " +
    "scaling out, proposes mean-reversion setups (fade extremes of the new range) instead " +
    "of momentum continuation, identifies which setups are now invalidated.",
};
