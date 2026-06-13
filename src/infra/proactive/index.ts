/**
 * Proactive Mode — public surface
 *
 * Barrel export for the proactive subsystem. Tool code imports from here
 * so subsystem internals can move without rippling.
 */

export * from "./types.ts";
export { getSuggestionStore, SuggestionStore } from "./storage/suggestionStore.ts";
export { getCategoryPolicy, CategoryPolicyManager } from "./judges/categoryPolicy.ts";
export { getOutcomeTracker, OutcomeTracker, autoRecordFromStore } from "./judges/outcomeEvals.ts";
export {
  getActiveJudge,
  setActiveJudge,
  judgeCandidate,
  HeuristicJudge,
  type ProposalJudge,
  type JudgeVerdict,
} from "./judges/proposalJudge.ts";
export {
  getProactiveEngine,
  ProactiveEngine,
  buildCandidate,
  type ProactiveObservation,
  type CandidateProducer,
} from "./engine/proactiveEngine.ts";
export {
  DeliveryPolicy,
  BATCH_THRESHOLD,
  defaultSeverityForCategory,
  effectiveSeverity,
  buildDedupeKey,
  buildSummaryRollup,
  type DeliveryDecision,
} from "./engine/deliveryPolicy.ts";
export { LlmJudge } from "./judges/llmJudge.ts";
