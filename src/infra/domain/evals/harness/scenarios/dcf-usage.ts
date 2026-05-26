/**
 * Scenario: dcf-usage
 *
 * Tests that Gordon uses compute_microstructure({operation:'dcf'}) when
 * the operator asks for an intrinsic-value read on an equity. The
 * primitive is operator-input-driven — Gordon does NOT forecast FCF
 * itself; it asks for projections.
 *
 * Good behavior:
 *   - Recognizes "intrinsic value" / "is it cheap" / "DCF" / "fair value"
 *     as a valuation question
 *   - Asks for FCF projections if operator hasn't supplied them
 *   - Invokes compute_microstructure with the 'dcf' operation
 *   - Returns base/bear/bull case prices with their WACC + growth
 *     assumptions cited verbatim
 *   - Flags high terminalFraction (>70%) as model sensitivity warning
 *
 * Bad behavior:
 *   - Hallucinates FCF projections without asking the operator
 *   - Returns a point estimate without sensitivity context
 *   - Skips the wacc > terminalGrowth check (the tool will throw, but
 *     a good agent surfaces the constraint upfront)
 *   - Treats DCF output as "the stock is worth X" rather than "given
 *     these projections, the model says X"
 */

import type { EvalScenario } from "../types.ts";

export const dcfUsage: EvalScenario = {
  id: "dcf-usage",
  tags: ["dcf", "valuation", "fundamentals", "tool-routing"],
  category: "analysis",
  systemPrompt: [
    "You are Gordon. For equity valuation questions, you use",
    "compute_microstructure with operation='dcf'. The DCF primitive is",
    "operator-input-driven — you do NOT forecast free cash flows. If the",
    "operator hasn't supplied projections, you ask. You also enforce",
    "wacc > terminalGrowthPct upfront (the tool throws otherwise) and you",
    "surface the terminalFraction as a sensitivity warning when it exceeds",
    "70% (the model becomes brittle to terminal assumptions).",
    "",
    "DCF output is conditional on inputs. You report it as 'given these",
    "projections and WACC, the base case implies $X per share' — not 'the",
    "stock is worth $X'.",
  ].join("\n"),
  userInput:
    "I'm looking at AAPL. Run a DCF — base case 9% WACC, 2.5% terminal growth. " +
    "FCFs over the next 5 years: $110B, $118B, $126B, $135B, $145B. Net cash $50B, " +
    "16B shares diluted. Also give me a bear (11% WACC, 1.5% growth) and bull " +
    "(7.5% WACC, 3% growth) case.",
  notes:
    "Best response: invokes compute_microstructure({operation:'dcf', params:{...}}) with the " +
    "exact inputs the operator provided, returns base/bear/bull prices with assumptions, flags " +
    "the terminal-fraction sensitivity, frames output as conditional on inputs.",
};
