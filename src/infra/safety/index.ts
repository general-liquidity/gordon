/**
 * Safety Module — Trading Constitution + Prompt Injection Defense
 *
 * Two layers of protection that CANNOT be overridden:
 *   1. Trading Constitution: immutable risk limits from professional trading wisdom
 *   2. Injection Defense: pattern-matching against malicious prompt manipulation
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
export type { InjectionCheckResult, InjectionMatch, InjectionCategory } from "./injectionDefense.ts";
