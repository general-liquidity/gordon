/**
 * Counterfactual Learning Loop
 *
 * Post-trade "what if" analysis that automatically runs when trades close,
 * detects recurring patterns, and feeds insights into strategy evolution.
 */

export { CounterfactualAnalyzer } from "./counterfactual-analyzer.ts";
export type {
  CounterfactualReport,
  CounterfactualInsight,
} from "./counterfactual-analyzer.ts";

export { FeedbackLoop } from "./feedback-loop.ts";

export {
  saveReport,
  getReport,
  getRecurringInsights,
  getInsightsForSymbol,
  getAnalysisSummary,
} from "./insight-store.ts";

export { scoreDeclinedDecision, aggregateInactionValue } from "./inaction-value.ts";
export type {
  DeclinedDecision,
  DecisionSide,
  WouldHaveOutcome,
  InactionOutcome,
  InactionValueReport,
} from "./inaction-value.ts";
