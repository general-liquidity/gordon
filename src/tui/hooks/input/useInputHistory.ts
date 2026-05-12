/**
 * useInputHistory -- Circular input history buffer
 * Phase 9: Stores last 100 submitted inputs in memory.
 * Provides push / goUp / goDown / current navigation.
 */

import { useState, useCallback, useRef } from "react";

const MAX_HISTORY = 100;

export interface InputHistory {
  /** Add a new entry to history. Resets navigation index. */
  push: (value: string) => void;
  /** Navigate up (older). Returns the entry or undefined if at top. */
  goUp: () => string | undefined;
  /** Navigate down (newer). Returns the entry or undefined if past bottom. */
  goDown: () => string | undefined;
  /** The entry at the current navigation index, or undefined. */
  current: string | undefined;
  /** Reset navigation index without changing history. */
  reset: () => void;
  /** Current history entries (most recent last). */
  entries: string[];
}

export function useInputHistory(): InputHistory {
  const [entries, setEntries] = useState<string[]>([]);
  const indexRef = useRef<number>(-1);

  const push = useCallback((value: string) => {
    if (!value.trim()) return;
    setEntries((prev) => {
      // Deduplicate consecutive
      if (prev.length > 0 && prev[prev.length - 1] === value) return prev;
      const next = [...prev, value];
      if (next.length > MAX_HISTORY) next.shift();
      return next;
    });
    indexRef.current = -1;
  }, []);

  const goUp = useCallback((): string | undefined => {
    if (entries.length === 0) return undefined;
    if (indexRef.current === -1) {
      // Start from most recent
      indexRef.current = entries.length - 1;
    } else if (indexRef.current > 0) {
      indexRef.current--;
    }
    return entries[indexRef.current];
  }, [entries]);

  const goDown = useCallback((): string | undefined => {
    if (entries.length === 0 || indexRef.current === -1) return undefined;
    if (indexRef.current < entries.length - 1) {
      indexRef.current++;
      return entries[indexRef.current];
    }
    // Past the bottom -- return to current input
    indexRef.current = -1;
    return undefined;
  }, [entries]);

  const reset = useCallback(() => {
    indexRef.current = -1;
  }, []);

  // Derived current value based on index
  const current =
    indexRef.current >= 0 && indexRef.current < entries.length
      ? entries[indexRef.current]
      : undefined;

  return { push, goUp, goDown, current, reset, entries };
}
