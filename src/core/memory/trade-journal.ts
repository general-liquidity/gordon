/**
 * Trade Journal
 *
 * High-level API for trade-related memories: recording trades,
 * market observations, agent insights, and searching the journal.
 *
 * Builds on top of MemoryStore and EmbeddingProvider to provide
 * a domain-specific interface for crypto trading memory.
 */

import { createModuleLogger } from "../../infra/logger/index.ts";
import { enhanceRankedResults } from "../../infra/memory/hybrid/index.ts";
import type { EmbeddingProvider } from "./embeddings.ts";
import type { Thesis } from "./thesisLifecycle.ts";
import {
  extractTokens,
  type MemoryEntry,
  type MemorySearchResult,
  type MemoryStore,
  type MemoryType,
} from "./store.ts";

const logger = createModuleLogger("trade-journal");

/**
 * Maximum importance bump applied by a full-strength (reward >= 1)
 * reinforcement. A marginal win (small reward) reinforces proportionally
 * less. Kept modest so a single lucky trade can't pin a memory at the top;
 * repeated wins on the same lineage compound toward the ceiling.
 */
const REINFORCE_MAX_DELTA = 0.2;

/**
 * Post-process search results with temporal decay + MMR diversification.
 * Keeps Gordon's existing BM25+embedding scoring — only re-ranks the output.
 */
function applyEnhancement(
  results: MemorySearchResult[],
  limit: number,
): MemorySearchResult[] {
  if (results.length <= 1) return results;
  const ranked = results.map((r) => ({
    id: r.entry.id,
    content: r.entry.content,
    score: r.score,
    timestamp: r.entry.createdAt ? new Date(r.entry.createdAt).getTime() : null,
    importance: r.entry.importance,
    _original: r,
  }));
  const enhanced = enhanceRankedResults(ranked, { limit });
  return enhanced.map((e) => e._original);
}

// ============================================================================
// Parameter Types
// ============================================================================

export interface RecordTradeParams {
  positionId: string;
  symbol: string;
  side: "long" | "short";
  entry: number;
  exit: number;
  pnl: number;
  strategy?: string;
  setupDescription: string;
  analysisNotes: string;
  executionNotes: string;
  lessonsLearned: string;
  rating: number; // 1-5 self-rating
}

export interface RecordObservationParams {
  symbol: string;
  observation: string;
  conditions: string;
  agentId?: string;
}

export interface RecordInsightParams {
  agentId: string;
  insight: string;
  symbol?: string;
  confidence: number; // 0-1
}

export interface JournalSearchOptions {
  type?: MemoryType;
  symbol?: string;
  limit?: number;
  since?: string;
}

export interface RecentContextOptions {
  limit?: number;
  types?: MemoryType[];
  symbols?: string[];
}

// ============================================================================
// TradeJournal Class
// ============================================================================

export class TradeJournal {
  constructor(
    private store: MemoryStore,
    private embedder: EmbeddingProvider
  ) {}

  // --------------------------------------------------------------------------
  // Recording Methods
  // --------------------------------------------------------------------------

