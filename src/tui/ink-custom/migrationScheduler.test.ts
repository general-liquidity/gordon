import { describe, expect, test } from "bun:test";

import { createMigrationScheduler, type SchedulerTimers } from "./migrationScheduler.ts";

// ---------------------------------------------------------------------------
// Manual timer: tests control when ticks fire instead of relying on real
// setInterval. Supports multiple active intervals — each returns its own
// handle, and `advance()` replays every tick that should have fired.
// ---------------------------------------------------------------------------

function makeManualTimers(): SchedulerTimers & {
  tick: () => void;
  activeHandles: () => number;
  clearedCount: () => number;
} {
  interface Entry {
    handler: () => void;
    ms: number;
    cleared: boolean;
  }
  const entries: Entry[] = [];
  let cleared = 0;

  return {
    setInterval(handler, ms) {
      const entry: Entry = { handler, ms, cleared: false };
      entries.push(entry);
      return entry; // handle = the entry itself
    },
    clearInterval(handle) {
      const entry = handle as Entry;
      if (!entry.cleared) {
        entry.cleared = true;
        cleared++;
      }
    },
    tick(): void {
      // Snapshot first — handlers may call clearInterval on themselves.
      const snapshot = entries.slice();
      for (const entry of snapshot) {
        if (!entry.cleared) entry.handler();
      }
    },
    activeHandles(): number {
      return entries.filter((e) => !e.cleared).length;
    },
    clearedCount(): number {
      return cleared;
    },
  };
}

describe("migrationScheduler lifecycle", () => {
  test("start() runs the migration on each tick until stop()", () => {
    const timers = makeManualTimers();
    let calls = 0;
    const scheduler = createMigrationScheduler(
      () => {
        calls++;
      },
      { timers },
    );

    const handle = scheduler.start(1000);

    expect(calls).toBe(0);
    timers.tick();
    expect(calls).toBe(1);
    timers.tick();
    timers.tick();
    expect(calls).toBe(3);

    handle.stop();
    timers.tick();
    expect(calls).toBe(3); // no further invocations after stop
    expect(timers.clearedCount()).toBe(1);
  });

  test("stop() is idempotent — calling twice doesn't clear twice", () => {
    const timers = makeManualTimers();
    const scheduler = createMigrationScheduler(() => {}, { timers });
    const handle = scheduler.start(500);

    handle.stop();
    handle.stop();
    handle.stop();

    expect(timers.clearedCount()).toBe(1);
  });

  test("rejects non-positive intervals", () => {
    const scheduler = createMigrationScheduler(() => {});
    expect(() => scheduler.start(0)).toThrow();
    expect(() => scheduler.start(-100)).toThrow();
    expect(() => scheduler.start(Number.NaN)).toThrow();
    expect(() => scheduler.start(Number.POSITIVE_INFINITY)).toThrow();
  });

  test("rejects a non-function migration callback", () => {
    expect(() => createMigrationScheduler(undefined as unknown as () => void)).toThrow();
  });

  test("supports multiple independent scheduler handles", () => {
    const timers = makeManualTimers();
    let callsA = 0;
    let callsB = 0;
    const schedA = createMigrationScheduler(
      () => {
        callsA++;
      },
      { timers },
    );
    const schedB = createMigrationScheduler(
      () => {
        callsB++;
      },
      { timers },
    );

    const hA = schedA.start(1000);
    const hB = schedB.start(1000);

    timers.tick();
    expect(callsA).toBe(1);
    expect(callsB).toBe(1);

    hA.stop();
    timers.tick();
    expect(callsA).toBe(1);
    expect(callsB).toBe(2);

    hB.stop();
    expect(timers.clearedCount()).toBe(2);
  });
});

describe("migrationScheduler reentrancy guard", () => {
  test("skips a tick if the previous migration is still running", () => {
    const timers = makeManualTimers();
    let depth = 0;
    let maxDepth = 0;
    let calls = 0;

    const scheduler = createMigrationScheduler(
      () => {
        calls++;
        depth++;
        maxDepth = Math.max(maxDepth, depth);
        // While this migration is "running", fire a nested tick. The guard
        // must refuse to reenter.
        timers.tick();
        depth--;
      },
      { timers },
    );

    const handle = scheduler.start(1000);

    timers.tick(); // outer call — handler nests another tick
    // Nested tick attempted to fire but was skipped due to reentrancy.
    expect(calls).toBe(1);
    expect(maxDepth).toBe(1);

    // A subsequent real tick after the first migration completed must run.
    timers.tick();
    expect(calls).toBe(2);

    handle.stop();
  });
});

describe("migrationScheduler error handling", () => {
  test("errors thrown by runMigration don't stop the scheduler", () => {
    const timers = makeManualTimers();
    const errors: unknown[] = [];
    let calls = 0;

    const scheduler = createMigrationScheduler(
      () => {
        calls++;
        if (calls === 1) throw new Error("boom");
      },
      {
        timers,
        onError: (err) => {
          errors.push(err);
        },
      },
    );

    const handle = scheduler.start(1000);

    timers.tick(); // throws
    timers.tick(); // keeps going
    timers.tick();

    expect(calls).toBe(3);
    expect(errors.length).toBe(1);
    expect((errors[0] as Error).message).toBe("boom");

    handle.stop();
  });

  test("an onError that itself throws does not break the interval", () => {
    const timers = makeManualTimers();
    let calls = 0;

    const scheduler = createMigrationScheduler(
      () => {
        calls++;
        throw new Error("kaboom");
      },
      {
        timers,
        onError: () => {
          throw new Error("reporter-exploded");
        },
      },
    );

    const handle = scheduler.start(1000);
    timers.tick();
    timers.tick();

    expect(calls).toBe(2);
    handle.stop();
  });

  test("default onError path invokes console.error on thrown migration (no injected onError)", () => {
    const timers = makeManualTimers();
    const origError = console.error;
    const captured: unknown[] = [];
    console.error = (...args: unknown[]) => {
      captured.push(args);
    };

    try {
      const scheduler = createMigrationScheduler(
        () => {
          throw new Error("default-path");
        },
        { timers },
      );

      const handle = scheduler.start(1000);
      timers.tick();
      handle.stop();
    } finally {
      console.error = origError;
    }

    expect(captured.length).toBe(1);
  });
});
