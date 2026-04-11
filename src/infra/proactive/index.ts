/**
 * Proactive Mode — public surface
 *
 * Barrel export for the proactive subsystem. Tool code imports from here
 * so subsystem internals can move without rippling.
 */

export * from "./types.ts";
export { getSuggestionStore, SuggestionStore } from "./suggestionStore.ts";
export { getCategoryPolicy, CategoryPolicyManager } from "./categoryPolicy.ts";
export { getOutcomeTracker, OutcomeTracker, autoRecordFromStore } from "./outcomeEvals.ts";
export {
  getActiveJudge,
  setActiveJudge,
  judgeCandidate,
  HeuristicJudge,
  type ProposalJudge,
  type JudgeVerdict,
} from "./proposalJudge.ts";
export {
  getProactiveEngine,
  ProactiveEngine,
  buildCandidate,
  type ProactiveObservation,
  type CandidateProducer,
} from "./proactiveEngine.ts";
