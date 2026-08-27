import { describe, expect, test } from "bun:test";

import type { DOMElement } from "./dom.ts";
import { createScrollBox, type DirtyMarker, type Scheduler } from "./scrollBox.ts";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeNode(attrs: Record<string, number | string | boolean> = {}): DOMElement {
  return {
    nodeName: "ink-box",
    attributes: { ...attrs },
    childNodes: [],
    parentNode: undefined,
    style: {},
    internal_accessibility: {},
  } as unknown as DOMElement;
}

function makeMarker(): DirtyMarker & { count: number } {
  let count = 0;
  return {
    get count() {
      return count;
    },
    markDirty(): void {
      count++;
    },
  } as DirtyMarker & { count: number };
}

/** Synchronous scheduler that queues callbacks but only runs them when
 *  `flush()` is called. Lets tests assert "scheduled but not yet
 *  flushed" semantics. */
function makeQueuedScheduler(): {
  scheduler: Scheduler;
  flush: () => void;
  pending: () => number;
} {
  const queue: Array<() => void> = [];
  return {
    scheduler: ((cb: () => void) => {
      queue.push(cb);
    }) as Scheduler,
    flush(): void {
      const list = queue.splice(0);
      for (const cb of list) cb();
    },
    pending(): number {
      return queue.length;
    },
  };
}

// ---------------------------------------------------------------------------
// scrollTop state
// ---------------------------------------------------------------------------

