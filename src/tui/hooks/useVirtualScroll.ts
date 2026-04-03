import { useState, useCallback, useMemo } from "react";

// ============================================================================
// useVirtualScroll — Viewport culling for large message lists
//
// Computes visible range from scrollTop + viewport dimensions.
// Supports keyboard navigation: j/k, Page Up/Down, G/g.
// ============================================================================

export interface VirtualScrollOptions {
  totalItems: number;
  viewportHeight: number;
  itemHeight?: number;   // default 3 (badge + content + margin)
  overscan?: number;     // extra items above/below viewport, default 3
}

export interface VirtualScrollResult {
  /** First item index to render (inclusive) */
  startIndex: number;
  /** Last item index to render (exclusive) */
  endIndex: number;
  /** Current scroll offset in rows */
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
}

export function useVirtualScroll({
  totalItems,
  viewportHeight,
  itemHeight = 3,
  overscan = 3,
}: VirtualScrollOptions): VirtualScrollResult {
  const [scrollTop, setScrollTop] = useState(0);

  const totalHeight = totalItems * itemHeight;
  const maxScrollTop = Math.max(0, totalHeight - viewportHeight);

  // Clamp helper
  const clamp = useCallback(
    (value: number) => Math.max(0, Math.min(value, maxScrollTop)),
    [maxScrollTop],
  );

  // Visible range (before overscan)
  const rawStartIndex = Math.floor(scrollTop / itemHeight);
  const visibleCount = Math.ceil(viewportHeight / itemHeight);
  const rawEndIndex = rawStartIndex + visibleCount;

  // Apply overscan
  const startIndex = Math.max(0, rawStartIndex - overscan);
  const endIndex = Math.min(totalItems, rawEndIndex + overscan);

  const isAtBottom = scrollTop >= maxScrollTop;

  const scrollToBottom = useCallback(() => {
    setScrollTop(maxScrollTop);
  }, [maxScrollTop]);

  const scrollTo = useCallback(
    (index: number) => {
      const target = clamp(index * itemHeight);
      setScrollTop(target);
    },
    [clamp, itemHeight],
  );

  const onScroll = useCallback(
    (delta: number) => {
      setScrollTop((prev) => clamp(prev + delta));
    },
    [clamp],
  );

  return useMemo(
    () => ({
      startIndex,
      endIndex,
      scrollTop,
      isAtBottom,
      scrollToBottom,
      scrollTo,
      onScroll,
      totalHeight,
    }),
    [startIndex, endIndex, scrollTop, isAtBottom, scrollToBottom, scrollTo, onScroll, totalHeight],
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
 * Intended to be called from useInput handler.
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
