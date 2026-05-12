/**
 * Safety Module — Trading Constitution + Prompt Injection Defense
 *   + Anti-trap defenses (explain-first, supervision-rust, risk-ack, local-fallback)
 *
 * Two layers of protection that CANNOT be overridden:
 *   1. Trading Constitution: immutable risk limits from professional trading wisdom
 *   2. Injection Defense: pattern-matching against malicious prompt manipulation
 *
 * Plus four feature-flagged supervision-preservation primitives that map
 * Faye's "agentic coding is a trap" critique onto vibe trading:
 *   - GORDON_EXPLAIN_FIRST: user writes thesis before seeing Gordon's
 *   - GORDON_SUPERVISION_RUST_RATE: periodic flawed-plan calibration check
 *   - GORDON_RISK_ACK: medium+ tier plans require explicit risk acknowledgement
 *   - GORDON_LOCAL_FALLBACK: read-only tools return raw data when provider down
 */

// Trading Constitution
export {
  TRADING_CONSTITUTION,
  checkConstitution,
  passesConstitution,
  formatViolations,
} from "./defense/tradingConstitution.ts";
export type { ConstitutionViolation } from "./defense/tradingConstitution.ts";

// Prompt Injection Defense
export {
  checkForInjection,
  shouldBlockInput,
} from "./defense/injectionDefense.ts";
export type {
  InjectionCheckResult,
  InjectionMatch,
  InjectionCategory,
} from "./defense/injectionDefense.ts";

// Explain-before-execute mode
export {
  isExplainFirstEnabled,
  recordUserThesis,
  getUserThesis,
  clearUserThesis,
  requiresUserThesis,
  computeThesisDivergence,
} from "./anti-trap/explainFirstMode.ts";
export type { UserThesis, ThesisRequirement } from "./anti-trap/explainFirstMode.ts";

// Supervision-rust calibration check
export {
  SUPERVISION_FLAWS,
  defaultSupervisionLogPath,
  getInjectionRate,
  shouldInjectFlaw,
  pickFlaw,
  injectFlaw,
  newSupervisionRecord,
  recordSupervisionResult,
  readSupervisionScore,
} from "./anti-trap/supervisionRust.ts";
export type {
  FlawType,
  SupervisionFlaw,
  SupervisionRecord,
  SupervisionScore,
} from "./anti-trap/supervisionRust.ts";

// Risk-acknowledgement gate
export {
  isRiskAckEnabled,
  topWeightedDimensions,
  verifyRiskAcknowledgement,
  verifyAcksFromWarnings,
} from "./anti-trap/riskAcknowledgement.ts";
export type { AcknowledgementResult } from "./anti-trap/riskAcknowledgement.ts";

// Local-fallback for read-only tools
export {
  isLocalFallbackEnabled,
  checkProviderHealth,
  withReadOnlyFallback,
} from "./anti-trap/localFallback.ts";
export type { ProviderHealth, FallbackEnvelope } from "./anti-trap/localFallback.ts";

// Asset-class inference helper (shared by anti-rot gates)
export { inferAssetClassFromVenue } from "./assetClassInference.ts";
export type { InferredAssetClass } from "./assetClassInference.ts";

// Trading universe scope sentinel
export {
  EMPTY_UNIVERSE,
  isUniverseEnabled,
  defaultUniversePath,
  loadUniverse,
  saveUniverse,
  checkUniverse,
} from "./anti-rot/tradingUniverse.ts";
export type {
  TradingUniverse,
  UniverseCheckInput,
  UniverseCheckResult,
} from "./anti-rot/tradingUniverse.ts";

// Portfolio coherence vs. running thesis
export {
  isCoherenceEnabled,
  getCoherenceThreshold,
  defaultThesisPath,
  loadRunningThesis,
  saveRunningThesis,
  clearRunningThesis,
  scoreCoherence,
  gateCoherence,
} from "./anti-rot/thesisCoherence.ts";
export type {
  ThesisBias,
  ThesisHorizon,
  RunningThesis,
  PlanShape as ThesisPlanShape,
  CoherenceScore,
  CoherenceGateResult,
} from "./anti-rot/thesisCoherence.ts";

// Per-strategy mandate decomposition
export {
  isStrategyMandatesEnabled,
  defaultMandatesPath,
  loadMandates,
  saveMandates,
  selectMandateForPlan,
  gateAgainstMandate,
} from "./anti-rot/strategyMandates.ts";

// Trader behavior pattern detector (cross-session pattern surfacing)
export {
  isTraderBehaviorEnabled,
  detectTraderBehaviorPatterns,
} from "./anti-rot/traderBehaviorPatterns.ts";
export type {
  BehaviorPatternKind,
  BehaviorPattern,
  TraderBehaviorReport,
} from "./anti-rot/traderBehaviorPatterns.ts";
export type {
  StrategyMandate,
  MandateMatchInput,
  MandateBudgetState,
  MandateGateInput,
  MandateGateResult,
} from "./anti-rot/strategyMandates.ts";
