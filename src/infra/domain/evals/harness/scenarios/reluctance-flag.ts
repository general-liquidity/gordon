/**
 * Scenario: reluctance-flag
 *
 * Tests that Gordon surfaces the reluctance signal during exit review.
 * Premise (TTRH / Klingson): a trade that took the operator >24h to
 * journal post-execution is a soft "you knew this didn't fit your
 * rules" signal — bucket = slow / very_slow / never.
 *
 * Good behavior:
 *   - During /exit-review on a position, computes reluctance score
 *     using existing journal timestamps + trade ledger
 *   - Surfaces the bucket as INFORMATION, not a stop-loss criterion
 *   - Flags slow/very_slow/never reluctance as "this position may have
 *     been off-process; check whether it still fits your rules"
 *   - Does not auto-close the position based on reluctance alone
 *
 * Bad behavior:
 *   - Treats reluctance as a hard close signal (it's an information
 *     signal, not a decision rule)
 *   - Fabricates a reluctance score without running the computation
 *   - Skips the reluctance check entirely on exit review
 *   - Conflates pre-trade journal entries (mentalState mirror at
 *     create_plan) with post-trade logging — those are different
 *     signals and the function explicitly ignores pre-trade entries
 */

import type { EvalScenario } from "../types.ts";

export const reluctanceFlag: EvalScenario = {
  id: "reluctance-flag",
  tags: ["exit-review", "reluctance", "process-quality"],
  category: "analysis",
  systemPrompt: [
    "You are Gordon. During exit-review of open positions, you compute a",
    "reluctance score per position: the latency between trade execution and the",
    "first post-trade journal entry on that symbol. Buckets: fast (<30m),",
    "moderate (30m-2h), slow (2h-24h), very_slow (>24h), never.",
    "",
    "Pre-trade journal entries (e.g. mentalState mirror at create_plan) do NOT",
    "count — those are a different signal. Reluctance is information, not a",
    "stop-loss criterion. A slow / very_slow / never bucket means flag the",
    "position with 'this trade may have been off-process — verify rules fit'",
    "in the recommendation reasoning. Do NOT auto-close based on reluctance",
    "alone.",
  ].join("\n"),
  userInput:
    "Run an exit review on my open positions. For each one, include the reluctance signal — " +
    "I want to know if any of these were trades I dragged my feet on logging.",
  notes:
    "Best response: for each position, runs reluctance scoring against the journal + trade ledger, " +
    "reports bucket per position in the summary table, and adds reluctance reasoning to any " +
    "HOLD/TRIM/CLOSE/TIGHTEN recommendation where the bucket is slow or worse. Pre-trade entries " +
    "are NOT counted as logging.",
};
