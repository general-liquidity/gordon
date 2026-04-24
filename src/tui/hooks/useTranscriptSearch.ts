import { useState, useMemo, useCallback, useRef } from "react";
import type { Message } from "../components/MessageBubble.js";

export interface SearchMatch {
  messageId: string;
  messageIndex: number;   // index in the messages array
  startOffset: number;    // char offset within content
  endOffset: number;
}

export interface TranscriptSearchResult {
  query: string;
  setQuery: (q: string) => void;
  matches: SearchMatch[];
  currentMatchIndex: number;     // -1 when no matches
  currentMatch: SearchMatch | null;
  navigateNext: () => void;
  navigatePrev: () => void;
  clearSearch: () => void;
  isActive: boolean;             // true when query.length > 0
}

// ─── Bitmap pre-filter (B2) ──────────────────────────────────────────────────
//
// For 26 lowercase letters we OR (1 << (charCode - 'a')) for every unique
// letter present in either the query or the message content. If the query's
// bitmap shares fewer bits with the message's than the query needs, the message
// is GUARANTEED not to match — skip the indexOf entirely.
//
// Necessary, not sufficient — survivors still go through indexOf.
// Cheap to compute (single pass), cheap to test (one AND + compare).
// Expected speedup: 5-10x on transcripts where most messages don't share the
// query's letter set.

const A_CHAR = "a".charCodeAt(0);
const Z_CHAR = "z".charCodeAt(0);

/** Compute a 26-bit bitmap of unique [a-z] letters in the input. */
export function computeLetterBitmap(input: string): number {
  let mask = 0;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    let lower = c;
    // Fast lowercase for ASCII: A-Z → a-z
    if (c >= 65 && c <= 90) lower = c + 32;
    if (lower >= A_CHAR && lower <= Z_CHAR) {
      mask |= 1 << (lower - A_CHAR);
      // Early-out micro-opt: once all 26 bits set, no further work needed.
      if (mask === 0x3FFFFFF) return mask;
    }
  }
  return mask;
}

/** True iff the message bitmap could plausibly contain the query bitmap. */
export function bitmapCouldContain(messageBitmap: number, queryBitmap: number): boolean {
  // Necessary condition: every bit set in query must be set in message.
  return (messageBitmap & queryBitmap) === queryBitmap;
}

export function useTranscriptSearch(messages: Message[]): TranscriptSearchResult {
  const [query, setQueryRaw] = useState("");
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);

  // Cache message bitmaps keyed by message id. Messages are mostly immutable in
  // Gordon, so we keep entries until the cache exceeds a soft cap, then drop
  // ids no longer present in the current messages array.
  const bitmapCacheRef = useRef<Map<string, { bitmap: number; len: number }>>(new Map());

  const setQuery = useCallback((q: string) => {
    setQueryRaw(q);
    setCurrentMatchIndex(0);
  }, []);

  const matches = useMemo((): SearchMatch[] => {
    if (!query || query.length < 2) return [];
    const lower = query.toLowerCase();
    const queryBitmap = computeLetterBitmap(lower);

    const cache = bitmapCacheRef.current;
    const result: SearchMatch[] = [];
    const seenIds = new Set<string>();

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]!;
      seenIds.add(msg.id);

      // Bitmap pre-filter: skip messages that can't possibly contain the query.
      // We invalidate the cache entry when content length changes (a cheap
      // fingerprint) — content typically only grows during streaming, and once
      // a message is finalized its content never changes again.
      let entry = cache.get(msg.id);
      if (!entry || entry.len !== msg.content.length) {
        const bm = computeLetterBitmap(msg.content);
        entry = { bitmap: bm, len: msg.content.length };
        cache.set(msg.id, entry);
      }

      if (queryBitmap !== 0 && !bitmapCouldContain(entry.bitmap, queryBitmap)) {
        // Necessary condition fails — this message cannot contain the query.
        continue;
      }

      // Survived the bitmap pre-filter; confirm with indexOf.
      const content = msg.content.toLowerCase();
      let pos = 0;
      while (true) {
        const idx = content.indexOf(lower, pos);
        if (idx === -1) break;
        result.push({ messageId: msg.id, messageIndex: i, startOffset: idx, endOffset: idx + query.length });
        pos = idx + 1;
      }
    }

    // Soft GC: if the cache has grown well beyond the active message set,
    // drop entries whose ids no longer appear. Keeps memory bounded over long
    // sessions where messages get pruned by compaction.
    if (cache.size > messages.length * 2 + 64) {
      for (const id of cache.keys()) {
        if (!seenIds.has(id)) cache.delete(id);
      }
    }

    return result;
  }, [query, messages]);

  const safeIdx = matches.length > 0 ? Math.min(currentMatchIndex, matches.length - 1) : -1;
  const currentMatch = safeIdx >= 0 ? (matches[safeIdx] ?? null) : null;

  const navigateNext = useCallback(() => {
    if (matches.length === 0) return;
    setCurrentMatchIndex((prev) => (prev + 1) % matches.length);
  }, [matches.length]);

  const navigatePrev = useCallback(() => {
    if (matches.length === 0) return;
    setCurrentMatchIndex((prev) => (prev - 1 + matches.length) % matches.length);
  }, [matches.length]);

  const clearSearch = useCallback(() => {
    setQueryRaw("");
    setCurrentMatchIndex(0);
  }, []);

  return {
    query,
    setQuery,
    matches,
    currentMatchIndex: safeIdx,
    currentMatch,
    navigateNext,
    navigatePrev,
    clearSearch,
    isActive: query.length > 0,
  };
}
