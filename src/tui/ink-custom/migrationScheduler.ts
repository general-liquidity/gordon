/**
 * migrationScheduler — Phase 6 reconciler module.
 *
 * Status: NOT WIRED. A thin wrapper around setInterval that fires a
 * user-supplied migration callback every N ms. Guards against reentrancy
 * (slow migrations never overlap) and swallows errors so the scheduler keeps
 * ticking even if one migration throws.
 *
 * The contract-level `MigrationScheduler.start(intervalMs)` signature is
 * preserved verbatim. Tests inject a custom pair of (setInterval,
 * clearInterval) via the optional `timers` option so they can drive the
 * scheduler deterministically without real clocks — this is an additive
 * option, not a contract change.
 */

import type {
  MigrationScheduler,
  MigrationSchedulerHandle,
} from "./internal/contracts.ts";

/**
 * Test seam: if omitted, we use the host runtime's global setInterval /
 * clearInterval. Tests inject deterministic alternatives.
 */
export interface SchedulerTimers {
  setInterval: (handler: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
}

export interface SchedulerOptions {
  timers?: SchedulerTimers;
  /** Hook for custom error reporting; defaults to console.error. */
  onError?: (err: unknown) => void;
}

export function createMigrationScheduler(
  runMigration: () => void,
  options: SchedulerOptions = {},
): MigrationScheduler {
  if (typeof runMigration !== "function") {
    throw new Error(
      "createMigrationScheduler: runMigration must be a function",
    );
  }

  const timers: SchedulerTimers = options.timers ?? {
    setInterval: (handler, ms) => setInterval(handler, ms),
    clearInterval: (handle) =>
      clearInterval(handle as ReturnType<typeof setInterval>),
  };

  const onError =
    options.onError ??
    ((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error("[migrationScheduler] migration failed:", err);
    });

  const scheduler: MigrationScheduler = {
    start(intervalMs: number): MigrationSchedulerHandle {
      if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
        throw new Error(
          `migrationScheduler.start: intervalMs must be > 0, got ${intervalMs}`,
        );
      }

      // Reentrancy flag — if a migration is still running when the next
      // tick fires (pool is huge, GC pressure, whatever), we just skip.
      // Better to drop a tick than to stack parallel migrations on top of
      // each other.
      let running = false;
      let stopped = false;

      const tick = (): void => {
        if (stopped) return;
        if (running) return;
        running = true;
        try {
          runMigration();
        } catch (err) {
          // Non-fatal: log and keep the interval alive so the next cycle
          // gets a fresh shot.
          try {
            onError(err);
          } catch {
            // Error reporter itself threw — nothing else we can do.
          }
        } finally {
          running = false;
        }
      };

      const handle = timers.setInterval(tick, intervalMs);

      return {
        stop(): void {
          if (stopped) return;
          stopped = true;
          timers.clearInterval(handle);
        },
      };
    },
  };

  return scheduler;
}
