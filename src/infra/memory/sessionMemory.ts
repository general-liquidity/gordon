/**
 * Session Memory Auto-Extraction
 *
 * Automatically extracts durable facts from conversations and persists them
 * across sessions. Runs before compaction to preserve user preferences, risk
 * rules, strategy decisions, and trade rationale that would otherwise be lost.
 *
 * Claude Code pattern: `extractMemories` service proactively surfaces facts
 * from conversations and stores them in persistent memory. Separate from
 * conversation compaction — memories survive across sessions.
 *
 * Extraction categories (trading-specific):
 *   - Risk preferences (max loss, position sizing, leverage rules)
 *   - Strategy preferences (swing vs day, crypto vs equities)
 *   - Venue preferences (preferred exchange, broker)
 *   - Explicit exclusions (no meme coins, no leverage, etc.)
 *   - Trade rationale (why a decision was made — audit value)
 *   - Lessons learned (post-trade reflections)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { GORDON_DIR } from "../storage/paths.ts";

// ============================================================================
// Types
// ============================================================================

export interface SessionMemoryEntry {
  id: string;
  category: SessionMemoryCategory;
  content: string;
  /** ISO timestamp when extracted. */
  extractedAt: string;
  /** Session ID where this was extracted from. */
  sessionId?: string;
  /** Confidence score (0-1) from extraction. */
  confidence?: number;
  /** If superseded by a newer entry, this points to the replacement. */
  supersededBy?: string;
}

export type SessionMemoryCategory =
  | "risk_preference"
  | "strategy_preference"
  | "venue_preference"
  | "exclusion"
  | "trade_rationale"
  | "lesson_learned"
  | "user_fact"
  | "general";

export interface ExtractionPrompt {
  systemPrompt: string;
  userPrompt: string;
}

// ============================================================================
// Storage
// ============================================================================

const MEMORY_DIR = join(GORDON_DIR, "session-memory");
const MEMORY_FILE = join(MEMORY_DIR, "memories.json");

function ensureDir(): void {
  if (!existsSync(MEMORY_DIR)) mkdirSync(MEMORY_DIR, { recursive: true });
}

export function loadSessionMemories(): SessionMemoryEntry[] {
  if (!existsSync(MEMORY_FILE)) return [];
  try {
    return JSON.parse(readFileSync(MEMORY_FILE, "utf-8")) as SessionMemoryEntry[];
  } catch {
    return [];
  }
}

export function saveSessionMemories(entries: SessionMemoryEntry[]): void {
  ensureDir();
  writeFileSync(MEMORY_FILE, JSON.stringify(entries, null, 2), { encoding: "utf-8", mode: 0o600 });
}

export function addSessionMemory(
  entry: Omit<SessionMemoryEntry, "id" | "extractedAt">,
): SessionMemoryEntry {
  const memories = loadSessionMemories();
  const newEntry: SessionMemoryEntry = {
    ...entry,
    id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    extractedAt: new Date().toISOString(),
  };

  // Check for duplicate/superseded entries in same category
  const existing = memories.find(
    (m) => m.category === entry.category && m.content === entry.content && !m.supersededBy,
  );
  if (existing) return existing; // Exact duplicate — skip

  memories.push(newEntry);
  saveSessionMemories(memories);
  return newEntry;
}

/**
 * Mark an entry as superseded (e.g., user changed their risk tolerance).
 */
export function supersede(oldId: string, newId: string): void {
  const memories = loadSessionMemories();
  const old = memories.find((m) => m.id === oldId);
  if (old) {
    old.supersededBy = newId;
    saveSessionMemories(memories);
  }
}

/** Normalize content for duplicate detection — case/whitespace-insensitive. */
function normalizeContent(content: string): string {
  return content.toLowerCase().replace(/\s+/g, " ").trim();
}

export interface DedupeResult {
  /** Number of entries newly marked superseded by this pass. */
  superseded: number;
  /** Number of active (non-superseded) entries that remain after the pass. */
  remaining: number;
}

/**
 * Consolidate superseded/duplicate facts in the session-memory store.
 *
 * Within each category, entries whose normalized content collides are treated
 * as restatements of the same fact (e.g. "max 2% per trade" logged across three
 * sessions). The NEWEST entry (by extractedAt) wins; older collisions are
 * pointed at it via the existing `supersededBy` pointer — non-destructive,
 * reusing the same supersede semantics the manual paths already perform. No
 * entry is deleted; superseded entries simply drop out of `getActiveMemories`.
 *
 * This is the consolidation half autoDream drives: it does NOT invent a parallel
 * store — it curates the categorized JSON store in place. Idempotent: a second
 * pass over an already-deduped store supersedes nothing.
 *
 * Returns counts for caller logging. Safe to call when the store is empty.
 */
