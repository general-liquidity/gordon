export { enhanceRankedResults, DEFAULT_ENHANCE_CONFIG } from "./enhance.ts";
export type { RankedEntry, EnhanceConfig } from "./enhance.ts";
export { hybridSearch, DEFAULT_HYBRID_CONFIG } from "./search.ts";
export type { MemoryEntry, MemorySearchResult, HybridSearchConfig } from "./search.ts";
export { mmrRerank, DEFAULT_MMR_CONFIG } from "./mmr.ts";
export type { MMRConfig, MMRCandidate } from "./mmr.ts";
export {
  applyTemporalDecay,
  decayMultiplier,
  toDecayLambda,
  DEFAULT_TEMPORAL_DECAY,
} from "./temporalDecay.ts";
export type { TemporalDecayConfig, DecayableItem } from "./temporalDecay.ts";

export {
  tuneRagConfig,
  makeRecallScorer,
  recallAtK,
  DEFAULT_KNOB_ORDER,
} from "./ragConfigTuner.ts";
export type {
  RagConfig,
  RagKnob,
  RagKnobSpace,
  RagScorer,
  LabeledQuery,
  RetrievalFn,
  RagTunerOptions,
  RagTrial,
  RagTunerStopReason,
  RagTunerResult,
} from "./ragConfigTuner.ts";
