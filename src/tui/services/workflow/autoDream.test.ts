import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

import { AutoDreamManager, type DreamConsolidator } from "./autoDream.ts";

const LOCK_PATH = join(homedir(), ".gordon", "dream.lock");

function clearLock(): void {
  try {
    if (existsSync(LOCK_PATH)) unlinkSync(LOCK_PATH);
  } catch {}
}

/** Fake consolidator — records which legs were invoked, never touches disk. */
function makeFakeConsolidator(): DreamConsolidator & { aceCalls: number; dedupeCalls: number } {
  const state = {
    aceCalls: 0,
    dedupeCalls: 0,
    runACE() {
      state.aceCalls += 1;
    },
    dedupeSessionMemory() {
      state.dedupeCalls += 1;
    },
  };
  return state;
}

describe("AutoDreamManager.checkAndConsolidate", () => {
  beforeEach(clearLock);
  afterEach(clearLock);

  it("runs consolidation (ACE + session dedupe) when all gates pass", async () => {
    const fake = makeFakeConsolidator();
    const mgr = new AutoDreamManager(fake);

    const ran = await mgr.checkAndConsolidate(5, null);

    expect(ran).toBe(true);
    expect(fake.aceCalls).toBe(1);
    expect(fake.dedupeCalls).toBe(1);
    // Lock released in finally.
    expect(existsSync(LOCK_PATH)).toBe(false);
  });

  it("does NOT consolidate when the session-count gate fails (< 5)", async () => {
    const fake = makeFakeConsolidator();
    const mgr = new AutoDreamManager(fake);

    const ran = await mgr.checkAndConsolidate(4, null);

    expect(ran).toBe(false);
    expect(fake.aceCalls).toBe(0);
    expect(fake.dedupeCalls).toBe(0);
  });

  it("does NOT consolidate when the 24h time gate fails", async () => {
    const fake = makeFakeConsolidator();
    const mgr = new AutoDreamManager(fake);

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const ran = await mgr.checkAndConsolidate(10, oneHourAgo);

    expect(ran).toBe(false);
    expect(fake.aceCalls).toBe(0);
    expect(fake.dedupeCalls).toBe(0);
  });

  it("consolidates when the 24h time gate is satisfied (> 24h since last)", async () => {
    const fake = makeFakeConsolidator();
    const mgr = new AutoDreamManager(fake);

    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const ran = await mgr.checkAndConsolidate(10, twoDaysAgo);

    expect(ran).toBe(true);
    expect(fake.aceCalls).toBe(1);
    expect(fake.dedupeCalls).toBe(1);
  });

  it("lock prevents a concurrent run from consolidating", async () => {
    const fakeA = makeFakeConsolidator();
    const fakeB = makeFakeConsolidator();

    // Consolidator A blocks inside runACE so its lock is still held when B runs.
    let releaseA: () => void = () => {};
    const aDone = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    let bRanWhileALocked: boolean | undefined;

    const blockingA: DreamConsolidator = {
      runACE() {
        fakeA.runACE(0);
        // While A holds the lock, a second manager must be blocked by Gate 3.
        const mgrB = new AutoDreamManager(fakeB);
        // Run B synchronously inside A's critical section.
        void mgrB.checkAndConsolidate(5, null).then((r) => {
          bRanWhileALocked = r;
          releaseA();
        });
      },
      dedupeSessionMemory() {
        fakeA.dedupeSessionMemory();
      },
    };

    const mgrA = new AutoDreamManager(blockingA);
    const ranA = await mgrA.checkAndConsolidate(5, null);
    await aDone;

    expect(ranA).toBe(true);
    expect(fakeA.aceCalls).toBe(1);
    // B saw the lock held by A and short-circuited at Gate 3.
    expect(bRanWhileALocked).toBe(false);
    expect(fakeB.aceCalls).toBe(0);
    expect(fakeB.dedupeCalls).toBe(0);
  });
});
