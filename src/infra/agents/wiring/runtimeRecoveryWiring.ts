/**
 * Runtime-recovery wiring — integrates the typed RecoveryAction tiers
 * (Notify / Redirect / ForceStop) with the doom-loop detector.
 *
 * Always on. Caller threads the returned decision into its handling —
 * inject the `reminder` text into the next prompt on Redirect; halt
 * agent on ForceStop. Per-fingerprint state is process-local and reset
 * on test boundaries via `_resetRecoveryStateForTests`.
 */

import {
  decideRecovery,
  newRecoveryState,
  type RecoveryDecision,
  type RecoveryState,
} from "../harness/runtimeRecovery.ts";

// Per-fingerprint state map. Cleared per process; not persisted.
const stateByFingerprint: Map<string, RecoveryState> = new Map();

export interface RecoveryInputForWiring {
  fingerprint: string;
  toolName: string;
  details?: string;
}

/**
 * Called when the doom-loop detector reports a hit. Returns the recovery
 * decision the caller should apply (Notify / Redirect / ForceStop).
 */
export function tryRecover(input: RecoveryInputForWiring): RecoveryDecision {
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
