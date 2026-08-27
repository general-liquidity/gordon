import type React from "react";
import { useState, useEffect, useCallback } from "react";
import type { ScrollBoxHandle } from "../../components/layout/ScrollBox.js";

// ============================================================================
// useScrollBox — Convenience hook for consuming ScrollBox's subscribe API
//
// Subscribes to a ScrollBoxHandle ref and returns reactive scroll state
// along with stable action helpers.
// ============================================================================

export function useScrollBox(ref: React.RefObject<ScrollBoxHandle>): {
  scrollTop: number;
  isAtBottom: boolean;
  scrollToBottom: () => void;
  scrollTo: (y: number) => void;
} {
  const [scrollTop, setScrollTop] = useState(0);

  useEffect(() => {
    const handle = ref.current;
    if (!handle) return;

    // Sync initial value
    setScrollTop(handle.getScrollTop());

    // Subscribe to future changes
    const unsubscribe = handle.subscribe((newScrollTop) => {
      setScrollTop(newScrollTop);
    });

    return unsubscribe;
  }, [ref]);

  const scrollToBottom = useCallback(() => {
    ref.current?.scrollToBottom();
  }, [ref]);

  const scrollTo = useCallback(
    (y: number) => {
      ref.current?.scrollTo(y);
    },
    [ref],
  );

  const isAtBottom = ref.current?.isAtBottom() ?? true;

  return {
    scrollTop,
    isAtBottom,
    scrollToBottom,
    scrollTo,
  };
}
