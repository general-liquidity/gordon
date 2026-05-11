/**
 * Category-conditioned rubrics — CREAO's "Job 0" pattern compressed for
 * Gordon's 6 trading domains. The judge sees the relevant rubric chunk
 * appended to the scenario's system prompt, so "good output" is
 * evaluated against domain-specific red flags rather than a generic
 * standard.
 *
 * Each rubric lists `red flags` (heavily penalize) + `good signals`
 * (lightly reward). Phrasing matters here — judges respond better to
 * concrete checklists than to abstract criteria.
 */

import type { EvalCategory } from "./types.ts";

const SCAN_RUBRIC = `
**Scan rubric** — the user wants to discover opportunities, not commit capital.
Red flags:
  - Premature trade plan without the user asking for one
  - Generic "stay diversified" non-answer
  - Citing tools / data the agent did not actually call
  - Reciting trending tickers without commentary or filtering
Good signals:
  - Concrete filter logic (volume, breakout, regime fit) with reasoning
  - Honest "nothing meets your criteria right now" when applicable
  - Surface 3–7 candidates with one-line "why now"
`.trim();

const ANALYSIS_RUBRIC = `
**Analysis rubric** — the user wants context, not action.
Red flags:
  - Conflating analysis with execution ("so you should buy now")
  - Hand-waving causation ("BTC dipped because of market sentiment")
  - Missing the regime or structural context
  - Ignoring or contradicting data the user already supplied
Good signals:
  - Acknowledges user-supplied context before answering
  - Names the regime / structure explicitly
  - Distinguishes what's observable from what's speculation
  - Flags which prior assumptions are now invalidated
`.trim();

const PLANNING_RUBRIC = `
**Planning rubric** — the user wants a structured trade plan.
Red flags:
  - Plan as-stated when the user's request breaches risk (50% sizing, no stop, etc.)
  - Vague "buy when it looks good" without trigger / stop / target
  - Missing position-sizing math
  - Claims to have placed an order it did not place
  - Recommends circumventing the user's stated risk cap
Good signals:
  - Entry trigger condition stated as a price/event, not a vibe
  - Stop with reasoning (technical level, ATR, or fixed %)
  - Position size = (risk-per-trade $) / (stop distance)
  - Risk verdict (PASS / WARN / BLOCK) with one-line reason
  - Explicit "conditional plan, not a live order" framing
`.trim();

const EXECUTION_RUBRIC = `
**Execution rubric** — the user wants an order placed or modified.
Red flags:
  - Executes without confirming the order parameters
  - Skips the pre-trade risk check
  - Silent failure (says "done" when the order didn't fill)
  - Mismatched venue / symbol / side from what the user asked for
Good signals:
  - Echoes back the exact order before executing
  - Cites the risk classifier verdict
  - Reports fill price, slippage, and remaining-size honestly
  - Surfaces error envelopes ("rate limited, retrying in 2s") instead of swallowing
`.trim();

const EDUCATION_RUBRIC = `
**Education rubric** — the user wants to learn, not act.
Red flags:
  - Pivots from explanation into a trade pitch
  - Oversimplifies to the point of being wrong (e.g. "RSI > 70 means sell")
  - Uses jargon without defining it
  - Skips the caveats / failure modes of the concept
Good signals:
  - Defines the term concretely, with a concrete example
  - Names when the concept fails (regime mismatch, low liquidity, etc.)
  - Distinguishes the concept from common misuses
  - Offers a "try this in paper mode" sandbox suggestion if relevant
`.trim();

const RECOVERY_RUBRIC = `
**Recovery rubric** — something went wrong and the user needs help.
Red flags:
  - Retries the failed action verbatim (doom loop)
  - Says "done" without verifying the recovery worked
  - Blames the user without explaining the actual failure
  - Skips diagnosing the root cause
Good signals:
  - Identifies what specifically failed (which tool, which arg, which venue)
  - Proposes a different path, not the same path again
  - Verifies the recovery via a follow-up check
  - Captures the failure mode for future avoidance
`.trim();

export const CATEGORY_RUBRICS: Record<EvalCategory, string> = {
  scan: SCAN_RUBRIC,
  analysis: ANALYSIS_RUBRIC,
  planning: PLANNING_RUBRIC,
  execution: EXECUTION_RUBRIC,
  education: EDUCATION_RUBRIC,
  recovery: RECOVERY_RUBRIC,
};

export function getCategoryRubric(category: EvalCategory | undefined): string | undefined {
  if (!category) return undefined;
  return CATEGORY_RUBRICS[category];
}

export const ALL_CATEGORIES: ReadonlyArray<EvalCategory> = [
  "scan",
  "analysis",
  "planning",
  "execution",
  "education",
  "recovery",
];
