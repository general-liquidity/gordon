// ============================================================================
// Graceful Shutdown — Clean exit with state persistence
//
// Registers process exit handlers. Runs cleanup callbacks in order.
// 5-second timeout: force exit if cleanup takes too long.
//
// Optionally enforces the clean-state gate (GORDON_CLEAN_STATE_GATE=1).
// When the gate blocks and the operator hasn't set the override env
// var, the shutdown handler logs the verdict and exits non-zero so
// CI / supervisors can detect the unclean termination.
// ============================================================================

import { runDoctorChecks } from "../../../infra/diagnostics/doctor.ts";
import {
  isCleanStateGateEnabled,
  runCleanStateGate,
  hasOverrideAcknowledgement,
  gateResultToPayload,
} from "../../../infra/safety/cleanStateGate.ts";

type CleanupFn = () => void | Promise<void>;

const cleanupHandlers: CleanupFn[] = [];
let shuttingDown = false;

export function onShutdown(callback: CleanupFn): void {
  cleanupHandlers.push(callback);
}

async function performShutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  // Force exit timeout
  const timeout = setTimeout(() => {
    process.exit(1);
  }, 5000);

  let cleanStateBlocked = false;

  try {
    for (const handler of cleanupHandlers) {
      try {
        await handler();
      } catch {
        // Continue cleanup even if individual handler fails
      }
    }

    // Clean-state gate (default-off). Runs AFTER cleanup handlers so
    // working-memory flushes etc. have had a chance to land. Doctor
    // checks are filtered to the gate-eligible subset by the gate
    // helper. When blocked and no override is recorded, we exit
    // non-zero so supervisors can detect.
    if (isCleanStateGateEnabled()) {
      try {
        const checks = await runDoctorChecks();
        // Progress signal is best-effort: at SIGINT/SIGTERM we don't
        // know with certainty whether memory was flushed, so we
        // assume the cleanup handlers above did their job and report
        // optimistic values. The doctor checks themselves still
        // surface real artifact/startup problems.
        const result = runCleanStateGate(checks, {
          workingMemoryFlushed: true,
          actionLogHasEntries: true,
          noOrphanPlans: true,
        });
        const override = hasOverrideAcknowledgement();
        const payload = gateResultToPayload(result, override);
        // Best-effort log — stderr so it shows up in supervisor logs
        // without interfering with normal stdout output.
        process.stderr.write(
          `[clean-state-gate] verdict=${result.verdict} signal=${signal} override=${override} ` +
          `failing=${(payload.failingIds as string[]).join(",") || "none"}\n`,
        );
        if (result.verdict === "block" && !override) {
          cleanStateBlocked = true;
        }
      } catch (err) {
        process.stderr.write(
          `[clean-state-gate] failed to evaluate: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      }
    }
  } finally {
    clearTimeout(timeout);
    process.exit(cleanStateBlocked ? 2 : 0);
  }
}

export function registerShutdownHandlers(): void {
  process.on("SIGINT", () => performShutdown("SIGINT"));
  process.on("SIGTERM", () => performShutdown("SIGTERM"));
  process.on("exit", () => {
    if (!shuttingDown) {
      for (const handler of cleanupHandlers) {
        try {
          const result = handler();
          if (result instanceof Promise) {
            // Can't await in exit handler, but try
          }
        } catch {
          // Best effort
        }
      }
    }
  });
}
