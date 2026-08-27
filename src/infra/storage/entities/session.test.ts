import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  initializeSession,
  forkThread,
  switchThread,
  listThreads,
  setThreadTitle,
  getCurrentSession,
  saveSessionState,
  setSessionPathForTesting,
} from "./session.ts";

let counter = 0;
let currentPath = "";
const cleanupPaths = new Set<string>();

function safeUnlink(path: string): void {
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    /* ignore */
  }
}

beforeEach(() => {
  counter++;
  currentPath = join(tmpdir(), `gordon-session-${process.pid}-${counter}.json`);
  cleanupPaths.add(currentPath);
  setSessionPathForTesting(currentPath);
});

afterEach(() => {
  setSessionPathForTesting(null);
});

afterAll(() => {
  for (const p of cleanupPaths) safeUnlink(p);
});

describe("forkThread + listThreads + switchThread", () => {
  test("listThreads returns empty on a fresh install", async () => {
    const threads = await listThreads();
    expect(threads).toEqual([]);
  });

  test("initializeSession populates the threads array", async () => {
    await initializeSession({ forceNewThread: true });
    const threads = await listThreads();
    expect(threads).toHaveLength(1);
    expect(threads[0]!.forkedFrom).toBeNull();
    expect(threads[0]!.title).toBe("");
  });

  test("forkThread creates a new thread with forkedFrom set", async () => {
    const original = await initializeSession({ forceNewThread: true });
    const forked = await forkThread(original.threadId, "alt-path");
    expect(forked.threadId).not.toBe(original.threadId);
    expect(forked.isNewSession).toBe(true);
    expect(forked.previousThreadId).toBe(original.threadId);
    const threads = await listThreads();
    expect(threads).toHaveLength(2);
    const forkedRecord = threads.find((t) => t.threadId === forked.threadId);
    expect(forkedRecord?.forkedFrom).toBe(original.threadId);
    expect(forkedRecord?.title).toBe("alt-path");
  });

  test("forkThread on unknown source throws", async () => {
    await expect(forkThread("thread-nonexistent")).rejects.toThrow(/not found/);
  });

  test("switchThread changes the active threadId without creating a new thread", async () => {
    const first = await initializeSession({ forceNewThread: true });
    const second = await initializeSession({ forceNewThread: true });
    const switched = await switchThread(first.threadId);
    expect(switched).not.toBeNull();
    expect(switched!.threadId).toBe(first.threadId);
    expect(switched!.isNewSession).toBe(false);
    expect(switched!.previousThreadId).toBe(second.threadId);
    const current = await getCurrentSession();
    expect(current.threadId).toBe(first.threadId);
  });

  test("switchThread to unknown id returns null", async () => {
    await initializeSession({ forceNewThread: true });
    const result = await switchThread("thread-doesnt-exist");
    expect(result).toBeNull();
  });

  test("setThreadTitle updates a thread's title", async () => {
    const info = await initializeSession({ forceNewThread: true });
    const ok = await setThreadTitle(info.threadId, "macro view");
    expect(ok).toBe(true);
    const threads = await listThreads();
    expect(threads.find((t) => t.threadId === info.threadId)?.title).toBe("macro view");
  });

  test("setThreadTitle on unknown thread returns false", async () => {
    const ok = await setThreadTitle("thread-nonexistent", "anything");
    expect(ok).toBe(false);
  });

  test("listThreads is sorted newest-first by lastActiveAt", async () => {
    const t1 = await initializeSession({ forceNewThread: true });
    await new Promise((r) => setTimeout(r, 5));
    const t2 = await initializeSession({ forceNewThread: true });
    await new Promise((r) => setTimeout(r, 5));
    await switchThread(t1.threadId); // Bumps t1's lastActiveAt above t2's.
    const threads = await listThreads();
    expect(threads[0]!.threadId).toBe(t1.threadId);
    expect(threads[1]!.threadId).toBe(t2.threadId);
  });

  test("legacy install (no threads array) is upgraded lazily on first init", async () => {
    await saveSessionState({
      resourceId: "user-legacy",
      threadId: null,
      threadStartedAt: null,
      lastActiveAt: new Date().toISOString(),
      sessionCount: 0,
    });
    const info = await initializeSession({ forceNewThread: true });
    const threads = await listThreads();
    expect(threads).toHaveLength(1);
    expect(threads[0]!.threadId).toBe(info.threadId);
  });
});
