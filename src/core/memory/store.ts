/**
 * Persistent Memory Store
 *
 * SQLite-backed persistent memory with full-text search (FTS5) and
 * vector similarity search via in-memory cosine similarity.
 *
 * Uses bun:sqlite (same as the rest of Gordon's storage layer).
 * Provides hybrid search: BM25 keyword matching (30%) + vector cosine similarity (70%).
 */

import { Database, type SQLQueryBindings } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { createModuleLogger } from "../../infra/logger/index.ts";
import { GORDON_DIR } from "../../infra/storage/paths.ts";

const logger = createModuleLogger("memory-store");

// ============================================================================
// Zod Schemas & Types
// ============================================================================

export const MemoryTypeSchema = z.enum([
  "trade_journal",
  "market_observation",
  "analysis",
  "strategy_note",
  "agent_insight",
  "user_note",
]);
export type MemoryType = z.infer<typeof MemoryTypeSchema>;

export const MemoryMetadataSchema = z
  .object({
    symbol: z.string().optional(),
    exchange: z.string().optional(),
    timeframe: z.string().optional(),
    price: z.number().optional(),
    direction: z.enum(["bullish", "bearish", "neutral"]).optional(),
    pnl: z.number().optional(),
    tags: z.array(z.string()).optional(),
  })
  .catchall(z.unknown());
export type MemoryMetadata = z.infer<typeof MemoryMetadataSchema>;

export const MemoryEntrySchema = z.object({
  id: z.string(),
  type: MemoryTypeSchema,
  content: z.string(),
  metadata: MemoryMetadataSchema,
  embedding: z.array(z.number()).optional(),
  tokens: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
  agentId: z.string().optional(),
  positionId: z.string().optional(),
  symbols: z.array(z.string()).optional(),
  importance: z.number().min(0).max(1),
});
export type MemoryEntry = z.infer<typeof MemoryEntrySchema>;

export interface SearchOptions {
  limit?: number;
  offset?: number;
  type?: MemoryType;
  symbol?: string;
  since?: string;
  minImportance?: number;
  /**
   * Point-in-time (as-of) recall bound — ISO date string. When set, excludes
   * records LEARNED after this instant (`created_at > asOf`), enforcing
   * no-lookahead for a decision made at `asOf`. Opt-in: omitting it leaves
   * recall unchanged. See core/memory/asOf.ts. The write timestamp doubles as
   * the known-at / transaction time.
   */
  asOf?: string;
}

export interface QueryOptions {
  limit?: number;
  offset?: number;
  since?: string;
  orderBy?: "created_at" | "updated_at" | "importance";
  orderDirection?: "asc" | "desc";
}

export interface MemorySearchResult {
  entry: MemoryEntry;
  score: number;
  matchType: "keyword" | "semantic" | "hybrid";
}

export interface MemoryStats {
  totalEntries: number;
  byType: Record<string, number>;
  byAgent: Record<string, number>;
  oldestEntry: string | null;
  newestEntry: string | null;
  avgImportance: number;
  totalWithEmbeddings: number;
}

// ============================================================================
// Internal Row Types
// ============================================================================

interface MemoryRow {
  id: string;
  type: string;
  content: string;
  metadata: string;
  embedding: Buffer | null;
  tokens: string;
  agent_id: string | null;
  position_id: string | null;
  symbols: string | null;
  importance: number;
  created_at: string;
  updated_at: string;
}

interface FtsMatchRow {
  id: string;
  rank: number;
}

// ============================================================================
// Helpers
// ============================================================================

/** Serialize a Float64Array of embedding values to a Buffer for BLOB storage */
function serializeEmbedding(embedding: number[]): Buffer {
  const float32 = new Float32Array(embedding);
  return Buffer.from(float32.buffer);
}

/** Deserialize a BLOB Buffer back to a number[] */
function deserializeEmbedding(blob: Buffer): number[] {
  const float32 = new Float32Array(
    blob.buffer,
    blob.byteOffset,
    blob.byteLength / 4
  );
  return Array.from(float32);
}

