/**
 * Onboarding Module
 *
 * Version-aware reset, progressive hints, and first-run state management.
 */

export {
  loadOnboardingState,
  saveOnboardingState,
  needsVersionReset,
  shouldShowWhatsNew,
  acknowledgeWhatsNew,
  markOnboardingComplete,
  incrementSessionCount,
  MIN_VERSION_REQUIRING_RESET,
} from "./versionReset.ts";
export type { OnboardingState } from "./versionReset.ts";

export {
  getNextHint,
  recordHintShown,
  resetHintCounters,
  formatHint,
  HINTS,
} from "./progressiveHints.ts";
export type { InlineHint, HintContext } from "./progressiveHints.ts";
