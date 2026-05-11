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
} from "./tradingConstitution.ts";
export type { ConstitutionViolation } from "./tradingConstitution.ts";

// Prompt Injection Defense
export {
  checkForInjection,
  shouldBlockInput,
} from "./injectionDefense.ts";
export type {
  InjectionCheckResult,
  InjectionMatch,
  InjectionCategory,
} from "./injectionDefense.ts";

// Explain-before-execute mode
export {
  isExplainFirstEnabled,
  recordUserThesis,
  getUserThesis,
  clearUserThesis,
  requiresUserThesis,
  computeThesisDivergence,
} from "./explainFirstMode.ts";
export type { UserThesis, ThesisRequirement } from "./explainFirstMode.ts";

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
} from "./supervisionRust.ts";
export type {
  FlawType,
  SupervisionFlaw,
  SupervisionRecord,
  SupervisionScore,
} from "./supervisionRust.ts";

// Risk-acknowledgement gate
export {
  isRiskAckEnabled,
  topWeightedDimensions,
  verifyRiskAcknowledgement,
  verifyAcksFromWarnings,
} from "./riskAcknowledgement.ts";
export type { AcknowledgementResult } from "./riskAcknowledgement.ts";

// Local-fallback for read-only tools
export {
  isLocalFallbackEnabled,
  checkProviderHealth,
  withReadOnlyFallback,
} from "./localFallback.ts";
export type { ProviderHealth, FallbackEnvelope } from "./localFallback.ts";
