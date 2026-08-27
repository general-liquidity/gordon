// scrollBox — pure utility for high-frequency scroll state mutation.
//
// Active in VirtualMessageList. Provides a thin handle that mutates a DOMElement's
// scroll position WITHOUT triggering a React reconcile per event. Mouse
// wheel events arrive at ~150 Hz; routing each through `setState`
// reconcile -> commit -> layout adds 5-10ms per event. The Claude Code
// pattern this mirrors:
//
//   1. Mutate the node's scrollTop directly (data on the DOM, not in
//      React state).
//   2. Call yogaNode.markDirty() so the next layout pass picks it up.
//   3. Schedule one render via queueMicrotask so a burst of events
//      coalesces into a single render at the next microtask flush
//      rather than one render per event.
//
// Total cost per event: <1ms — no React reconcile is involved.
//
// API contract (what consumers can rely on):
//   * scrollTop is stored on `node.attributes.scrollTop` as a number.
//   * scrollBy(delta) and scrollTo(y) clamp to [0, maxScroll]. The max
//     scroll is read from `node.attributes.scrollMax` if present (set
//     by the consuming component when it knows its content height).
//   * markDirty fires at most once per microtask flush even under a
//     burst of scroll events.
//   * The returned object is a value type — multiple calls to
//     createScrollBox(node) return independent handles, but all
//     handles for the same node share the same scrollTop state
//     (the node IS the source of truth).
//
// What this module does NOT do (deferred):
//   * Mouse-wheel parsing (SGR 1003 or other terminal mouse modes).
//   * Reading content height to compute scrollMax — caller's job.
//
// Tests: scrollBox.test.ts exercises the pure state machine — clamping,
// markDirty call count, and microtask coalescing.

import type { DOMElement } from "./dom.ts";

/** Pluggable scheduler — defaults to queueMicrotask but tests can
 *  inject a synchronous scheduler to assert call counts deterministically. */
export type Scheduler = (cb: () => void) => void;

/** Minimal markDirty surface from the yoga-layout Node. We accept any
 *  object with a markDirty() method so tests can pass a spy without
 *  pulling in yoga-layout. */
export interface DirtyMarker {
  markDirty(): void;
}

export interface ScrollBox {
  /** Current scrollTop as stored on the node. */
  readonly scrollTop: number;
  /** Maximum scroll position. Defaults to Infinity (no clamp top end)
   *  unless the node carries an explicit `scrollMax` attribute. */
  readonly scrollMax: number;
  /** Adjust scroll by delta. Positive = scroll down (later content). */
  scrollBy(delta: number): void;
  /** Set absolute scroll position. */
  scrollTo(y: number): void;
  /** Force a markDirty + render schedule without changing scrollTop.
   *  Useful when content height changes outside our control. */
  markDirty(): void;
  /** Number of times the scheduler has actually been invoked since
   *  this handle was created. Exposed for tests; cheap to maintain. */
  readonly scheduledCount: number;
  /** Number of times markDirty() has fired on the underlying node
   *  since this handle was created. Exposed for tests. */
  readonly dirtyCount: number;
}

/** Read the max-scroll attribute off the node, falling back to Infinity
 *  if the consumer has not set one. We also accept negative-or-zero as
 *  "no scroll possible" (clamp to 0). */
function readScrollMax(node: DOMElement): number {
  const raw = node.attributes.scrollMax;
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) return raw;
  return Number.POSITIVE_INFINITY;
}

function readScrollTop(node: DOMElement): number {
  const raw = node.attributes.scrollTop;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
}

/**
 * Build a ScrollBox handle wrapping `node`. The handle stores its
 * mutable state on `node.attributes` so multiple handles for the same
 * node observe the same scrollTop.
 *
 * @param node The DOM node whose scroll position we manage.
 * @param scheduler Optional override for the microtask scheduler. Pass
 *   a synchronous function in tests; defaults to `queueMicrotask`.
 * @param dirtyMarker Optional override for the dirty marker. Defaults
 *   to `node.yogaNode` if present; otherwise a no-op (so this stays
 *   safe to call before a yoga node has been attached).
 */
export function createScrollBox(
  node: DOMElement,
  scheduler?: Scheduler,
  dirtyMarker?: DirtyMarker,
): ScrollBox {
  if (!node) {
    throw new Error("createScrollBox: node is required");
  }

  const sched: Scheduler =
    scheduler ??
    ((cb: () => void) => {
      // queueMicrotask is available in Node 11+ and Bun.
      queueMicrotask(cb);
    });

  const marker: DirtyMarker | undefined = dirtyMarker ?? (node.yogaNode as DirtyMarker | undefined);

  // Initialize scrollTop on the node if missing — readers should always
  // see a number.
  if (typeof node.attributes.scrollTop !== "number") {
    node.attributes.scrollTop = 0;
  }

  // Coalescing: a burst of scrollBy() calls schedules at most one
  // render per microtask flush. `pending` is true between schedule and
  // flush; flush resets it.
  let pending = false;
  let scheduledCount = 0;
  let dirtyCount = 0;

  function flush(): void {
    pending = false;
    if (marker) {
      marker.markDirty();
      dirtyCount++;
    }
  }

  function schedule(): void {
    if (pending) return;
    pending = true;
    scheduledCount++;
    sched(flush);
  }

  function clamp(y: number): number {
    const max = readScrollMax(node);
    if (!Number.isFinite(y)) return 0;
    if (y < 0) return 0;
    if (y > max) return max === Number.POSITIVE_INFINITY ? y : max;
    return y;
  }

  function setScrollTop(y: number): void {
    const clamped = clamp(y);
    const current = readScrollTop(node);
    if (clamped === current) return;
    node.attributes.scrollTop = clamped;
    schedule();
  }

  return {
    get scrollTop() {
      return readScrollTop(node);
    },
    get scrollMax() {
      return readScrollMax(node);
    },
    get scheduledCount() {
      return scheduledCount;
    },
    get dirtyCount() {
      return dirtyCount;
    },
    scrollBy(delta: number): void {
      if (!Number.isFinite(delta) || delta === 0) return;
      setScrollTop(readScrollTop(node) + delta);
    },
    scrollTo(y: number): void {
      setScrollTop(y);
    },
    markDirty(): void {
      schedule();
    },
  };
}
