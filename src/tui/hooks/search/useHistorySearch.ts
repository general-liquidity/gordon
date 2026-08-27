import { useState, useMemo, useCallback } from "react";

// ============================================================================
// useHistorySearch — Ctrl+R reverse incremental search through command history
// ============================================================================

export function useHistorySearch(entries: string[]) {
  const [isActive, setIsActive] = useState(false);
  const [query, setQuery] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);

  const matches = useMemo(() => {
    if (!query) return entries;
    const lower = query.toLowerCase();
    return entries.filter((e) => e.toLowerCase().includes(lower));
  }, [entries, query]);

  const matchedEntry = matches[matchIndex] ?? null;

  const nextMatch = useCallback(() => {
    setMatchIndex((prev) => (prev + 1) % Math.max(1, matches.length));
  }, [matches.length]);

  const prevMatch = useCallback(() => {
    setMatchIndex((prev) => (prev - 1 + matches.length) % Math.max(1, matches.length));
  }, [matches.length]);

  const accept = useCallback((): string => {
    const entry = matchedEntry ?? "";
    setIsActive(false);
    setQuery("");
    setMatchIndex(0);
    return entry;
  }, [matchedEntry]);

  const cancel = useCallback(() => {
    setIsActive(false);
    setQuery("");
    setMatchIndex(0);
  }, []);

  const activate = useCallback(() => {
    setIsActive(true);
    setQuery("");
    setMatchIndex(0);
  }, []);

  return {
    isActive,
    query,
    setQuery,
    matchedEntry,
    matchIndex,
    matchCount: matches.length,
    nextMatch,
    prevMatch,
    accept,
    cancel,
    activate,
  };
}