/** Cosine similarity between two vectors */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    dotProduct += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

/** Extract keywords from text for BM25 indexing */
export function extractTokens(text: string): string[] {
  // Crypto-aware stop words
  const stopWords = new Set([
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "shall", "can", "need", "dare", "ought",
    "used", "to", "of", "in", "for", "on", "with", "at", "by", "from",
    "as", "into", "through", "during", "before", "after", "above", "below",
    "between", "out", "off", "over", "under", "again", "further", "then",
    "once", "here", "there", "when", "where", "why", "how", "all", "both",
    "each", "few", "more", "most", "other", "some", "such", "no", "nor",
    "not", "only", "own", "same", "so", "than", "too", "very", "just",
    "because", "but", "and", "or", "if", "while", "about", "it", "its",
    "this", "that", "these", "those", "i", "me", "my", "we", "our", "you",
    "your", "he", "him", "his", "she", "her", "they", "them", "their",
    "what", "which", "who", "whom",
  ]);

  return text
    .toLowerCase()
    .replace(/[^\w\s.%-]/g, " ") // Keep dots, %, hyphens for prices/tickers
    .split(/\s+/)
    .filter((token) => token.length > 1 && !stopWords.has(token))
    .filter((token, index, self) => self.indexOf(token) === index); // unique
}

/** Convert a DB row to a MemoryEntry */
function rowToEntry(row: MemoryRow): MemoryEntry {
  return {
    id: row.id,
    type: row.type as MemoryType,
    content: row.content,
    metadata: JSON.parse(row.metadata) as MemoryMetadata,
    embedding: row.embedding ? deserializeEmbedding(row.embedding) : undefined,
    tokens: row.tokens ? row.tokens.split(" ").filter(Boolean) : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    agentId: row.agent_id ?? undefined,
    positionId: row.position_id ?? undefined,
    symbols: row.symbols ? (JSON.parse(row.symbols) as string[]) : undefined,
    importance: row.importance,
  };
}

// ============================================================================
// MemoryStore Class
// ============================================================================

export class MemoryStore {
  private db: Database | null = null;
  private dbPath: string;
  private initialized = false;

  constructor(dbPath?: string) {
    this.dbPath = dbPath ?? join(GORDON_DIR, "memory.db");
  }

  // --------------------------------------------------------------------------
  // Initialization
  // --------------------------------------------------------------------------