describe("createScrollBox state", () => {
  test("initializes scrollTop on the node if absent", () => {
    const node = makeNode();
    const sb = createScrollBox(node);
    expect(sb.scrollTop).toBe(0);
    expect(node.attributes.scrollTop).toBe(0);
  });

  test("preserves an existing scrollTop attribute on the node", () => {
    const node = makeNode({ scrollTop: 42 });
    const sb = createScrollBox(node);
    expect(sb.scrollTop).toBe(42);
  });

  test("scrollBy mutates the node attribute", () => {
    const node = makeNode();
    const q = makeQueuedScheduler();
    const sb = createScrollBox(node, q.scheduler);
    sb.scrollBy(3);
    expect(sb.scrollTop).toBe(3);
    expect(node.attributes.scrollTop).toBe(3);
    sb.scrollBy(-1);
    expect(sb.scrollTop).toBe(2);
  });

  test("scrollTo sets the absolute position", () => {
    const node = makeNode();
    const q = makeQueuedScheduler();
    const sb = createScrollBox(node, q.scheduler);
    sb.scrollTo(15);
    expect(sb.scrollTop).toBe(15);
    sb.scrollTo(0);
    expect(sb.scrollTop).toBe(0);
  });

  test("scrollBy clamps to 0 when scrolling past the top", () => {
    const node = makeNode({ scrollTop: 5 });
    const q = makeQueuedScheduler();
    const sb = createScrollBox(node, q.scheduler);
    sb.scrollBy(-100);
    expect(sb.scrollTop).toBe(0);
  });

  test("scrollBy clamps to scrollMax when scrolling past the bottom", () => {
    const node = makeNode({ scrollMax: 20 });
    const q = makeQueuedScheduler();
    const sb = createScrollBox(node, q.scheduler);
    sb.scrollBy(50);
    expect(sb.scrollTop).toBe(20);
    expect(sb.scrollMax).toBe(20);
  });

  test("scrollBy with no scrollMax permits unbounded positive growth", () => {
    const node = makeNode();
    const q = makeQueuedScheduler();
    const sb = createScrollBox(node, q.scheduler);
    sb.scrollBy(99999);
    expect(sb.scrollTop).toBe(99999);
  });

  test("scrollBy with delta=0 or non-finite is a no-op (no schedule)", () => {
    const node = makeNode();
    const q = makeQueuedScheduler();
    const sb = createScrollBox(node, q.scheduler);
    sb.scrollBy(0);
    sb.scrollBy(Number.NaN);
    sb.scrollBy(Number.POSITIVE_INFINITY);
    expect(sb.scheduledCount).toBe(0);
    expect(q.pending()).toBe(0);
  });

  test("scrollBy that doesn't change scrollTop does not schedule", () => {
    // E.g. already clamped at 0 and scroll up further.
    const node = makeNode();
    const q = makeQueuedScheduler();
    const sb = createScrollBox(node, q.scheduler);
    sb.scrollBy(-3); // already 0, clamp to 0 -> no change
    expect(sb.scheduledCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// markDirty + scheduling
// ---------------------------------------------------------------------------

describe("createScrollBox scheduling", () => {
  test("schedules markDirty exactly once per microtask flush", () => {
    const node = makeNode();
    const q = makeQueuedScheduler();
    const marker = makeMarker();
    const sb = createScrollBox(node, q.scheduler, marker);

    // 100 events in a single tick.
    for (let i = 0; i < 100; i++) sb.scrollBy(1);
    expect(sb.scheduledCount).toBe(1);
    expect(marker.count).toBe(0); // not flushed yet
    expect(q.pending()).toBe(1);

    q.flush();
    expect(marker.count).toBe(1); // ONE markDirty for 100 events
  });

  test("re-schedules after a flush", () => {
    const node = makeNode();
    const q = makeQueuedScheduler();
    const marker = makeMarker();
    const sb = createScrollBox(node, q.scheduler, marker);

    sb.scrollBy(1);
    q.flush();
    expect(marker.count).toBe(1);

    sb.scrollBy(1);
    q.flush();
    expect(marker.count).toBe(2);
    expect(sb.scheduledCount).toBe(2);
  });

  test("markDirty() forces a schedule even without a scrollTop change", () => {
    const node = makeNode();
    const q = makeQueuedScheduler();
    const marker = makeMarker();
    const sb = createScrollBox(node, q.scheduler, marker);

    sb.markDirty();
    expect(sb.scheduledCount).toBe(1);
    q.flush();
    expect(marker.count).toBe(1);
  });

  test("works without a dirtyMarker (no-op marker, but state still mutates)", () => {
    const node = makeNode();
    const q = makeQueuedScheduler();
    const sb = createScrollBox(node, q.scheduler /* no marker */);
    sb.scrollBy(5);
    q.flush();
    expect(sb.scrollTop).toBe(5);
    expect(sb.dirtyCount).toBe(0); // never incremented because no marker
  });

  test("uses node.yogaNode as default marker if no override given", () => {
    let dirtyCalls = 0;
    const fakeYoga = { markDirty: () => dirtyCalls++ } as unknown;
    const node = makeNode();
    (node as { yogaNode?: unknown }).yogaNode = fakeYoga;
    const q = makeQueuedScheduler();
    const sb = createScrollBox(node, q.scheduler);
    sb.scrollBy(1);
    q.flush();
    expect(dirtyCalls).toBe(1);
    expect(sb.dirtyCount).toBe(1);
  });

  test("multiple handles on same node share scrollTop state", () => {
    const node = makeNode();
    const q = makeQueuedScheduler();
    const a = createScrollBox(node, q.scheduler);
    const b = createScrollBox(node, q.scheduler);
    a.scrollBy(7);
    expect(b.scrollTop).toBe(7);
    b.scrollBy(3);
    expect(a.scrollTop).toBe(10);
  });
});

describe("createScrollBox edge cases", () => {
  test("default scheduler uses queueMicrotask (smoke test)", async () => {
    const node = makeNode();
    const marker = makeMarker();
    const sb = createScrollBox(node, undefined, marker);
    sb.scrollBy(1);
    // Microtask hasn't drained yet.
    expect(marker.count).toBe(0);
    // Awaiting a resolved promise drains the microtask queue.
    await Promise.resolve();
    expect(marker.count).toBe(1);
  });

  test("ignores a malformed scrollTop attribute and treats it as 0", () => {
    const node = makeNode({ scrollTop: "junk" as unknown as number });
    // The constructor only initializes when missing; existing junk stays
    // until first mutation. The reader returns 0 for non-numeric.
    const sb = createScrollBox(node);
    expect(sb.scrollTop).toBe(0);
    sb.scrollBy(2);
    expect(sb.scrollTop).toBe(2);
  });

  test("ignores a malformed scrollMax attribute and falls back to Infinity", () => {
    const node = makeNode({ scrollMax: -5 });
    const sb = createScrollBox(node);
    // -5 is invalid (must be >= 0); reader falls back to Infinity.
    expect(sb.scrollMax).toBe(Number.POSITIVE_INFINITY);
  });
});
