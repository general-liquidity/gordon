import React, { useState, useCallback, useImperativeHandle, useRef, forwardRef, type ReactNode } from "react";
import { Box } from "ink";

// ============================================================================
// ScrollBox — Scroll container with imperative API
//
// Provides scrollTo, scrollBy, scrollToBottom, isAtBottom, and subscribe.
// stickyScroll auto-pins to bottom on new content when already at bottom.
// ============================================================================

export interface ScrollBoxHandle {
  scrollTo: (y: number) => void;
  scrollBy: (delta: number) => void;
  scrollToBottom: () => void;
  isAtBottom: () => boolean;
  getScrollTop: () => number;
}

interface Props {
  height: number;
  stickyScroll?: boolean;
  onScroll?: (scrollTop: number) => void;
  children: ReactNode;
  totalContentHeight?: number;
}

export const ScrollBox = forwardRef<ScrollBoxHandle, Props>(function ScrollBox(
  { height, stickyScroll = true, onScroll, children, totalContentHeight = 0 },
  ref,
) {
  const [scrollTop, setScrollTop] = useState(0);
  const wasAtBottomRef = useRef(true);

  const maxScroll = Math.max(0, totalContentHeight - height);

  const clamp = useCallback(
    (value: number) => Math.max(0, Math.min(value, maxScroll)),
    [maxScroll],
  );

  const updateScroll = useCallback(
    (newValue: number) => {
      const clamped = clamp(newValue);
      setScrollTop(clamped);
      wasAtBottomRef.current = clamped >= maxScroll;
      onScroll?.(clamped);
    },
    [clamp, maxScroll, onScroll],
  );

  useImperativeHandle(ref, () => ({
    scrollTo: (y: number) => updateScroll(y),
    scrollBy: (delta: number) => updateScroll(scrollTop + delta),
    scrollToBottom: () => updateScroll(maxScroll),
    isAtBottom: () => scrollTop >= maxScroll,
    getScrollTop: () => scrollTop,
  }));

  // Sticky scroll: if was at bottom and content grew, snap immediately
  // No setTimeout — direct state update to avoid one-frame flash (Claude Code pattern)
  if (stickyScroll && wasAtBottomRef.current && scrollTop < maxScroll && maxScroll > 0) {
    // Use useEffect-free approach: update ref directly, render with correct value
    const correctedScrollTop = maxScroll;
    if (correctedScrollTop !== scrollTop) {
      // Schedule for next microtask to avoid setState during render
      queueMicrotask(() => updateScroll(correctedScrollTop));
    }
  }

  return (
    <Box flexDirection="column" height={height} overflow="hidden">
      <Box flexDirection="column" marginTop={-scrollTop}>
        {children}
      </Box>
    </Box>
  );
});
