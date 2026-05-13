/**
 * Clean-State Gate (GORDON_CLEAN_STATE_GATE).
 *
 * Ports L12 from learn-harness-engineering — session completion =
 * task verified AND clean-state check passes. Promotes a focused
 * subset of doctor diagnostics from "informational" to "gating."
 *
 * The framework's five clean-state dimensions (build, tests, progress,
 * artifacts, startup) map to Gordon's runtime model as follows:
 *
 *   build      → N/A (Gordon is the runtime, not a project being built;
 *                     typecheck happens at CI, not session end)
 *   tests      → N/A at session-end speed (the eval harness is slow);
 *                covered by CI
 *   progress   → action-log + working memory have been flushed
 *   artifacts  → no supply-chain IOCs, no suspicious optional deps,
 *                no critique-phase routing regression
 *   startup    → safety deny-list intact, hot-tier cap intact, mastra
 *                patch applied — i.e., the next session can boot
 *
 * The gate is opt-in via GORDON_CLEAN_STATE_GATE=1 so we can roll it
 * out behind a flag without breaking existing exit paths. When
 * enabled, a `block` verdict means the agent loop should refuse to
 * end the session until the operator acknowledges (which is logged
 * as a deliberate clean-state override).
 *
 * The gate does not itself run the doctor — the caller passes in the
 * doctor results. This keeps the gate cheap to test and reusable
 * across whichever code path runs the doctor.
 */

import type { DiagnosticCheck } from "../diagnostics/doctor.ts";

/**
 * Which doctor-check IDs participate in the gate. Conservative subset:
 * each entry is one where a `fail` would meaningfully degrade the next
 * session's startup or carry real security risk.
 */
export const GATE_ELIGIBLE_CHECK_IDS = [
  // Artifact dimension — supply-chain integrity
  "supply-chain-iocs",
  "suspicious-optional-deps",
  // Startup dimension — next session must be bootable
  "safety-deny-list",
  "hot-tier-cap",
  "mastra-patch",
  "critique-routing",
  // Build/Mastra dimension — DB readable
  "mastra-db",
] as const;

export type GateEligibleCheckId = (typeof GATE_ELIGIBLE_CHECK_IDS)[number];

export type CleanStateVerdict = "clean" | "warn" | "block";

export interface CleanStateGateResult {
  verdict: CleanStateVerdict;
  failingChecks: DiagnosticCheck[];
  warningChecks: DiagnosticCheck[];
  passingChecks: DiagnosticCheck[];
  skippedReason?: string;
  blockingMessage?: string;
}

export interface SessionProgressSignal {
  /** True if working memory writes from this session have been flushed to disk. */
  workingMemoryFlushed: boolean;
  /** True if at least one durable action-log entry exists for this session. */
  actionLogHasEntries: boolean;
  /** True if no plan is in an in-flight state (proposed/active without resolution). */
  noOrphanPlans: boolean;
}

export function isCleanStateGateEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.GORDON_CLEAN_STATE_GATE === "1" || env.GORDON_CLEAN_STATE_GATE === "true";
}

/**
 * Run the gate against a doctor result + a session-progress signal.
 *
 * Verdict rules:
 *   - block: any gate-eligible doctor check is `fail`, OR any progress
 *            signal is false (working memory not flushed, no log entries,
 *            orphan plans)
 *   - warn:  any gate-eligible doctor check is `warn`
 *   - clean: everything else
 *
 * When the gate is disabled via env var, returns `clean` with a
 * `skippedReason` set so callers can log the override.
 */
export function runCleanStateGate(
  checks: ReadonlyArray<DiagnosticCheck>,
  progress: SessionProgressSignal,
  env: NodeJS.ProcessEnv = process.env,
): CleanStateGateResult {
  if (!isCleanStateGateEnabled(env)) {
    return {
      verdict: "clean",
      failingChecks: [],
      warningChecks: [],
      passingChecks: [],
      skippedReason: "GORDON_CLEAN_STATE_GATE not enabled",
    };
  }

  const eligible = new Set<string>(GATE_ELIGIBLE_CHECK_IDS);
  const gateChecks = checks.filter((c) => eligible.has(c.id));
  const failingChecks = gateChecks.filter((c) => c.status === "fail");
  const warningChecks = gateChecks.filter((c) => c.status === "warn");
  const passingChecks = gateChecks.filter((c) => c.status === "pass");

  const progressViolations: string[] = [];
  if (!progress.workingMemoryFlushed) progressViolations.push("working memory not flushed");
  if (!progress.actionLogHasEntries) progressViolations.push("action log has no entries");
  if (!progress.noOrphanPlans) progressViolations.push("in-flight plans remain unresolved");

  if (failingChecks.length > 0 || progressViolations.length > 0) {
    const parts: string[] = [];
    if (failingChecks.length > 0) {
      parts.push(`${failingChecks.length} failing diagnostic(s): ${failingChecks.map((c) => c.id).join(", ")}`);
    }
    if (progressViolations.length > 0) {
      parts.push(`progress violations: ${progressViolations.join(", ")}`);
    }
    return {
      verdict: "block",
      failingChecks,
      warningChecks,
      passingChecks,
      blockingMessage:
        `Session cannot end cleanly — ${parts.join("; ")}. ` +
        `Run /doctor to inspect, resolve the blockers, or set ` +
        `GORDON_CLEAN_STATE_GATE_OVERRIDE=1 to record a deliberate dirty exit.`,
    };
  }

  if (warningChecks.length > 0) {
    return {
      verdict: "warn",
      failingChecks: [],
      warningChecks,
      passingChecks,
    };
  }

  return {
    verdict: "clean",
    failingChecks: [],
    warningChecks: [],
    passingChecks,
  };
}

/**
 * Operator-acknowledged override. When the gate blocks and the
 * operator deliberately wants to exit anyway, they set
 * GORDON_CLEAN_STATE_GATE_OVERRIDE=1. Callers should record this in
 * the action log as a "dirty exit acknowledged" event so the next
 * session knows the state was intentional, not an accident.
 */
export function hasOverrideAcknowledgement(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    env.GORDON_CLEAN_STATE_GATE_OVERRIDE === "1" ||
    env.GORDON_CLEAN_STATE_GATE_OVERRIDE === "true"
  );
}

/**
 * Build the payload to record in the action log when a gate fires
 * (either passes, warns, blocks, or is overridden).
 */
export function gateResultToPayload(
  result: CleanStateGateResult,
  override: boolean,
): Record<string, unknown> {
  return {
    kind: "clean_state.gate_recorded",
    verdict: result.verdict,
    overridden: override,
    failingIds: result.failingChecks.map((c) => c.id),
    warningIds: result.warningChecks.map((c) => c.id),
    passingIds: result.passingChecks.map((c) => c.id),
    skippedReason: result.skippedReason,
    blockingMessage: result.blockingMessage,
  };
}
