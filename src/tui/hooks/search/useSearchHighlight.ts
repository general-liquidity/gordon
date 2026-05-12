import { useState, useMemo, useCallback } from "react";
import { TranscriptSearchEngine } from "../../utils/transcriptSearch.js";

// ============================================================================
// useSearchHighlight — Manages search state for transcript highlighting
// ============================================================================

interface Message { id?: string; content?: string; role?: string; }

export function useSearchHighlight(messages: Message[]) {
  const [query, setQuery] = useState("");
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);

  const engine = useMemo(() => {
    const e = new TranscriptSearchEngine();
    e.setMessages(messages);
    return e;
  }, [messages]);

  const totalMatches = useMemo(() => engine.getMatchCount(query), [engine, query]);

  const nextMatch = useCallback(() => {
    if (!query) return;
    const next = engine.nextMatch(currentMatchIndex, query);
    if (next >= 0) setCurrentMatchIndex(next);
  }, [engine, query, currentMatchIndex]);

  const prevMatch = useCallback(() => {
    if (!query) return;
    const prev = engine.prevMatch(currentMatchIndex, query);
    if (prev >= 0) setCurrentMatchIndex(prev);
  }, [engine, query, currentMatchIndex]);

  const clearSearch = useCallback(() => {
    setQuery("");
    setCurrentMatchIndex(0);
  }, []);

  return {
    query, setQuery, currentMatchIndex, totalMatches,
    nextMatch, prevMatch, clearSearch,
    isSearchActive: query.length > 0,
  };
}
