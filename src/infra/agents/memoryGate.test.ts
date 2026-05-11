import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  MAX_WORKING_MEMORY_CHARS,
  discardDeferredWorkingMemoryWrites,
  flushDeferredWorkingMemoryWrites,
  inspectDeferredWorkingMemory,
  isDeferralEnabled,
  truncateWorkingMemoryValue,
  wrapMemoryWithGate,
  _resetMemoryGateForTests,
} from "./memoryGate.ts";
import type { Memory } from "@mastra/memory";

interface FakeMemoryRecord {
  threadId: string;
  resourceId: string;
  workingMemory: string;
}

function makeFakeMemory(): {
  memory: Memory;
  writes: FakeMemoryRecord[];
  failNext?: () => void;
} {
  const writes: FakeMemoryRecord[] = [];
  const failures: boolean[] = [];
  const stub = {
    updateWorkingMemory: async (params: FakeMemoryRecord): Promise<void> => {
      if (failures.shift()) {
        throw new Error("fake memory write failed");
      }
      writes.push({ ...params });
    },
  };
  return {
    memory: stub as unknown as Memory,
    writes,
    failNext: () => {
      failures.push(true);
    },
  };
}

const FLAG = "GORDON_DEFER_WORKING_MEMORY";

describe("memoryGate", () => {
  const prev = process.env[FLAG];
  beforeEach(() => {
    delete process.env[FLAG];
  });
  afterEach(() => {
    if (prev === undefined) delete process.env[FLAG];
    else process.env[FLAG] = prev;
  });

  describe("truncateWorkingMemoryValue", () => {
    it("returns short values unchanged", () => {
      expect(truncateWorkingMemoryValue("hello")).toBe("hello");
    });

    it("truncates strings longer than MAX_WORKING_MEMORY_CHARS", () => {
      const big = "x".repeat(MAX_WORKING_MEMORY_CHARS + 500);
      const out = truncateWorkingMemoryValue(big);
      expect(out.length).toBeLessThanOrEqual(MAX_WORKING_MEMORY_CHARS);
      expect(out.endsWith("truncated to hot-tier cap]")).toBe(true);
    });

    it("preserves the leading content when truncating", () => {
      const big = "leading-marker" + "y".repeat(MAX_WORKING_MEMORY_CHARS);
      const out = truncateWorkingMemoryValue(big);
      expect(out.startsWith("leading-marker")).toBe(true);
    });
  });

  describe("wrapMemoryWithGate (cap path)", () => {
    it("truncates oversized writes before they reach the store", async () => {
      const { memory, writes } = makeFakeMemory();
      wrapMemoryWithGate(memory);
      const big = "z".repeat(MAX_WORKING_MEMORY_CHARS + 200);
      await (memory as unknown as { updateWorkingMemory: (p: FakeMemoryRecord) => Promise<void> })
        .updateWorkingMemory({ threadId: "t", resourceId: "r", workingMemory: big });
      expect(writes.length).toBe(1);
      expect(writes[0]!.workingMemory.length).toBeLessThanOrEqual(MAX_WORKING_MEMORY_CHARS);
      _resetMemoryGateForTests(memory);
    });

    it("passes small writes through unchanged", async () => {
      const { memory, writes } = makeFakeMemory();
      wrapMemoryWithGate(memory);
      await (memory as unknown as { updateWorkingMemory: (p: FakeMemoryRecord) => Promise<void> })
        .updateWorkingMemory({ threadId: "t", resourceId: "r", workingMemory: "ok" });
      expect(writes).toEqual([{ threadId: "t", resourceId: "r", workingMemory: "ok" }]);
      _resetMemoryGateForTests(memory);
    });

    it("is idempotent — wrapping twice does not double-wrap", async () => {
      const { memory, writes } = makeFakeMemory();
      wrapMemoryWithGate(memory);
      wrapMemoryWithGate(memory);
      await (memory as unknown as { updateWorkingMemory: (p: FakeMemoryRecord) => Promise<void> })
        .updateWorkingMemory({ threadId: "t", resourceId: "r", workingMemory: "ok" });
      expect(writes.length).toBe(1);
      _resetMemoryGateForTests(memory);
    });
  });

  describe("isDeferralEnabled", () => {
    it("reflects the env flag", () => {
      expect(isDeferralEnabled()).toBe(false);
      process.env[FLAG] = "1";
      expect(isDeferralEnabled()).toBe(true);
    });
  });

  describe("defer path", () => {
    it("buffers writes instead of applying them when defer is on", async () => {
      const { memory, writes } = makeFakeMemory();
      wrapMemoryWithGate(memory, { defer: true });
      await (memory as unknown as { updateWorkingMemory: (p: FakeMemoryRecord) => Promise<void> })
        .updateWorkingMemory({ threadId: "t1", resourceId: "r1", workingMemory: "hello" });
      expect(writes.length).toBe(0);
      const pending = inspectDeferredWorkingMemory(memory);
      expect(pending.length).toBe(1);
      expect(pending[0]!.threadId).toBe("t1");
      expect(pending[0]!.bytes).toBe(5);
      _resetMemoryGateForTests(memory);
    });

    it("flushDeferredWorkingMemoryWrites applies buffered writes in enqueue order", async () => {
      const { memory, writes } = makeFakeMemory();
      wrapMemoryWithGate(memory, { defer: true });
      const update = (memory as unknown as { updateWorkingMemory: (p: FakeMemoryRecord) => Promise<void> })
        .updateWorkingMemory;
      await update({ threadId: "t1", resourceId: "r1", workingMemory: "a" });
      await update({ threadId: "t2", resourceId: "r1", workingMemory: "b" });
      const count = await flushDeferredWorkingMemoryWrites(memory);
      expect(count).toBe(2);
      expect(writes.map((w) => w.workingMemory)).toEqual(["a", "b"]);
      // Buffer is empty after flush.
      expect(inspectDeferredWorkingMemory(memory).length).toBe(0);
      _resetMemoryGateForTests(memory);
    });

    it("last-write-wins per (threadId, resourceId) key", async () => {
      const { memory, writes } = makeFakeMemory();
      wrapMemoryWithGate(memory, { defer: true });
      const update = (memory as unknown as { updateWorkingMemory: (p: FakeMemoryRecord) => Promise<void> })
        .updateWorkingMemory;
      await update({ threadId: "t1", resourceId: "r1", workingMemory: "first" });
      await update({ threadId: "t1", resourceId: "r1", workingMemory: "second" });
      await update({ threadId: "t1", resourceId: "r1", workingMemory: "third" });
      await flushDeferredWorkingMemoryWrites(memory);
      expect(writes.length).toBe(1);
      expect(writes[0]!.workingMemory).toBe("third");
      _resetMemoryGateForTests(memory);
    });

    it("truncation runs BEFORE buffering — pending bytes already capped", async () => {
      const { memory } = makeFakeMemory();
      wrapMemoryWithGate(memory, { defer: true });
      const big = "z".repeat(MAX_WORKING_MEMORY_CHARS + 500);
      await (memory as unknown as { updateWorkingMemory: (p: FakeMemoryRecord) => Promise<void> })
        .updateWorkingMemory({ threadId: "t", resourceId: "r", workingMemory: big });
      const pending = inspectDeferredWorkingMemory(memory);
      expect(pending[0]!.bytes).toBeLessThanOrEqual(MAX_WORKING_MEMORY_CHARS);
      _resetMemoryGateForTests(memory);
    });

    it("discardDeferredWorkingMemoryWrites clears without applying", async () => {
      const { memory, writes } = makeFakeMemory();
      wrapMemoryWithGate(memory, { defer: true });
      await (memory as unknown as { updateWorkingMemory: (p: FakeMemoryRecord) => Promise<void> })
        .updateWorkingMemory({ threadId: "t", resourceId: "r", workingMemory: "buffered" });
      const dropped = discardDeferredWorkingMemoryWrites(memory);
      expect(dropped).toBe(1);
      expect(writes.length).toBe(0);
      expect(inspectDeferredWorkingMemory(memory).length).toBe(0);
      _resetMemoryGateForTests(memory);
    });

    it("flush continues past a single failed write", async () => {
      const fake = makeFakeMemory();
      wrapMemoryWithGate(fake.memory, { defer: true });
      const update = (fake.memory as unknown as { updateWorkingMemory: (p: FakeMemoryRecord) => Promise<void> })
        .updateWorkingMemory;
      await update({ threadId: "t1", resourceId: "r", workingMemory: "a" });
      await update({ threadId: "t2", resourceId: "r", workingMemory: "b" });
      fake.failNext!();
      const count = await flushDeferredWorkingMemoryWrites(fake.memory);
      expect(count).toBe(1); // one succeeded, one failed
      expect(fake.writes.length).toBe(1);
      _resetMemoryGateForTests(fake.memory);
    });

    it("env flag activates defer mode without explicit option", async () => {
      process.env[FLAG] = "1";
      const { memory, writes } = makeFakeMemory();
      wrapMemoryWithGate(memory);
      await (memory as unknown as { updateWorkingMemory: (p: FakeMemoryRecord) => Promise<void> })
        .updateWorkingMemory({ threadId: "t", resourceId: "r", workingMemory: "x" });
      expect(writes.length).toBe(0);
      expect(inspectDeferredWorkingMemory(memory).length).toBe(1);
      _resetMemoryGateForTests(memory);
    });
  });
});
