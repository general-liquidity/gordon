/**
 * Ranked Self-History Recall
 *
 * Runs the EXISTING hybrid retrieval stack (BM25-lite + TF-IDF + temporal decay
 * + MMR — src/infra/memory/hybrid) over records produced by the self-history
 * ingestion adapter, then attaches provenance to every hit:
 *   - `whyMatched`: the query terms that hit + a recency note (explainability)
 *   - `citation`:   sessionId + messageIndex cursor to jump back to the exact turn
 *
 * This is the ranked, provenance-carrying replacement for `searchChatHistory`'s
 * unranked substring scan.
 */

import { hybridSearch, type MemoryEntry, type HybridSearchConfig } from "../hybrid/search.ts";
import { refreshIndex, type RefreshOptions, type SessionRecord } from "./ingest.ts";

/** A citation cursor back to the exact past-session turn. */
export interface SessionCitation {
  sessionId: string;
  messageIndex: number;
  /** ISO timestamp of the cited message, or null if unknown. */
  timestamp: string | null;
}

export interface SessionRecallHit {
  sessionId: string;
  messageIndex: number;
  role: string;
  agent?: string;
  /** The matched message text (optionally truncated to `snippetChars`). */
  content: string;
  timestamp: number | null;
  /** Hybrid relevance score (higher = better). */
  score: number;
  /** Human-readable reasons this record matched — terms hit + recency. */
  whyMatched: string[];
  citation: SessionCitation;
}

export interface RecallOptions extends RefreshOptions {
  /** Max hits to return. Default 5. */
  limit?: number;
  /** Truncate returned message content to this many chars. Default 400. */
  snippetChars?: number;
  /** Override hybrid-search config (weights, decay, MMR, as-of bound). */
  hybrid?: Partial<HybridSearchConfig>;
}

const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "must", "can", "this", "that", "these",
  "those", "i", "you", "he", "she", "it", "we", "they", "what", "which",
  "who", "when", "where", "why", "how", "and", "but", "or", "nor", "for",
  "yet", "so", "at", "by", "in", "on", "to", "with", "of", "from",
]);

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9_]+/g) ?? []).filter(
    (t) => t.length > 1 && !STOPWORDS.has(t),
  );
}

function recencyNote(timestamp: number | null): string | null {
  if (timestamp === null) return null;
  const ms = Date.now() - timestamp;
  if (ms < 0) return null;
  const days = Math.floor(ms / 86_400_000);
  if (days <= 0) return "recency: today";
  if (days < 30) return `recency: ${days}d ago`;
  const months = Math.floor(days / 30);
  return `recency: ${months}mo ago`;
}

/**
 * Build the `whyMatched` reasons for a hit: which query terms appear in the
 * record, plus a recency note. Deterministic, order-preserving over the query.
 */
function buildWhyMatched(query: string, record: SessionRecord): string[] {
  const queryTerms = tokenize(query);
  const contentTerms = new Set(tokenize(record.content));
  const seen = new Set<string>();
  const hits: string[] = [];
  for (const t of queryTerms) {
    if (contentTerms.has(t) && !seen.has(t)) {
      seen.add(t);
      hits.push(t);
    }
  }
  const reasons: string[] = [];
  if (hits.length > 0) reasons.push(`matched terms: ${hits.join(", ")}`);
  else reasons.push("matched on semantic similarity");
  const recency = recencyNote(record.timestamp);
  if (recency) reasons.push(recency);
  reasons.push(`from session ${record.sessionId}`);
  return reasons;
}

/**
 * Search Gordon's own past chat sessions with ranked, provenance-carrying
 * recall. Incrementally refreshes the staleness catalog first (only changed
 * session files are re-parsed), then ranks with the existing hybrid stack.
 */
export function searchSessionHistory(query: string, options: RecallOptions = {}): SessionRecallHit[] {
  const limit = options.limit ?? 5;
  const snippetChars = options.snippetChars ?? 400;

  const refreshOpts: RefreshOptions = {};
  if (options.historyDir !== undefined) refreshOpts.historyDir = options.historyDir;
  if (options.indexDir !== undefined) refreshOpts.indexDir = options.indexDir;
  const { records } = refreshIndex(refreshOpts);
  if (records.length === 0) return [];

  const byId = new Map<string, SessionRecord>(records.map((r) => [r.id, r]));
  const entries: MemoryEntry[] = records.map((r) => ({
    id: r.id,
    content: r.content,
    timestamp: r.timestamp,
  }));

  const ranked = hybridSearch(query, entries, { ...options.hybrid, limit });

  const hits: SessionRecallHit[] = [];
  for (const result of ranked) {
    const record = byId.get(result.id);
    if (!record) continue;
    const content =
      record.content.length > snippetChars
        ? `${record.content.slice(0, snippetChars)}…`
        : record.content;
    hits.push({
      sessionId: record.sessionId,
      messageIndex: record.messageIndex,
      role: record.role,
      ...(record.agent ? { agent: record.agent } : {}),
      content,
      timestamp: record.timestamp,
      score: Math.round(result.score * 1000) / 1000,
      whyMatched: buildWhyMatched(query, record),
      citation: {
        sessionId: record.sessionId,
        messageIndex: record.messageIndex,
        timestamp: record.timestamp !== null ? new Date(record.timestamp).toISOString() : null,
      },
    });
  }
  return hits;
}
