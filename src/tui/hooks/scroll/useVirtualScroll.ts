import { useSyncExternalStore, useCallback, useMemo, useRef } from "react";

// ============================================================================
// useVirtualScroll — Viewport culling for large message lists
//
// Port of Claude Code's virtual scroll patterns:
//  - Content-based height estimation (no fixed itemHeight=3)
//  - SCROLL_QUANTUM: re-renders only when visible RANGE changes (every 40 rows)
//  - OVERSCAN_ROWS: 80-row overscan (row-based, not item-based)
//  - MAX_MOUNTED_ITEMS: hard cap on rendered items (300)
//  - Binary search for O(log n) visible-range computation
//  - Cumulative offset array for pixel-accurate positioning
// ============================================================================

// ---------------------------------------------------------------------------
// Constants (match Claude Code exactly)
// ---------------------------------------------------------------------------

const OVERSCAN_ROWS = 80; // was: overscan=3 items (~9 rows)
const SCROLL_QUANTUM = 40; // quantize scrollTop to reduce re-renders
const MAX_MOUNTED_ITEMS = 300; // cap on rendered items
// const SLIDE_STEP = 25;        // max new items per commit (reserved for future sliding window)
// const COLD_START_COUNT = 30;  // items rendered before heights known (reserved)

// ---------------------------------------------------------------------------
// Height estimation
// ---------------------------------------------------------------------------

/**
 * Estimate terminal row height for a message from its content string.
 * No Yoga layout feedback available in stock Ink — approximate via line-wrapping.
 */
export function estimateMessageHeight(
  content: string,
  terminalWidth: number,
  variant?: string,
): number {
  // chrome = badge line + bottom margin
  const chrome = 2;
  if (!content) return chrome + 1;

  // Count logical lines in content accounting for terminal wrap
  const lines = content.split("\n");
  let rows = 0;
  for (const line of lines) {
    // Strip ANSI escape codes for accurate width calculation
    const plain = line.replace(/\x1b\[[0-9;]*m/g, "");
    rows += Math.max(1, Math.ceil(plain.length / Math.max(1, terminalWidth - 4)));
  }

  // Tool calls and system messages are compact
  if (variant === "tool" || variant === "compact" || variant === "system") {
    return Math.min(rows + chrome, 6);
  }
  return rows + chrome;
}

// ---------------------------------------------------------------------------
// Height cache — keyed by (id, contentLength) to avoid re-estimation
// ---------------------------------------------------------------------------

// Cache: messageId → { contentLen, height }
const heightCache = new Map<string, { contentLen: number; height: number }>();

export function getCachedHeight(
  id: string,
  content: string,
  terminalWidth: number,
  variant?: string,
): number {
  const contentLen = content.length;
  const cached = heightCache.get(id);
  if (cached && cached.contentLen === contentLen) return cached.height;

  const height = estimateMessageHeight(content, terminalWidth, variant);
  heightCache.set(id, { contentLen, height });

  if (heightCache.size > 500) {
    // Evict oldest entry
    const firstKey = heightCache.keys().next().value;
    if (firstKey) heightCache.delete(firstKey);
  }
  return height;
}

/**
 * Called after render to update the height cache with actual Yoga-measured heights.
 * Only updates entries where the measured height differs from the estimate.
 */
export function reportMeasuredHeight(id: string, measuredHeight: number): void {
  const cached = heightCache.get(id);
  if (cached && cached.height !== measuredHeight) {
    heightCache.set(id, { contentLen: cached.contentLen, height: measuredHeight });
  }
}

// ---------------------------------------------------------------------------
// Binary search helpers
// ---------------------------------------------------------------------------

/**
 * Returns the index of the first item whose top edge is at or above scrollTop.
 * offsets[i] = cumulative row height before item i.
 */
function findFirstVisible(offsets: number[], scrollTop: number): number {
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid]! <= scrollTop) lo = mid + 1;
    else hi = mid;
  }
  return Math.max(0, lo - 1);
}

/**
 * Returns the index of the last item whose top edge is within the viewport bottom.
 */
function findLastVisible(offsets: number[], scrollTop: number, viewportHeight: number): number {
  const bottom = scrollTop + viewportHeight;
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid]! <= bottom) lo = mid;
    else hi = mid - 1;
  }
  return Math.min(offsets.length - 2, lo);
}

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface VirtualScrollItem {
  id: string;
  content: string;
  variant?: string;
}

export interface VirtualScrollOptions {
  items: VirtualScrollItem[];
  viewportHeight: number;
  /** Terminal column width for line-wrap estimation (default 80) */
  terminalWidth?: number;
}

export interface VirtualScrollResult {
  /** First item index to render (inclusive) */
  startIndex: number;
  /** Last item index to render (exclusive) */
  endIndex: number;
  /** Current scroll offset in rows (may be clamped) */
  scrollTop: number;
  /** Whether the viewport is scrolled to the bottom */
  isAtBottom: boolean;
  /** Jump to the very bottom */
  scrollToBottom: () => void;
  /** Jump to a specific item index */
  scrollTo: (index: number) => void;
  /** Apply a delta (positive = down, negative = up) */
  onScroll: (delta: number) => void;
  /** Total scrollable height in rows */
  totalHeight: number;
  /** Cumulative row offset for item i (top of item i) */
  getItemTop: (index: number) => number;
  /** Estimated height of item i in rows */
  getItemHeight: (index: number) => number;
}

// ---------------------------------------------------------------------------
// Scroll store — useSyncExternalStore-compatible external state
// ---------------------------------------------------------------------------

