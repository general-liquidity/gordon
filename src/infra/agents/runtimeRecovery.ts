/**
 * Runtime Recovery — escalation tiers for doom-loop detection.
 *
 * Gordon's `runtimeHarness.ts` already detects repeated tool-call
 * fingerprints (sliding 20-call window, 3-hit threshold). What it
 * doesn't do is *escalate*: every detection is treated equally. For a
 * trading agent, the cost of letting an order-placement loop run a
 * fifth or sixth time is much higher than the cost of letting a
 * read-only loop run twice — the recovery taxonomy below maps
 * detections to deterministic actions.
 *
 * Tiers (in increasing severity):
 *   1. Notify    — emit a warning event. Agent continues unchanged.
 *   2. Redirect  — inject a system reminder telling the agent to break
 *                  the loop pattern. Agent continues with new context.
 *   3. ForceStop — halt the agent and return control to the user. Used
 *                  when redirect has already been tried and failed, or
 *                  when the loop touches safety-critical tools.
 *
 * Caller owns state — pure function (state in / state out).
 */

import { isSafetyCritical } from "../../runtime/permissions/trustTrajectory.ts";

export type RecoveryAction = "notify" | "redirect" | "force_stop";

export interface RecoveryState {
  /** Number of consecutive doom-loop detections for the current pattern. */
  consecutive: number;
  /** Fingerprint of the loop being tracked — when it changes, counter resets. */
  fingerprint: string;
  /** Last action emitted, for idempotency. */
  lastAction?: RecoveryAction;
}

export interface RecoveryDecision {
  action: RecoveryAction;
  /** Human-readable reason — surfaced to the user / logs. */
  reason: string;
  /** A system-reminder to inject (only set when action=redirect). */
  reminder?: string;
  /** Updated state to thread back into the next call. */
  state: RecoveryState;
}

export interface RecoveryInput {
  state: RecoveryState;
  /** Stable identifier of the loop pattern (e.g. tool name + arg hash). */
  fingerprint: string;
  /** Tool involved in the loop. Safety-critical tools fast-track ForceStop. */
  toolName: string;
  /** Optional details to weave into the redirect reminder. */
  details?: string;
}

export function newRecoveryState(): RecoveryState {
  return { consecutive: 0, fingerprint: "" };
}

/**
 * Map a doom-loop detection to a recovery action. Caller invokes this
 * each time `recordToolCallFingerprint` reports a hit; state must be
 * threaded back in across calls so the consecutive counter accumulates.
 *
 * Behavior:
 *   - First detection on a fresh fingerprint  → notify
 *   - Same fingerprint detected again         → redirect
 *   - Same fingerprint detected a third time  → force_stop
 *   - Safety-critical tool at any tier        → force_stop immediately
 *   - New fingerprint                         → counter resets, notify
 */
export function decideRecovery(input: RecoveryInput): RecoveryDecision {
  const { state, fingerprint, toolName, details } = input;

  const isSameLoop = state.fingerprint === fingerprint;
  const consecutive = isSameLoop ? state.consecutive + 1 : 1;

  // Safety-critical tools (place_order, execute_trade, …) skip the
  // gentle tiers — even one detection halts the agent. The cost of
  // re-firing an order is too high to redirect-and-pray.
  if (isSafetyCritical(toolName)) {
    return {
      action: "force_stop",
      reason: `Safety-critical tool "${toolName}" caught in a loop — halting agent.`,
      state: {
        consecutive,
        fingerprint,
        lastAction: "force_stop",
      },
    };
  }

  let action: RecoveryAction;
  let reason: string;
  let reminder: string | undefined;

  if (consecutive >= 3) {
    action = "force_stop";
    reason = `Doom loop on "${toolName}" persisted through ${consecutive} detections${details ? ` (${details})` : ""} — halting.`;
  } else if (consecutive === 2) {
    action = "redirect";
    reason = `Doom loop on "${toolName}" detected twice — injecting redirect.`;
    reminder =
      `[GORDON_LOOP_BREAK] You've called ${toolName} with the same arguments multiple times. ` +
      `Stop. Consider whether you have all the data you need to answer, whether the user's ` +
      `question can be answered without further tool use, or whether you should ask a clarifying ` +
      `question. Do NOT call ${toolName} again with the same arguments.`;
  } else {
    action = "notify";
    reason = `Doom loop on "${toolName}" detected — first warning${details ? ` (${details})` : ""}.`;
  }

  return {
    action,
    reason,
    ...(reminder !== undefined ? { reminder } : {}),
    state: { consecutive, fingerprint, lastAction: action },
  };
}

/**
 * Convenience: should the caller halt agent execution given the
 * current decision? Maps `force_stop` → true, others → false.
 */
export function shouldHalt(decision: RecoveryDecision): boolean {
  return decision.action === "force_stop";
}
