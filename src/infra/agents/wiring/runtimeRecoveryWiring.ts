/**
 * Runtime-recovery wiring — integrates the typed RecoveryAction tiers
 * (Notify / Redirect / ForceStop) with whatever doom-loop detector
 * the harness uses.
 *
 * Activation: `GORDON_RECOVERY_TIERS` env flag. When off, callers
 * see `null` from `tryRecover()` and fall through to whatever
 * behavior existed before — no tier escalation, no inserted reminder,
 * no forced halt. This keeps the wiring cold-shippable.
 *
 * The wiring keeps its own RecoveryState per-fingerprint so tier
 * counters survive across calls. State is process-local and reset on
 * test boundaries via `_resetRecoveryStateForTests`.
 */

import {
  decideRecovery,
  newRecoveryState,
  type RecoveryDecision,
  type RecoveryState,
} from "../runtimeRecovery.ts";

const FLAG_ENV = "GORDON_RECOVERY_TIERS";

// Per-fingerprint state map. Cleared per process; not persisted.
const stateByFingerprint: Map<string, RecoveryState> = new Map();

export function isRecoveryTiersEnabled(): boolean {
  return process.env[FLAG_ENV] === "1";
}

export interface RecoveryInputForWiring {
  fingerprint: string;
  toolName: string;
  details?: string;
}

/**
 * Called when the existing doom-loop detector reports a hit.
 * Returns the recovery decision when flag is on, otherwise null.
 * Caller threads the decision into its handling — e.g., inject the
 * `reminder` text into the next prompt on Redirect; halt agent on
 * ForceStop.
 */
export function tryRecover(input: RecoveryInputForWiring): RecoveryDecision | null {
  if (!isRecoveryTiersEnabled()) return null;
  const prior = stateByFingerprint.get(input.fingerprint) ?? newRecoveryState();
  const decision = decideRecovery({
    state: prior,
    fingerprint: input.fingerprint,
    toolName: input.toolName,
    ...(input.details !== undefined ? { details: input.details } : {}),
  });
  stateByFingerprint.set(input.fingerprint, decision.state);
  return decision;
}

/** Drop tracked state for a fingerprint — call after a non-loop turn resolves. */
export function resetFingerprintRecoveryState(fingerprint: string): void {
  stateByFingerprint.delete(fingerprint);
}

/** Test helper. */
export function _resetRecoveryStateForTests(): void {
  stateByFingerprint.clear();
}
