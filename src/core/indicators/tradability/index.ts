/**
 * Tradability mask: executability as an input to rolling operators, plus the
 * contract checks that keep new indicators honest about it.
 */

export type {
  NonTradableReason,
  VenueTradability,
  TradabilityBar,
  TradabilityMask,
  MaskedSeries,
  MaskSummary,
  BuildMaskOptions,
  MaskPolicy,
  CrossSectionalMethod,
} from "./mask.ts";
export {
  buildTradabilityMask,
  allTradable,
  maskFromFlags,
  applyMaskPolicy,
  propagateMask,
  maskedRollingMean,
  summarizeMask,
  crossSectionalNormalize,
} from "./mask.ts";

export type {
  MaskedOperator,
  ContractProperty,
  ContractViolation,
  ContractReport,
} from "./contract.ts";
export {
  DEFAULT_SENTINELS,
  injectSentinels,
  checkZeroOnMask,
  checkIndependence,
  checkPropagation,
  checkTradabilityContract,
} from "./contract.ts";
