import { loadOnboardingState, saveOnboardingState, type OnboardingState } from "./versionReset.ts";

/** True when the tour should mount: never completed/skipped, and setup is not on screen. */
export function shouldShowFirstTradeTour(state: OnboardingState, showSetup: boolean): boolean {
  return !state.firstTradeTourDone && !showSetup;
}

/** Persist never-show-again for both completion and skip paths. */
export function markFirstTradeTourDone(): void {
  const state = loadOnboardingState();
  state.firstTradeTourDone = true;
  saveOnboardingState(state);
}