interface ScrollStore {
  subscribe: (cb: () => void) => () => void;
  getSnapshot: () => number; // returns quantized bucket
  setScrollTop: (top: number, max: number) => void;
  getRaw: () => number;
}

function createScrollStore(initialRaw: number): ScrollStore {
  let raw = initialRaw;
  let bucket = Math.floor(initialRaw / SCROLL_QUANTUM);
  const subs = new Set<() => void>();
  return {
    subscribe(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    getSnapshot() {
      return bucket;
    },
    setScrollTop(top, max) {
      raw = Math.max(0, Math.min(top, max));
      const b = Math.floor(raw / SCROLL_QUANTUM);
      if (b !== bucket) {
        bucket = b;
        subs.forEach((fn) => {
          fn();
        });
      }
    },
    getRaw() {
      return raw;
    },
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useVirtualScroll({
  items,
  viewportHeight,
  terminalWidth = 80,
}: VirtualScrollOptions): VirtualScrollResult {
  // store drives React re-renders — notifies subscribers only when the
  // quantized bucket changes (every SCROLL_QUANTUM rows). Raw position is
  // read directly from store.getRaw() so intermediate values are free.
  const store = useRef<ScrollStore | null>(null);
  if (!store.current) store.current = createScrollStore(Number.MAX_SAFE_INTEGER);
  useSyncExternalStore(store.current.subscribe, store.current.getSnapshot);

  // Build cumulative offsets array: offsets[i] = sum of heights[0..i-1]
  const offsets = useMemo(() => {
    const arr = new Array<number>(items.length + 1);
    arr[0] = 0;
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      const h = getCachedHeight(item.id, item.content, terminalWidth, item.variant);
      arr[i + 1] = arr[i]! + h;
    }
    return arr;
    // items identity changes whenever content changes (VirtualMessageList recreates array)
  }, [items, terminalWidth]);

  const totalHeight = offsets[items.length] ?? 0;
  const maxScrollTop = Math.max(0, totalHeight - viewportHeight);

  // Clamp raw scroll position on each render pass (maxScrollTop may have shrunk)
  const clampedTop = Math.max(0, Math.min(store.current.getRaw(), maxScrollTop));

  // Compute visible range with row-based overscan
  let startIndex = findFirstVisible(offsets, Math.max(0, clampedTop - OVERSCAN_ROWS));
  let endIndex = findLastVisible(offsets, clampedTop, viewportHeight + OVERSCAN_ROWS) + 1;

  // Cap to MAX_MOUNTED_ITEMS to prevent excessive DOM nodes
  if (endIndex - startIndex > MAX_MOUNTED_ITEMS) {
    endIndex = startIndex + MAX_MOUNTED_ITEMS;
  }

  // Clamp to valid item range
  startIndex = Math.max(0, startIndex);
  endIndex = Math.min(items.length, endIndex);

  const isAtBottom = clampedTop >= maxScrollTop - 1;

  const onScroll = useCallback(
    (delta: number) => {
      store.current!.setScrollTop(store.current!.getRaw() + delta, maxScrollTop);
    },
    [maxScrollTop],
  );

  const scrollToBottom = useCallback(() => {
    store.current!.setScrollTop(maxScrollTop, maxScrollTop);
  }, [maxScrollTop]);

  const scrollTo = useCallback(
    (index: number) => {
      const target = Math.max(0, Math.min(offsets[index] ?? 0, maxScrollTop));
      store.current!.setScrollTop(target, maxScrollTop);
    },
    [offsets, maxScrollTop],
  );

  const getItemTop = useCallback((index: number) => offsets[index] ?? 0, [offsets]);

  const getItemHeight = useCallback(
    (index: number) => {
      const item = items[index];
      if (!item) return 3;
      return getCachedHeight(item.id, item.content, terminalWidth, item.variant);
    },
    [items, terminalWidth],
  );

  return useMemo(
    () => ({
      startIndex,
      endIndex,
      scrollTop: clampedTop,
      isAtBottom,
      scrollToBottom,
      scrollTo,
      onScroll,
      totalHeight,
      getItemTop,
      getItemHeight,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      startIndex,
      endIndex,
      clampedTop,
      isAtBottom,
      scrollToBottom,
      scrollTo,
      onScroll,
      totalHeight,
      getItemTop,
      getItemHeight,
    ],
  );
}

// ============================================================================
// Keyboard scroll actions — map key presses to onScroll deltas
// ============================================================================

export interface ScrollKeyAction {
  key: string;
  delta: number | "top" | "bottom" | "pageUp" | "pageDown";
}

/**
 * Returns the scroll action for a given key press, or null if not a scroll key.
 * Intended to be called from a useInput handler.
 *
 * NOTE: itemHeight parameter kept for backwards compatibility with callers that
 * pass it (e.g. VirtualMessageList). It is used as the single-line scroll step.
 */
export function getScrollAction(
  input: string,
  key: { shift?: boolean; ctrl?: boolean },
  viewportHeight: number,
  itemHeight: number,
): ScrollKeyAction | null {
  // j = scroll down one item
  if (input === "j") return { key: "j", delta: itemHeight };
  // k = scroll up one item
  if (input === "k") return { key: "k", delta: -itemHeight };
  // G = jump to bottom
  if (input === "G") return { key: "G", delta: "bottom" };
  // g = jump to top
  if (input === "g") return { key: "g", delta: "top" };
  // Page down (Ctrl+D or Page Down concept)
  if (key.ctrl && input === "d") return { key: "ctrl+d", delta: viewportHeight };
  // Page up (Ctrl+U)
  if (key.ctrl && input === "u") return { key: "ctrl+u", delta: -viewportHeight };

  return null;
}
