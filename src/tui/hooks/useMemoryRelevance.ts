/**
 * useMemoryRelevance — Scan memory entries for relevant context
 *
 * Takes a query string (symbol, strategy name, or topic) and performs
 * keyword matching against all memory entries. Returns the top 5 most
 * relevant results ranked by match density. Intended for injecting
 * past observations into agent context at prompt time.
 *
 * Phase 18 of the TUI rebuild plan.
 */

import { useMemo } from "react";
import { useMemory, type MemoryEntry } from "../state/MemoryProvider.js";

// ============================================================================
// Types
// ============================================================================

export interface RelevanceResult {
  /** The matched memory entry */
  entry: MemoryEntry;
  /** Relevance score (higher = more relevant) */
  score: number;
  /** Which query terms were found in the entry */
  matchedTerms: string[];
}

// ============================================================================
// Constants
// ============================================================================

const MAX_RESULTS = 5;

/** Words too common to be useful for matching */
const STOP_WORDS: ReadonlySet<string> = new Set([
  "the",
  "a",
  "an",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "shall",
  "can",
  "of",
  "in",
  "to",
  "for",
  "with",
  "on",
  "at",
  "from",
  "by",
  "as",
  "it",
  "its",
  "this",
  "that",
  "and",
  "or",
  "but",
  "not",
  "no",
  "if",
  "so",
  "up",
  "out",
]);

// ============================================================================
// Scoring helpers
// ============================================================================

/**
 * Tokenize a query into meaningful lowercase terms, filtering stop words.
 */
function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9/\-_.]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));
}

/**
 * Build a searchable text blob from a memory entry.
 * Includes name, description, type, and content for comprehensive matching.
 */
function _buildSearchText(entry: MemoryEntry): string {
  return [entry.name, entry.description, entry.type, entry.content].join(" ").toLowerCase();
}

/**
 * Score a memory entry against a set of query terms.
 *
 * Scoring rules:
 * - +3 for each term found in the entry name (high signal)
 * - +2 for each term found in the description
 * - +1 for each term found in the content body
 * - Bonus: +1 for each additional occurrence in content (up to 3 extra per term)
 */
function scoreEntry(
  entry: MemoryEntry,
  terms: string[],
): { score: number; matchedTerms: string[] } {
  if (terms.length === 0) return { score: 0, matchedTerms: [] };

  const nameLower = entry.name.toLowerCase();
  const descLower = entry.description.toLowerCase();
  const contentLower = entry.content.toLowerCase();

  let score = 0;
  const matchedTerms: string[] = [];

  for (const term of terms) {
    let termScore = 0;

    // Name matches (highest weight)
    if (nameLower.includes(term)) {
      termScore += 3;
    }

    // Description matches
    if (descLower.includes(term)) {
      termScore += 2;
    }

    // Content matches with frequency bonus
    if (contentLower.includes(term)) {
      termScore += 1;
      // Count additional occurrences for density bonus (cap at 3 extra)
      const regex = new RegExp(escapeRegex(term), "gi");
      const occurrences = (entry.content.match(regex) ?? []).length;
      termScore += Math.min(occurrences - 1, 3);
    }

    if (termScore > 0) {
      score += termScore;
      matchedTerms.push(term);
    }
  }

  // Boost score if a higher proportion of query terms matched
  if (matchedTerms.length > 0) {
    const coverage = matchedTerms.length / terms.length;
    score *= 0.5 + coverage * 0.5;
  }

  return { score, matchedTerms };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Search all memory entries for content relevant to the given query.
 * Returns up to 5 results sorted by relevance score (descending).
 *
 * @param query - A symbol, strategy name, topic, or natural language phrase.
 *                Pass an empty string to get no results (avoids needless work).
 *
 * @example
 *   const results = useMemoryRelevance("BTC breakout strategy");
 *   // results: [{ entry, score, matchedTerms }, ...]
 */
export function useMemoryRelevance(query: string): RelevanceResult[] {
  const { memories } = useMemory();

  return useMemo(() => {
    const trimmed = query.trim();
    if (trimmed.length === 0 || memories.length === 0) return [];

    const terms = tokenize(trimmed);
    if (terms.length === 0) return [];

    const scored: RelevanceResult[] = [];

    for (const entry of memories) {
      const { score, matchedTerms } = scoreEntry(entry, terms);
      if (score > 0) {
        scored.push({ entry, score, matchedTerms });
      }
    }

    // Sort by score descending, then by last modified descending for ties
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return new Date(b.entry.lastModified).getTime() - new Date(a.entry.lastModified).getTime();
    });

    return scored.slice(0, MAX_RESULTS);
  }, [query, memories]);
}