  /**
   * Record a completed trade with full post-trade review.
   * Generates rich text content combining all trade details.
   */
  async recordTrade(params: RecordTradeParams): Promise<string> {
    const pnlPct =
      params.entry !== 0
        ? ((params.exit - params.entry) / params.entry) * 100 * (params.side === "short" ? -1 : 1)
        : 0;
    const outcome = params.pnl >= 0 ? "WIN" : "LOSS";

    // Build rich text content for the trade journal entry
    const content = [
      `[${outcome}] ${params.symbol} ${params.side.toUpperCase()} trade`,
      `Entry: $${params.entry} | Exit: $${params.exit} | PnL: $${params.pnl.toFixed(2)} (${pnlPct.toFixed(2)}%)`,
      params.strategy ? `Strategy: ${params.strategy}` : null,
      `Setup: ${params.setupDescription}`,
      `Analysis: ${params.analysisNotes}`,
      `Execution: ${params.executionNotes}`,
      `Lessons: ${params.lessonsLearned}`,
      `Rating: ${params.rating}/5`,
    ]
      .filter(Boolean)
      .join("\n");

    // Compute importance from rating and PnL magnitude
    // Higher-rated trades and trades with larger PnL get higher importance
    const ratingFactor = params.rating / 5; // 0.2 - 1.0
    const pnlFactor = Math.min(1, Math.abs(pnlPct) / 20); // Cap at 20% moves
    const importance = Math.min(1, 0.4 * ratingFactor + 0.3 * pnlFactor + 0.3);

    const tokens = extractTokens(content);

    let embedding: number[] | undefined;
    try {
      embedding = await this.embedder.embed(content);
    } catch (err) {
      logger.warn("Failed to generate embedding for trade journal entry", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const id = await this.store.add({
      type: "trade_journal",
      content,
      metadata: {
        symbol: params.symbol,
        direction: params.pnl >= 0 ? "bullish" : "bearish",
        price: params.exit,
        pnl: params.pnl,
        tags: [
          params.side,
          outcome.toLowerCase(),
          params.strategy ?? "unknown",
          `rating-${params.rating}`,
        ],
      },
      embedding,
      tokens,
      positionId: params.positionId,
      symbols: [params.symbol],
      importance,
    });

    logger.info("Trade recorded in journal", {
      id,
      symbol: params.symbol,
      outcome,
      pnl: params.pnl.toFixed(2),
    });

    return id;
  }

  /**
   * Persist a snapshot of a thesis (see thesisLifecycle.ts) into the journal.
   *
   * Rides the existing memory store as a `strategy_note` entry — the thesis FSM
   * is not a parallel store (journal_is_substrate). The full serialized thesis
   * is stashed in metadata (the metadata schema is open via `.catchall`), so a
   * later session can reconstruct state, review schedule, realized PnL and
   * MAE/MFE. The thesis id rides `positionId`, so snapshots for one thesis are
   * retrievable as a history via the store's position lookup.
   */
  async recordThesis(thesis: Thesis): Promise<string> {
    const realizedPct =
      thesis.entryPrice && thesis.initialQuantity
        ? (thesis.realizedPnl / (thesis.entryPrice * thesis.initialQuantity)) * 100
        : 0;

    const content = [
      `[THESIS ${thesis.state}] ${thesis.symbol} ${thesis.side.toUpperCase()}`,
      `Rationale: ${thesis.rationale}`,
      thesis.entryPrice ? `Entry: $${thesis.entryPrice} x ${thesis.initialQuantity ?? 0}` : null,
      `Open qty: ${thesis.openQuantity} | Realized PnL: $${thesis.realizedPnl.toFixed(2)} (${realizedPct.toFixed(2)}%)`,
      `MFE: ${thesis.mfe.toFixed(4)} | MAE: ${thesis.mae.toFixed(4)}`,
      thesis.nextReviewAt ? `Next review: ${thesis.nextReviewAt}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const tokens = extractTokens(content);

    let embedding: number[] | undefined;
    try {
      embedding = await this.embedder.embed(content);
    } catch (err) {
      logger.warn("Failed to generate embedding for thesis snapshot", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const id = await this.store.add({
      type: "strategy_note",
      content,
      metadata: {
        symbol: thesis.symbol,
        direction: thesis.side === "long" ? "bullish" : "bearish",
        pnl: thesis.realizedPnl,
        tags: ["thesis", thesis.state.toLowerCase(), thesis.side],
        thesis,
      },
      embedding,
      tokens,
      positionId: thesis.id,
      symbols: [thesis.symbol],
      importance: 0.6,
    });

    logger.debug("Thesis snapshot recorded", {
      id,
      symbol: thesis.symbol,
      state: thesis.state,
    });
    return id;
  }

  /**
   * Record a market observation (conditions, patterns, anomalies).
   */
  async recordObservation(params: RecordObservationParams): Promise<string> {
    const content = [
      `Market observation for ${params.symbol}`,
      `Observation: ${params.observation}`,
      `Conditions: ${params.conditions}`,
    ].join("\n");

    const tokens = extractTokens(content);

    let embedding: number[] | undefined;
    try {
      embedding = await this.embedder.embed(content);
    } catch (err) {
      logger.warn("Failed to generate embedding for observation", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const id = await this.store.add({
      type: "market_observation",
      content,
      metadata: {
        symbol: params.symbol,
        tags: ["observation"],
      },
      embedding,
      tokens,
      agentId: params.agentId,
      symbols: [params.symbol],
      importance: 0.4,
    });

    logger.debug("Market observation recorded", { id, symbol: params.symbol });
    return id;
  }

  /**
   * Record an agent insight (analysis conclusion, signal, recommendation).
   */
  async recordInsight(params: RecordInsightParams): Promise<string> {
    const content = [
      `Agent insight from ${params.agentId}`,
      params.symbol ? `Symbol: ${params.symbol}` : null,
      `Insight: ${params.insight}`,
      `Confidence: ${(params.confidence * 100).toFixed(0)}%`,
    ]
      .filter(Boolean)
      .join("\n");

    const tokens = extractTokens(content);

    let embedding: number[] | undefined;
    try {
      embedding = await this.embedder.embed(content);
    } catch (err) {
      logger.warn("Failed to generate embedding for insight", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Higher confidence insights are more important
    const importance = 0.3 + 0.5 * params.confidence;

    const id = await this.store.add({
      type: "agent_insight",
      content,
      metadata: {
        symbol: params.symbol,
        tags: ["insight", params.agentId],
      },
      embedding,
      tokens,
      agentId: params.agentId,
      symbols: params.symbol ? [params.symbol] : undefined,
      importance,
    });

    logger.debug("Agent insight recorded", {
      id,
      agentId: params.agentId,
      symbol: params.symbol ?? "none",
    });
    return id;
  }

  // --------------------------------------------------------------------------
  // Outcome -> Memory Reinforcement
  // --------------------------------------------------------------------------

  /**
   * Reinforce the specific memories that were cited in a resolved decision.
   *
   * When a decision resolves profitably (`reward > 0`), bump the stored
   * importance of the exact memories that informed it, so winning lineage
   * survives temporal decay and resurfaces on future retrieval. Losing or
   * neutral lineage (`reward <= 0`) is deliberately left untouched — normal
   * temporal decay lets it fade on its own, so the store drifts toward what
   * actually worked.
   *
   * The bump scales with the (capped) reward magnitude, so a decisive win
   * reinforces harder than a marginal one. Returns the number of memories
   * whose importance was actually updated (missing ids are skipped).
   */
  async reinforce(ids: string[], reward: number): Promise<number> {
    if (reward <= 0 || ids.length === 0) return 0;

    const rewardFactor = Math.min(1, reward);
    const delta = REINFORCE_MAX_DELTA * rewardFactor;

    let updated = 0;
    for (const id of ids) {
      const next = await this.store.reinforceImportance(id, delta);
      if (next !== null) updated += 1;
    }

    if (updated > 0) {
      logger.info("Reinforced winning-lineage memories", {
        updated,
        cited: ids.length,
        reward: reward.toFixed(3),
        delta: delta.toFixed(3),
      });
    }

    return updated;
  }

  // --------------------------------------------------------------------------
  // Search Methods
  // --------------------------------------------------------------------------

  /**
   * Search the journal with hybrid search (keyword + semantic).
   * Falls back to keyword-only if embeddings are unavailable.
   */
  async search(
    query: string,
    options: JournalSearchOptions = {}
  ): Promise<MemorySearchResult[]> {
    const searchOptions = {
      limit: options.limit ?? 10,
      type: options.type,
      symbol: options.symbol,
      since: options.since,
    };

    try {
      const embedding = await this.embedder.embed(query);
      const raw = await this.store.searchHybrid(query, embedding, searchOptions);
      return applyEnhancement(raw, searchOptions.limit);
    } catch {
      // Fall back to keyword search if embedding fails
      logger.debug("Falling back to keyword search (embedding unavailable)");
      const raw = await this.store.searchKeyword(query, searchOptions);
      return applyEnhancement(raw, searchOptions.limit);
    }
  }

  /**
   * Get trading lessons for a specific symbol.
   * Returns trade journal entries and agent insights for the symbol,
   * ordered by importance.
   */
  async getLessonsForSymbol(symbol: string): Promise<MemoryEntry[]> {
    const trades = await this.store.getBySymbol(symbol, {
      orderBy: "importance",
      orderDirection: "desc",
      limit: 20,
    });

    // Filter to trade journals and agent insights (the most lesson-rich types)
    return trades.filter(
      (entry) =>
        entry.type === "trade_journal" ||
        entry.type === "agent_insight" ||
        entry.type === "strategy_note"
    );
  }

  /**
   * Find similar past trades by description.
   * Uses semantic search to find trades with similar setups, conditions, or patterns.
   */
  async getSimilarTrades(
    description: string,
    limit: number = 5
  ): Promise<MemoryEntry[]> {
    const results = await this.search(description, {
      type: "trade_journal",
      limit,
    });

    return results.map((r) => r.entry);
  }

  /**
   * Get recent context formatted as text for injection into agent system prompts.
   * Returns a human-readable summary of recent memory entries.
   */
  async getRecentContext(options: RecentContextOptions = {}): Promise<string> {
    const limit = options.limit ?? 10;
    const entries = await this.store.getRecent(limit * 2); // Fetch more to filter

    // Filter by requested types and symbols
    let filtered = entries;

    if (options.types && options.types.length > 0) {
      const typeSet = new Set(options.types);
      filtered = filtered.filter((e) => typeSet.has(e.type));
    }

    if (options.symbols && options.symbols.length > 0) {
      const symbolSet = new Set(options.symbols);
      filtered = filtered.filter(
        (e) => e.symbols?.some((s) => symbolSet.has(s)) ?? false
      );
    }

    // Take the requested limit after filtering
    filtered = filtered.slice(0, limit);

    if (filtered.length === 0) {
      return "";
    }

    // Format each entry as a concise context block
    const blocks = filtered.map((entry) => {
      const age = this.formatAge(entry.createdAt);
      const typeLabel = entry.type.replace(/_/g, " ");
      const symbolTag = entry.symbols?.length
        ? ` [${entry.symbols.join(", ")}]`
        : "";

      // Truncate content to keep context injection manageable
      const truncatedContent =
        entry.content.length > 300
          ? entry.content.slice(0, 297) + "..."
          : entry.content;

      return `- (${typeLabel}${symbolTag}, ${age}) ${truncatedContent}`;
    });

    return `## Recent Memory\n${blocks.join("\n")}`;
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  /** Format an ISO date as a human-readable relative age */
  private formatAge(isoDate: string): string {
    const ms = Date.now() - new Date(isoDate).getTime();
    const minutes = Math.floor(ms / 60_000);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    return `${months}mo ago`;
  }
}
