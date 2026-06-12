/**
 * Version-Aware Onboarding Reset
 *
 * Re-triggers onboarding highlights on major version bumps. Not the full
 * wizard — just a "what's new" step showing features added since the user
 * last completed onboarding.
 *
 * Claude Code pattern: `lastOnboardingVersion` + `MIN_VERSION_REQUIRING_RESET`
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getGordonDir } from "../../../infra/storage/paths.ts";

function getOnboardingStateFile(): string {
  return join(getGordonDir(), "onboarding-state.json");
}

/**
 * Minimum version that requires re-showing onboarding highlights.
 * Bump this when a major feature is added that users should know about.
 */
export const MIN_VERSION_REQUIRING_RESET = "0.9.0";

export interface OnboardingState {
  /** Whether full onboarding has been completed at least once. */
  completedOnce: boolean;
  /** Version when onboarding was last completed/acknowledged. */
  lastOnboardingVersion: string | null;
  /** Number of sessions since onboarding completed. */
  sessionCount: number;
  /** Whether "what's new" was shown for the current version. */
  whatsNewAcknowledged: boolean;
  /** Whether the first-trade safety tour has been completed or skipped. */
  firstTradeTourDone: boolean;
  /** Inline hints: how many times each hint has been shown. */
  hintShowCounts: Record<string, number>;
}

const DEFAULT_STATE: OnboardingState = {
  completedOnce: false,
  lastOnboardingVersion: null,
  sessionCount: 0,
  whatsNewAcknowledged: false,
  firstTradeTourDone: false,
  hintShowCounts: {},
};

export function loadOnboardingState(): OnboardingState {
  const stateFile = getOnboardingStateFile();
  if (!existsSync(stateFile)) return { ...DEFAULT_STATE };
  try {
    return { ...DEFAULT_STATE, ...JSON.parse(readFileSync(stateFile, "utf-8")) };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export function saveOnboardingState(state: OnboardingState): void {
  const gordonDir = getGordonDir();
  if (!existsSync(gordonDir)) mkdirSync(gordonDir, { recursive: true });
  writeFileSync(getOnboardingStateFile(), JSON.stringify(state, null, 2), { encoding: "utf-8", mode: 0o600 });
}

/**
 * Check if onboarding needs to be re-triggered due to a version bump.
 */
export function needsVersionReset(currentVersion: string): boolean {
  const state = loadOnboardingState();
  if (!state.completedOnce) return false; // First-time users get the full wizard, not reset
  if (!state.lastOnboardingVersion) return true;
  return compareVersions(state.lastOnboardingVersion, MIN_VERSION_REQUIRING_RESET) < 0;
}

/**
 * Check if the "what's new" screen should be shown.
 */
export function shouldShowWhatsNew(currentVersion: string): boolean {
  const state = loadOnboardingState();
  if (!state.completedOnce) return false;
  if (state.whatsNewAcknowledged) return false;
  return needsVersionReset(currentVersion);
}

/**
 * Mark "what's new" as acknowledged for this version.
 */
export function acknowledgeWhatsNew(currentVersion: string): void {
  const state = loadOnboardingState();
  state.whatsNewAcknowledged = true;
  state.lastOnboardingVersion = currentVersion;
  saveOnboardingState(state);
}

/**
 * Mark full onboarding as completed.
 */
export function markOnboardingComplete(currentVersion: string): void {
  const state = loadOnboardingState();
  state.completedOnce = true;
  state.lastOnboardingVersion = currentVersion;
  state.whatsNewAcknowledged = true;
  saveOnboardingState(state);
}

/**
 * Increment session count (call on each app start).
 */
export function incrementSessionCount(): number {
  const state = loadOnboardingState();
  state.sessionCount++;
  saveOnboardingState(state);
  return state.sessionCount;
}

/**
 * Simple semver comparison. Returns -1, 0, or 1.
 */
function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va < vb) return -1;
    if (va > vb) return 1;
  }
  return 0;
}
