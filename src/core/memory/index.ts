/**
 * Persistent Memory Module
 *
 * Provides searchable, persistent memory for Gordon's agents.
 * Combines SQLite full-text search (FTS5/BM25) with vector similarity
 * for hybrid retrieval. Memories survive restarts and are searchable
 * by keyword, semantic similarity, or both.
 *
 * Usage:
 * ```typescript
 * import { getMemoryManager } from "./";
 *
 * const memory = await getMemoryManager();
 *
 * // Record a trade
 * await memory.journal.recordTrade({ ... });
 *
 * // Search memories
 * const results = await memory.journal.search("What happened last time ETH hit $3400?");
 *
 * // Get context for an agent
 * const context = await memory.getContextForAgent("analyst", "Analyze BTC support levels");
 * ```
 */

// Store (low-level persistence + search)
export {
  MemoryStore,
  extractTokens,
  MemoryTypeSchema,
  MemoryKindSchema,
  defaultKindForType,
  MemoryMetadataSchema,
  MemoryEntrySchema,
  type MemoryType,
  type MemoryKind,
  type MemoryMetadata,
  type MemoryEntry,
  type SearchOptions,
  type QueryOptions,
  type MemorySearchResult,
  type MemoryStats,
} from "./store.ts";

// Point-in-time (as-of) recall guard — no-lookahead correctness (E5)
export {
  isVisibleAsOf,
  filterAsOf,
  toEpochMs,
  type KnownAt,
} from "./asOf.ts";

// Embeddings (vector generation)
export {
  OpenAIEmbeddingProvider,
  LocalEmbeddingProvider,
  createEmbeddingProvider,
  type EmbeddingProvider,
} from "./embeddings.ts";

// Trade Journal (high-level domain API)
export {
  TradeJournal,
  type RecordTradeParams,
  type RecordObservationParams,
  type RecordInsightParams,
  type JournalSearchOptions,
  type RecentContextOptions,
} from "./trade-journal.ts";

// Manager (singleton coordinator)
export {
  MemoryManager,
  getMemoryManager,
  resetMemoryManager,
  type EventBus,
} from "./manager.ts";
