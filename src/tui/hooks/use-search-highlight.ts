/**
 * use-search-highlight — Returns character ranges within `text` where
 * `query` matches (case-insensitive).
 *
 * Returns an empty array when:
 *   - query is empty or fewer than 2 characters
 *   - text is empty
 *
 * All matches are non-overlapping; the search advances past each match.
 */

import { useMemo } from "react";

// ============================================================================
// Types
// ============================================================================

export interface HighlightRange {
  start: number;
  end: number;
}

// ============================================================================
// Pure helper (exported for use in non-hook contexts)
// ============================================================================

/**
 * Find all non-overlapping case-insensitive matches of `query` in `text`.
 * Returns an array of { start, end } index ranges (end is exclusive).
 */
export function findHighlightRanges(
  text: string,
  query: string,
): HighlightRange[] {
  if (!query || query.length < 2 || !text) return [];

  const ranges: HighlightRange[] = [];
  const lower = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const queryLen = lowerQuery.length;

  let offset = 0;
  while (offset < lower.length) {
    const idx = lower.indexOf(lowerQuery, offset);
    if (idx === -1) break;
    ranges.push({ start: idx, end: idx + queryLen });
    offset = idx + queryLen; // advance past this match (non-overlapping)
  }

  return ranges;
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Returns highlight ranges within `text` where `query` appears.
 * Memoised — only recomputes when text or query changes.
 *
 * @example
 * const ranges = useSearchHighlight("BTC/USDT on Binance", "binance");
 * // [{ start: 10, end: 17 }]
 */
export function useSearchHighlight(
  text: string,
  query: string,
): HighlightRange[] {
  return useMemo(() => findHighlightRanges(text, query), [text, query]);
}
