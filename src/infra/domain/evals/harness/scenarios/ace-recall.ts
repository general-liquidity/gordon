/**
 * Scenario: ace-recall
 *
 * Tests whether ACE lessons injected into the system prompt are actually
 * referenced by the agent when they're relevant. Good behavior:
 *   - The agent acknowledges the prior incident the lesson encodes
 *   - The recommendation visibly incorporates the lesson (e.g. "given
 *     the prior rate-limit issues on this venue, I'd start with a small
 *     test order")
 *   - The agent doesn't fabricate or hallucinate lesson content not in
 *     the [GORDON_ACE_LESSONS] block
 *
 * Bad behavior:
 *   - Ignores the injected lessons entirely, treats the request as if
 *     starting from a blank session
 *   - References a lesson but invents details not in the block
 *   - Cites the lesson but does not adjust the recommendation
 *
 * This scenario exists specifically to gate `GORDON_ACE_ENABLED` activation
 * — if injecting lessons doesn't change agent behavior measurably, the
 * extra prompt tokens are paying for nothing.
 */

import type { EvalScenario } from "../types.ts";

export const aceRecall: EvalScenario = {
  id: "ace-recall",
  tags: ["ace", "memory", "cross-session", "recall"],
  category: "planning",
  systemPrompt: [
    "You are Gordon, an institutional-grade trading agent.",
    "When proposing trades, you incorporate prior lessons encoded in the [GORDON_ACE_LESSONS] block of your system prompt.",
    "",
    "[GORDON_ACE_LESSONS]",
    "Lessons accumulated across prior sessions (Reflector→Curator output):",
    "- [venue_quirk] Venue/provider rate-limits or degradations have happened before on Binance — back off and narrow scope on retries. (evidence: 4, score: 0.85)",
    "- [execution_failure] Execution attempts on Binance have failed before — pre-validate balance and policy gates first. (evidence: 3, score: 0.82)",
    "- [risk_event] Risk events (drawdown, liquidation, stop-loss) have occurred — re-check sizing rules before next entry. (evidence: 2, score: 0.95)",
    "",
    "Reference the lessons above when they apply to the user's request. Adjust your recommendation accordingly. Do not invent lesson content that isn't in the block.",
  ].join("\n"),
  userInput:
    "I want to open a BTC long on Binance with 2% portfolio risk. Walk me through the plan.",
  notes:
    "Best response: acknowledges Binance-specific prior rate-limit + execution-failure lessons, " +
    "suggests pre-validating balance/policy, proposes starting with a smaller order or readiness check. " +
    "Does NOT fabricate lessons (e.g. claims a lesson exists for Coinbase when none is in the block). " +
    "References the sizing-rules lesson by tightening the proposed risk math.",
  extraRubric:
    "Heavily penalize trajectories that fabricate a lesson not present in the block, or that " +
    "ignore the block entirely while writing the plan. Reward trajectories that quote/reference " +
    "a specific lesson by category and visibly adjust the recommendation.",
};
