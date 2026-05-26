import { beforeEach, describe, expect, test } from "bun:test";
import {
  enqueueInterrupt,
  drainInterrupts,
  peekInterrupts,
  interruptDepth,
  defaultInterruptMessage,
  _resetInterruptsForTests,
} from "./interruptQueue.ts";

beforeEach(() => {
  _resetInterruptsForTests();
});

describe("interruptQueue — enqueue + drain", () => {
  test("empty queue drains to empty array", () => {
    expect(drainInterrupts()).toEqual([]);
    expect(interruptDepth()).toBe(0);
  });

  test("enqueued message prefixes with [INTERRUPT]", () => {
    enqueueInterrupt("hold up");
    const drained = drainInterrupts();
    expect(drained).toHaveLength(1);
    expect(drained[0]).toContain("[INTERRUPT]");
    expect(drained[0]).toContain("hold up");
  });

  test("drain empties the queue", () => {
    enqueueInterrupt("first");
    enqueueInterrupt("second");
    expect(interruptDepth()).toBe(2);
    drainInterrupts();
    expect(interruptDepth()).toBe(0);
  });

  test("preserves FIFO order across multiple enqueues", () => {
    enqueueInterrupt("one");
    enqueueInterrupt("two");
    enqueueInterrupt("three");
    const drained = drainInterrupts();
    expect(drained.map((m) => m.split(" ").slice(1).join(" "))).toEqual(["one", "two", "three"]);
  });

  test("empty / whitespace-only messages are silently dropped", () => {
    enqueueInterrupt("");
    enqueueInterrupt("   ");
    enqueueInterrupt("\n\t");
    expect(interruptDepth()).toBe(0);
  });

  test("raw mode skips the [INTERRUPT] prefix", () => {
    enqueueInterrupt("system note: refresh context", { raw: true });
    const drained = drainInterrupts();
    expect(drained[0]).toBe("system note: refresh context");
  });
});

describe("interruptQueue — capacity", () => {
  test("queue caps at MAX_QUEUE_DEPTH and evicts oldest", () => {
    // Fill past capacity (16 is the documented cap).
    for (let i = 0; i < 20; i++) {
      enqueueInterrupt(`msg-${i}`);
    }
    expect(interruptDepth()).toBeLessThanOrEqual(16);
    const drained = drainInterrupts();
    // Oldest entries should have been evicted; newest must be present.
    expect(drained.some((m) => m.includes("msg-19"))).toBe(true);
    expect(drained.some((m) => m.includes("msg-0"))).toBe(false);
  });

  test("enqueue returns false on eviction", () => {
    for (let i = 0; i < 16; i++) enqueueInterrupt(`msg-${i}`);
    expect(enqueueInterrupt("overflow")).toBe(false);
    expect(enqueueInterrupt("more-overflow")).toBe(false);
  });

  test("enqueue returns true while under capacity", () => {
    expect(enqueueInterrupt("first")).toBe(true);
    expect(enqueueInterrupt("second")).toBe(true);
  });
});

describe("interruptQueue — peek", () => {
  test("peek does not drain", () => {
    enqueueInterrupt("inspect me");
    const peeked = peekInterrupts();
    expect(peeked).toHaveLength(1);
    expect(interruptDepth()).toBe(1);
    const drainedAfter = drainInterrupts();
    expect(drainedAfter).toHaveLength(1);
  });

  test("peek returns a frozen snapshot", () => {
    enqueueInterrupt("first");
    const peeked = peekInterrupts();
    expect(() => {
      (peeked as unknown as string[]).push("mutated");
    }).toThrow();
  });
});

describe("interruptQueue — defaultInterruptMessage", () => {
  test("returns a non-empty operator-readable string", () => {
    const msg = defaultInterruptMessage();
    expect(msg.length).toBeGreaterThan(0);
    expect(msg).toContain("Ctrl+C");
    expect(msg.toLowerCase()).toContain("stop");
  });
});