  async init(): Promise<void> {
    if (this.initialized) return;

    // Ensure directory exists
    mkdirSync(dirname(this.dbPath), { recursive: true });

    this.db = new Database(this.dbPath);

    // Enable WAL for better concurrency
    this.db.run("PRAGMA journal_mode = WAL");

    // Create main memories table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        embedding BLOB,
        tokens TEXT NOT NULL DEFAULT '',
        agent_id TEXT,
        position_id TEXT,
        symbols TEXT,
        importance REAL NOT NULL DEFAULT 0.5,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    // Indexes for filtered queries
    this.db.run("CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type)");
    this.db.run("CREATE INDEX IF NOT EXISTS idx_memories_agent_id ON memories(agent_id)");
    this.db.run("CREATE INDEX IF NOT EXISTS idx_memories_position_id ON memories(position_id)");
    this.db.run("CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance)");
    this.db.run("CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at)");
    this.db.run("CREATE INDEX IF NOT EXISTS idx_memories_updated_at ON memories(updated_at)");

    // FTS5 virtual table for full-text search
    // External content table linked to memories
    this.db.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        content,
        tokens,
        content='memories',
        content_rowid='rowid'
      )
    `);

    // Triggers to keep FTS in sync with the main table
    this.db.run(`
      CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, content, tokens)
        VALUES (new.rowid, new.content, new.tokens);
      END
    `);

    this.db.run(`
      CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, content, tokens)
        VALUES ('delete', old.rowid, old.content, old.tokens);
      END
    `);

    this.db.run(`
      CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, content, tokens)
        VALUES ('delete', old.rowid, old.content, old.tokens);
        INSERT INTO memories_fts(rowid, content, tokens)
        VALUES (new.rowid, new.content, new.tokens);
      END
    `);

    this.initialized = true;
    logger.info("Memory store initialized", { path: this.dbPath });
  }

  /** Get the underlying database, throwing if not initialized */
  private getDb(): Database {
    if (!this.db) {
      throw new Error("MemoryStore not initialized. Call init() first.");
    }
    return this.db;
  }

  // --------------------------------------------------------------------------
  // CRUD Operations
  // --------------------------------------------------------------------------

  async add(
    entry: Omit<MemoryEntry, "id" | "createdAt" | "updatedAt">
  ): Promise<string> {
    const db = this.getDb();
    const id = `mem_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const now = new Date().toISOString();

    const stmt = db.prepare(`
      INSERT INTO memories (id, type, content, metadata, embedding, tokens, agent_id, position_id, symbols, importance, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      entry.type,
      entry.content,
      JSON.stringify(entry.metadata),
      entry.embedding ? serializeEmbedding(entry.embedding) : null,
      entry.tokens.join(" "),
      entry.agentId ?? null,
      entry.positionId ?? null,
      entry.symbols ? JSON.stringify(entry.symbols) : null,
      entry.importance,
      now,
      now
    );

    logger.debug("Memory added", { id, type: entry.type });
    return id;
  }

  async get(id: string): Promise<MemoryEntry | null> {
    const db = this.getDb();

    const stmt = db.prepare("SELECT * FROM memories WHERE id = ?");
    const row = stmt.get(id) as MemoryRow | null;

    if (!row) return null;
    return rowToEntry(row);
  }

  async update(id: string, data: Partial<MemoryEntry>): Promise<void> {
    const db = this.getDb();

    const existing = await this.get(id);
    if (!existing) {
      throw new Error(`Memory entry not found: ${id}`);
    }

    const updates: string[] = [];
    const params: SQLQueryBindings[] = [];

    if (data.content !== undefined) {
      updates.push("content = ?");
      params.push(data.content);
    }
    if (data.metadata !== undefined) {
      updates.push("metadata = ?");
      params.push(JSON.stringify(data.metadata));
    }
    if (data.embedding !== undefined) {
      updates.push("embedding = ?");
      params.push(data.embedding ? serializeEmbedding(data.embedding) : null);
    }
    if (data.tokens !== undefined) {
      updates.push("tokens = ?");
      params.push(data.tokens.join(" "));
    }
    if (data.importance !== undefined) {
      updates.push("importance = ?");
      params.push(data.importance);
    }
    if (data.symbols !== undefined) {
      updates.push("symbols = ?");
      params.push(data.symbols ? JSON.stringify(data.symbols) : null);
    }
    if (data.type !== undefined) {
      updates.push("type = ?");
      params.push(data.type);
    }

    if (updates.length === 0) return;

    updates.push("updated_at = ?");
    params.push(new Date().toISOString());
    params.push(id);

    const sql = `UPDATE memories SET ${updates.join(", ")} WHERE id = ?`;
    db.prepare(sql).run(...params);

    logger.debug("Memory updated", { id });
  }

  async delete(id: string): Promise<void> {
    const db = this.getDb();
    db.prepare("DELETE FROM memories WHERE id = ?").run(id);
    logger.debug("Memory deleted", { id });
  }

  /**
   * Additively bump a memory's importance by `delta`, clamped to [0, 1].
   * Powers the outcome->memory reinforcement loop (TradeJournal.reinforce):
   * importance is otherwise set once at write and never updated, so a memory
   * that led to a winning decision has no way to survive temporal decay.
   * Returns the new importance, or null if the id does not exist.
   */
  async reinforceImportance(id: string, delta: number): Promise<number | null> {
    const db = this.getDb();
    const existing = await this.get(id);
    if (!existing) return null;

    const next = Math.max(0, Math.min(1, existing.importance + delta));
    db.prepare("UPDATE memories SET importance = ?, updated_at = ? WHERE id = ?").run(
      next,
      new Date().toISOString(),
      id,
    );
    logger.debug("Memory importance reinforced", {
      id,
      from: existing.importance,
      to: next,
    });
    return next;
  }

  // --------------------------------------------------------------------------
  // Full-Text Search (BM25)
  // --------------------------------------------------------------------------

  async searchKeyword(
    query: string,
    options: SearchOptions = {}
  ): Promise<MemorySearchResult[]> {
    const db = this.getDb();
    const limit = options.limit ?? 20;
    const offset = options.offset ?? 0;

    // Build FTS5 match query — escape special characters
    const safeQuery = query
      .replace(/['"]/g, "")
      .split(/\s+/)
      .filter(Boolean)
      .map((term) => `"${term}"`)
      .join(" OR ");

    if (!safeQuery) return [];

    // Get FTS matches with BM25 rank
    let sql = `
      SELECT m.*, fts.rank
      FROM memories_fts fts
      JOIN memories m ON m.rowid = fts.rowid
      WHERE memories_fts MATCH ?
    `;
    const params: SQLQueryBindings[] = [safeQuery];

    // Apply filters
    if (options.type) {
      sql += " AND m.type = ?";
      params.push(options.type);
    }
    if (options.symbol) {
      sql += " AND m.symbols LIKE ?";
      params.push(`%"${options.symbol}"%`);
    }
    if (options.since) {
      sql += " AND m.created_at >= ?";
      params.push(options.since);
    }
    if (options.minImportance !== undefined) {
      sql += " AND m.importance >= ?";
      params.push(options.minImportance);
    }
    if (options.asOf) {
      sql += " AND m.created_at <= ?";
      params.push(options.asOf);
    }

    sql += " ORDER BY fts.rank LIMIT ? OFFSET ?";
    params.push(limit, offset);

    try {
      const rows = db.prepare(sql).all(...params) as (MemoryRow & { rank: number })[];

      return rows.map((row) => {
        // BM25 rank is negative (lower = better match), normalize to 0-1
        const rawRank = Math.abs(row.rank);
        const score = Math.min(1, rawRank / 10); // Normalize
        return {
          entry: rowToEntry(row),
          score,
          matchType: "keyword" as const,
        };
      });
    } catch (err) {
      // FTS query syntax errors are non-fatal
      logger.warn("FTS query failed, falling back to LIKE search", {
        query,
        error: err instanceof Error ? err.message : String(err),
      });
      return this.searchKeywordFallback(query, options);
    }
  }

  /** Fallback LIKE-based search when FTS5 query fails */
  private async searchKeywordFallback(
    query: string,
    options: SearchOptions = {}
  ): Promise<MemorySearchResult[]> {
    const db = this.getDb();
    const limit = options.limit ?? 20;
    const offset = options.offset ?? 0;

    let sql = "SELECT * FROM memories WHERE content LIKE ?";
    const params: SQLQueryBindings[] = [`%${query}%`];

    if (options.type) {
      sql += " AND type = ?";
      params.push(options.type);
    }
    if (options.symbol) {
      sql += " AND symbols LIKE ?";
      params.push(`%"${options.symbol}"%`);
    }
    if (options.since) {
      sql += " AND created_at >= ?";
      params.push(options.since);
    }
    if (options.minImportance !== undefined) {
      sql += " AND importance >= ?";
      params.push(options.minImportance);
    }
    if (options.asOf) {
      sql += " AND created_at <= ?";
      params.push(options.asOf);
    }

    sql += " ORDER BY importance DESC, created_at DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    const rows = db.prepare(sql).all(...params) as MemoryRow[];

    return rows.map((row) => ({
      entry: rowToEntry(row),
      score: 0.3, // Fixed low score for LIKE matches
      matchType: "keyword" as const,
    }));
  }

  // --------------------------------------------------------------------------
  // Vector Similarity Search
  // --------------------------------------------------------------------------

  async searchSemantic(
    embedding: number[],
    options: SearchOptions = {}
  ): Promise<MemorySearchResult[]> {
    const db = this.getDb();
    const limit = options.limit ?? 20;

    // Load candidate rows that have embeddings, applying filters
    let sql = "SELECT * FROM memories WHERE embedding IS NOT NULL";
    const params: SQLQueryBindings[] = [];

    if (options.type) {
      sql += " AND type = ?";
      params.push(options.type);
    }
    if (options.symbol) {
      sql += " AND symbols LIKE ?";
      params.push(`%"${options.symbol}"%`);
    }
    if (options.since) {
      sql += " AND created_at >= ?";
      params.push(options.since);
    }
    if (options.minImportance !== undefined) {
      sql += " AND importance >= ?";
      params.push(options.minImportance);
    }
    if (options.asOf) {
      sql += " AND created_at <= ?";
      params.push(options.asOf);
    }

    // Limit candidates to avoid loading too many embeddings into memory.
    // Pull top candidates by importance + recency, then rank by similarity.
    sql += " ORDER BY importance DESC, created_at DESC LIMIT 500";

    const rows = db.prepare(sql).all(...params) as MemoryRow[];

    // Compute cosine similarity for each candidate
    const scored = rows.map((row) => {
      const rowEmbedding = deserializeEmbedding(row.embedding!);
      const similarity = cosineSimilarity(embedding, rowEmbedding);
      return {
        entry: rowToEntry(row),
        score: Math.max(0, similarity), // Clamp negatives
        matchType: "semantic" as const,
      };
    });

    // Sort by similarity descending and take top N
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  // --------------------------------------------------------------------------
  // Hybrid Search (BM25 30% + Vector 70%)
  // --------------------------------------------------------------------------

  async searchHybrid(
    query: string,
    embedding: number[],
    options: SearchOptions = {}
  ): Promise<MemorySearchResult[]> {
    const limit = options.limit ?? 20;

    // Run both searches in parallel, requesting more candidates for merging
    const expandedOptions = { ...options, limit: limit * 3 };
    const [keywordResults, semanticResults] = await Promise.all([
      this.searchKeyword(query, expandedOptions),
      this.searchSemantic(embedding, expandedOptions),
    ]);

    // Merge results by ID, combining scores
    const merged = new Map<
      string,
      { entry: MemoryEntry; keywordScore: number; semanticScore: number }
    >();

    // Normalize keyword scores to 0-1 range
    const maxKeywordScore = keywordResults.length > 0
      ? Math.max(...keywordResults.map((r) => r.score))
      : 1;

    for (const result of keywordResults) {
      const normalizedScore = maxKeywordScore > 0
        ? result.score / maxKeywordScore
        : 0;
      merged.set(result.entry.id, {
        entry: result.entry,
        keywordScore: normalizedScore,
        semanticScore: 0,
      });
    }

    for (const result of semanticResults) {
      const existing = merged.get(result.entry.id);
      if (existing) {
        existing.semanticScore = result.score;
      } else {
        merged.set(result.entry.id, {
          entry: result.entry,
          keywordScore: 0,
          semanticScore: result.score,
        });
      }
    }

    // Combine scores: 30% keyword + 70% vector
    const combined: MemorySearchResult[] = Array.from(merged.values()).map(
      ({ entry, keywordScore, semanticScore }) => ({
        entry,
        score: 0.3 * keywordScore + 0.7 * semanticScore,
        matchType: "hybrid" as const,
      })
    );

    // Sort by combined score descending
    combined.sort((a, b) => b.score - a.score);

    return combined.slice(0, limit);
  }

  // --------------------------------------------------------------------------
  // Filtered Queries
  // --------------------------------------------------------------------------

  async getByType(type: MemoryType, options: QueryOptions = {}): Promise<MemoryEntry[]> {
    return this.queryEntries("type = ?", [type], options);
  }

  async getBySymbol(symbol: string, options: QueryOptions = {}): Promise<MemoryEntry[]> {
    return this.queryEntries("symbols LIKE ?", [`%"${symbol}"%`], options);
  }

  async getByPosition(positionId: string): Promise<MemoryEntry[]> {
    return this.queryEntries("position_id = ?", [positionId], {});
  }

  async getRecent(limit: number = 20): Promise<MemoryEntry[]> {
    return this.queryEntries("1=1", [], {
      limit,
      orderBy: "created_at",
      orderDirection: "desc",
    });
  }

  /** Shared query builder for filtered queries */
  private async queryEntries(
    whereClause: string,
    whereParams: SQLQueryBindings[],
    options: QueryOptions
  ): Promise<MemoryEntry[]> {
    const db = this.getDb();
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;
    const orderBy = options.orderBy ?? "created_at";
    const orderDir = options.orderDirection === "asc" ? "ASC" : "DESC";

    let sql = `SELECT * FROM memories WHERE ${whereClause}`;
    const params: SQLQueryBindings[] = [...whereParams];

    if (options.since) {
      sql += " AND created_at >= ?";
      params.push(options.since);
    }

    sql += ` ORDER BY ${orderBy} ${orderDir} LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const rows = db.prepare(sql).all(...params) as MemoryRow[];
    return rows.map(rowToEntry);
  }

  // --------------------------------------------------------------------------
  // Stats & Cleanup
  // --------------------------------------------------------------------------

  async getStats(): Promise<MemoryStats> {
    const db = this.getDb();

    const totalResult = db
      .prepare("SELECT COUNT(*) as count FROM memories")
      .get() as { count: number } | undefined;
    const totalEntries = totalResult?.count ?? 0;

    if (totalEntries === 0) {
      return {
        totalEntries: 0,
        byType: {},
        byAgent: {},
        oldestEntry: null,
        newestEntry: null,
        avgImportance: 0,
        totalWithEmbeddings: 0,
      };
    }

    // Counts by type
    const typeRows = db
      .prepare("SELECT type, COUNT(*) as count FROM memories GROUP BY type")
      .all() as { type: string; count: number }[];
    const byType: Record<string, number> = {};
    for (const row of typeRows) {
      byType[row.type] = row.count;
    }

    // Counts by agent
    const agentRows = db
      .prepare(
        "SELECT agent_id, COUNT(*) as count FROM memories WHERE agent_id IS NOT NULL GROUP BY agent_id"
      )
      .all() as { agent_id: string; count: number }[];
    const byAgent: Record<string, number> = {};
    for (const row of agentRows) {
      byAgent[row.agent_id] = row.count;
    }

    // Date range
    const dateResult = db
      .prepare(
        "SELECT MIN(created_at) as oldest, MAX(created_at) as newest FROM memories"
      )
      .get() as { oldest: string | null; newest: string | null } | undefined;

    // Average importance
    const avgResult = db
      .prepare("SELECT AVG(importance) as avg FROM memories")
      .get() as { avg: number | null } | undefined;

    // Embedding count
    const embResult = db
      .prepare(
        "SELECT COUNT(*) as count FROM memories WHERE embedding IS NOT NULL"
      )
      .get() as { count: number } | undefined;

    return {
      totalEntries,
      byType,
      byAgent,
      oldestEntry: dateResult?.oldest ?? null,
      newestEntry: dateResult?.newest ?? null,
      avgImportance: avgResult?.avg ?? 0,
      totalWithEmbeddings: embResult?.count ?? 0,
    };
  }

  /**
   * Clean up old, low-importance memories.
   * @param olderThan ISO date string — delete entries created before this date
   * @param maxImportance Only delete entries with importance <= this value (default 0.3)
   * @returns Number of entries deleted
   */
  async cleanup(olderThan?: string, maxImportance: number = 0.3): Promise<number> {
    const db = this.getDb();

    const cutoff =
      olderThan ?? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(); // 90 days default

    const result = db
      .prepare(
        "DELETE FROM memories WHERE created_at < ? AND importance <= ?"
      )
      .run(cutoff, maxImportance);

    const deleted = result.changes;
    if (deleted > 0) {
      logger.info("Memory cleanup complete", {
        deleted: String(deleted),
        olderThan: cutoff,
        maxImportance: String(maxImportance),
      });
    }

    return deleted;
  }

  /**
   * Close the database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.initialized = false;
      logger.debug("Memory store closed");
    }
  }
}
