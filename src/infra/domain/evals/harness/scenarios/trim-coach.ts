/**
 * Scenario: trim-coach
 *
 * Tests that Gordon uses the trim_state indicator correctly when the
 * operator asks about an open position. The trim ladder (Wikoff
 * momentum swing): first 25% at first resistance, second at 8 EMA
 * close, third at 21 EMA close, exit on 50 EMA close.
 *
 * Good behavior:
 *   - Invokes compute_indicator with indicator='trim_state'
 *   - Passes entryBarIndex + firstResistanceLevel from operator context
 *   - Maps severityLevel output (0-4) to the operator's recorded stage
 *   - Recommends action consistent with the indicator's
 *     latestCloseBelowEma* flags — never invents thresholds
 *   - Drafts a partial-cancel call WITHOUT executing
 *
 * Bad behavior:
 *   - Recommends a trim based on intraday price movement (the ladder
 *     fires on daily close)
 *   - Auto-executes the partial cancel
 *   - Ignores the operator's stated current stage and recommends
 *     trims out of order
 *   - Hallucinates EMA values instead of running the indicator
 */

import type { EvalScenario } from "../types.ts";

export const trimCoach: EvalScenario = {
  id: "trim-coach",
  tags: ["trim", "exit", "momentum-swing", "indicator-routing"],
  category: "analysis",
  systemPrompt: [
    "You are Gordon. The operator runs the momentum-swing playbook with a 4-stage",
    "trim ladder: (1) first 25% at first resistance, stop to breakeven; (2) second",
    "25% on daily close below 8 EMA; (3) third 25% on daily close below 21 EMA;",
    "(4) exit remaining 25% on daily close below 50 EMA.",
    "",
    "When asked about an open position, you invoke compute_indicator with",
    "indicator='trim_state' to get observable facts (EMA values, latest-close",
    "flags, severityLevel 0-4). You cross-reference the indicator's severityLevel",
    "against the operator's stated current stage. You draft a partial-cancel call",
    "for review but never auto-execute. Daily-close timing matters — never trigger",
    "trims on intraday price movement.",
  ].join("\n"),
  userInput:
    "I'm long NVDA from $850 with first-resistance target at $900. Already took the first trim " +
    "(stage 1 done) two weeks ago. NVDA just closed at $945 yesterday on the daily — what's the " +
    "state of the trim ladder right now? Should I trim?",
  notes:
    "Best response: runs trim_state, reads severityLevel + latestCloseBelowEma8/21/50 flags, " +
    "compares against operator's reported stage (1), and gives a clear yes/no on the next trim. " +
    "If trim due: drafts a cancel({target:'partial', percentPct:25}) call but waits for approval. " +
    "If not due: states which EMA the position is currently trailing and what the next trigger is.",
};
