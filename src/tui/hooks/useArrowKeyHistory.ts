/**
 * useArrowKeyHistory — Up/Down arrow input navigation
 *
 * Stores the last N submitted inputs and provides navigation via
 * arrow keys. Up moves to older entries, Down to newer ones.
 * Reaching past the newest entry returns to the draft (empty string).
 *
 * Phase 3 of the 100% parity plan.
 */

import { useState, useCallback, useRef } from "react";

const DEFAULT_MAX_ENTRIES = 50;

export interface ArrowKeyHistoryResult {
  /** Add a submitted input to the history buffer. Resets navigation index. */
  push: (value: string) => void;
  /** Navigate up (older). Returns the entry text. */
  goUp: () => string;
  /** Navigate down (newer). Returns the entry text or empty string if past end. */
  goDown: () => string;
  /** The entry at the current navigation index, or empty string. */
  current: string;
  /** Reset navigation without clearing history. */
  resetIndex: () => void;
  /** All stored entries (oldest first). */
  entries: readonly string[];
  /** Current navigation index (-1 = no navigation / draft). */
  index: number;
}

export function useArrowKeyHistory(
  maxEntries: number = DEFAULT_MAX_ENTRIES,
): ArrowKeyHistoryResult {
  const [entries, setEntries] = useState<string[]>([]);
  const indexRef = useRef<number>(-1);
  const [, forceRender] = useState(0);

  const push = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) return;
      setEntries((prev) => {
        // Deduplicate: skip if identical to the most recent entry
        if (prev.length > 0 && prev[prev.length - 1] === trimmed) return prev;
        const next = [...prev, trimmed];
        if (next.length > maxEntries) next.shift();
        return next;
      });
      indexRef.current = -1;
    },
    [maxEntries],
  );

  const goUp = useCallback((): string => {
    if (entries.length === 0) return "";
    if (indexRef.current === -1) {
      // Start from most recent
      indexRef.current = entries.length - 1;
    } else if (indexRef.current > 0) {
      indexRef.current--;
    }
    forceRender((n) => n + 1);
    return entries[indexRef.current] ?? "";
  }, [entries]);

  const goDown = useCallback((): string => {
    if (entries.length === 0) return "";
    if (indexRef.current === -1) return "";
    if (indexRef.current < entries.length - 1) {
      indexRef.current++;
      forceRender((n) => n + 1);
      return entries[indexRef.current] ?? "";
    }
    // Past the newest entry — return to draft
    indexRef.current = -1;
    forceRender((n) => n + 1);
    return "";
  }, [entries]);

  const resetIndex = useCallback(() => {
    indexRef.current = -1;
    forceRender((n) => n + 1);
  }, []);

  const current = indexRef.current >= 0
    ? entries[indexRef.current] ?? ""
    : "";

  return {
    push,
    goUp,
    goDown,
    current,
    resetIndex,
    entries,
    index: indexRef.current,
  };
}