export function dedupeSessionMemories(): DedupeResult {
  const memories = loadSessionMemories();
  const active = memories.filter((m) => !m.supersededBy);

  // Group active entries by (category, normalized content). Keep the newest as
  // the survivor; supersede the rest to point at it.
  const groups = new Map<string, SessionMemoryEntry[]>();
  for (const m of active) {
    const key = `${m.category}::${normalizeContent(m.content)}`;
    const list = groups.get(key);
    if (list) list.push(m);
    else groups.set(key, [m]);
  }

  let superseded = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    // Newest survives — sort descending by extraction time.
    group.sort((a, b) => new Date(b.extractedAt).getTime() - new Date(a.extractedAt).getTime());
    const survivor = group[0]!;
    for (let i = 1; i < group.length; i++) {
      group[i]!.supersededBy = survivor.id;
      superseded += 1;
    }
  }

  if (superseded > 0) saveSessionMemories(memories);
  return {
    superseded,
    remaining: memories.filter((m) => !m.supersededBy).length,
  };
}

/**
 * Get active (non-superseded) memories, optionally filtered by category.
 */
export function getActiveMemories(category?: SessionMemoryCategory): SessionMemoryEntry[] {
  return loadSessionMemories().filter(
    (m) => !m.supersededBy && (!category || m.category === category),
  );
}

/**
 * Search memories by keyword (simple substring match).
 */
export function searchMemories(query: string): SessionMemoryEntry[] {
  const lower = query.toLowerCase();
  return getActiveMemories().filter((m) => m.content.toLowerCase().includes(lower));
}

// ============================================================================
// Extraction Prompt
// ============================================================================

/**
 * Build the prompt sent to the LLM to extract durable facts from a conversation.
 * Returns system + user prompts. Caller is responsible for the actual LLM call.
 */
export function buildExtractionPrompt(conversationText: string): ExtractionPrompt {
  return {
    systemPrompt: EXTRACTION_SYSTEM_PROMPT,
    userPrompt: `Extract durable facts from this trading session:\n\n${conversationText}`,
  };
}

const EXTRACTION_SYSTEM_PROMPT = `You are a memory extraction agent for a trading CLI called Gordon.
Your job is to identify DURABLE FACTS from a conversation that should be remembered across sessions.

Extract ONLY facts that meet these criteria:
1. Explicitly stated by the user (not inferred)
2. Durable — will be true in future sessions (not ephemeral)
3. Actionable — would change how Gordon behaves

Categories to extract:
- risk_preference: "Max 2% per trade", "Never use leverage", "Stop loss always at 3%"
- strategy_preference: "I'm a swing trader", "Only trade large-cap crypto", "Focus on momentum"
- venue_preference: "Use Alpaca for stocks", "Binance for crypto", "Paper trading only"
- exclusion: "No meme coins", "Don't trade DOGE", "Avoid penny stocks"
- trade_rationale: Key decisions with reasoning (for audit trail)
- lesson_learned: Post-trade reflections ("Should have waited for confirmation")
- user_fact: Name, timezone, capital tier, tax jurisdiction

Output as JSON array:
[
  { "category": "risk_preference", "content": "Max 2% of portfolio per trade", "confidence": 0.95 },
  ...
]

If no durable facts are found, return an empty array: []
Do NOT extract:
- Ephemeral observations ("BTC is at 95k")
- Tool outputs
- Generic trading knowledge
- Anything the user didn't explicitly state`;

// ============================================================================
// Extraction Runner
// ============================================================================

/**
 * Parse LLM extraction output into memory entries.
 * Handles common LLM response variations (code blocks, extra text).
 */
export function parseExtractionOutput(
  llmOutput: string,
  sessionId?: string,
): Omit<SessionMemoryEntry, "id" | "extractedAt">[] {
  // Try to find a JSON array in the output
  const jsonMatch = llmOutput.match(/\[[\s\S]*?\]/);
  if (!jsonMatch) return [];

  try {
    const parsed = JSON.parse(jsonMatch[0]) as Array<{
      category?: string;
      content?: string;
      confidence?: number;
    }>;

    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((item) => item.category && item.content)
      .map((item) => ({
        category: (item.category as SessionMemoryCategory) ?? "general",
        content: item.content!,
        confidence: item.confidence,
        sessionId,
      }));
  } catch {
    return [];
  }
}

/**
 * Format active memories as a prompt section for injection into agent context.
 */
export function formatMemoriesForPrompt(maxEntries: number = 20): string {
  const memories = getActiveMemories();
  if (memories.length === 0) return "";

  const sorted = memories
    .sort((a, b) => new Date(b.extractedAt).getTime() - new Date(a.extractedAt).getTime())
    .slice(0, maxEntries);

  const lines = sorted.map((m) => `- [${m.category}] ${m.content}`);
  return `[GORDON_SESSION_MEMORY]\n${lines.join("\n")}\n`;
}
