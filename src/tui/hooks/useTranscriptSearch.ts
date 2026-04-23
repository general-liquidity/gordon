import { useState, useMemo, useCallback } from "react";
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

export function useTranscriptSearch(messages: Message[]): TranscriptSearchResult {
  const [query, setQueryRaw] = useState("");
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);

  const setQuery = useCallback((q: string) => {
    setQueryRaw(q);
    setCurrentMatchIndex(0);
  }, []);

  const matches = useMemo((): SearchMatch[] => {
    if (!query || query.length < 2) return [];
    const lower = query.toLowerCase();
    const result: SearchMatch[] = [];
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]!;
      const content = msg.content.toLowerCase();
      let pos = 0;
      while (true) {
        const idx = content.indexOf(lower, pos);
        if (idx === -1) break;
        result.push({ messageId: msg.id, messageIndex: i, startOffset: idx, endOffset: idx + query.length });
        pos = idx + 1;
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
