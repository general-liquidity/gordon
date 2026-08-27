/**
 * Memory Manager
 *
 * Coordinates the persistent memory system across Gordon's agents.
 * Provides:
 * - Initialization and lifecycle management
 * - Event bus subscriptions for automatic memory capture
 * - Context retrieval for agent prompt injection
 * - Access to the underlying MemoryStore and TradeJournal
 */

import { createModuleLogger } from "../../infra/logger/index.ts";
import { createEmbeddingProvider, type EmbeddingProvider } from "./embeddings.ts";
import { extractTokens, MemoryStore } from "./store.ts";
import { TradeJournal } from "./trade-journal.ts";

const logger = createModuleLogger("memory-manager");

// ============================================================================
// Event Bus Types (loose coupling — no hard dependency on a specific bus impl)
// ============================================================================

/**
 * Minimal event bus interface.
 * Any event system that provides `on(event, callback)` is compatible.
 */
export interface EventBus {
  on(event: string, callback: (data: unknown) => void): void;
}

/** Shape of a POSITION_CLOSED event payload */
interface PositionClosedEvent {
  positionId: string;
  symbol: string;
  side: "long" | "short";
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  pnlPercent: number;
  strategy?: string;
  reason?: string;
  /**
   * Ids of the specific memories (past trades, insights, analyses) that
   * were cited when this position was opened. On a winning close they get
   * reinforced (importance bumped) so the lineage that actually worked
   * survives temporal decay. Absent when the open wasn't memory-informed.
   */
  citedMemoryIds?: string[];
}

/** Shape of an ANALYSIS_COMPLETE event payload */
interface AnalysisCompleteEvent {
  symbol: string;
  agentId?: string;
  summary: string;
  bias: "bullish" | "bearish" | "neutral";
  confidence: number;
  details?: string;
}

/** Shape of a SETUP_DETECTED event payload */
interface SetupDetectedEvent {
  symbol: string;
  agentId?: string;
  setup: string;
  confidence: number;
  conditions: string;
}

// ============================================================================
// MemoryManager Class
// ============================================================================

export class MemoryManager {
  private _store: MemoryStore;
  private _journal: TradeJournal;
  private _embedder: EmbeddingProvider;
  private initialized = false;

  constructor(store?: MemoryStore, journal?: TradeJournal, embedder?: EmbeddingProvider) {
    this._embedder = embedder ?? createEmbeddingProvider();
    this._store = store ?? new MemoryStore();
    this._journal = journal ?? new TradeJournal(this._store, this._embedder);
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  async init(): Promise<void> {
    if (this.initialized) return;

    await this._store.init();
    this.initialized = true;

    logger.info("Memory manager initialized", {
      embeddingProvider: this._embedder.name,
      dimensions: String(this._embedder.dimensions),
    });

    // Run cleanup on startup (non-blocking)
    this.runStartupCleanup().catch((err) => {
      logger.warn("Startup cleanup failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  /** Ensure the manager is initialized before use */
  private ensureInit(): void {
    if (!this.initialized) {
      throw new Error("MemoryManager not initialized. Call init() first.");
    }
  }

  // --------------------------------------------------------------------------
  // Event Bus Subscriptions
  // --------------------------------------------------------------------------

  /**
   * Subscribe to system events for automatic memory capture.
   *
   * Subscribes to:
   * - POSITION_CLOSED: Auto-creates a trade journal entry
   * - ANALYSIS_COMPLETE: Stores analysis results as memory
   * - SETUP_DETECTED: Stores detected setups as observations
   */
  subscribeToEvents(bus: EventBus): void {
    this.ensureInit();

    bus.on("POSITION_CLOSED", (data: unknown) => {
      this.handlePositionClosed(data as PositionClosedEvent).catch((err) => {
        logger.error("Failed to handle POSITION_CLOSED event", {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    });

    bus.on("ANALYSIS_COMPLETE", (data: unknown) => {
      this.handleAnalysisComplete(data as AnalysisCompleteEvent).catch((err) => {
        logger.error("Failed to handle ANALYSIS_COMPLETE event", {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    });

    bus.on("SETUP_DETECTED", (data: unknown) => {
      this.handleSetupDetected(data as SetupDetectedEvent).catch((err) => {
        logger.error("Failed to handle SETUP_DETECTED event", {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    });

    logger.info("Subscribed to event bus for automatic memory capture");
  }

  // --------------------------------------------------------------------------
  // Event Handlers
  // --------------------------------------------------------------------------

  private async handlePositionClosed(event: PositionClosedEvent): Promise<void> {
    await this._journal.recordTrade({
      positionId: event.positionId,
      symbol: event.symbol,
      side: event.side,
      entry: event.entryPrice,
      exit: event.exitPrice,
      pnl: event.pnl,
      strategy: event.strategy,
      setupDescription: `Position closed via ${event.reason ?? "manual"}`,
      analysisNotes: `PnL: ${event.pnlPercent.toFixed(2)}%`,
      executionNotes: `${event.side} ${event.symbol} from $${event.entryPrice} to $${event.exitPrice}`,
      lessonsLearned:
        event.pnl >= 0
          ? "Profitable trade — review what went right"
          : "Loss trade — review what could be improved",
      rating: event.pnl >= 0 ? 3 : 2, // Default ratings, agents can update later
    });

    // Outcome -> memory reinforcement: on a winning close, bump the importance
    // of the memories that informed the open. Reward is the win magnitude,
    // normalized against a 20% move (mirrors recordTrade's pnl factor). Losses
    // (reward <= 0) are a no-op — decay handles losing lineage.
    if (event.citedMemoryIds && event.citedMemoryIds.length > 0) {
      const reward = event.pnl > 0 ? Math.min(1, Math.abs(event.pnlPercent) / 20) : 0;
      await this._journal.reinforce(event.citedMemoryIds, reward);
    }
  }

  private async handleAnalysisComplete(event: AnalysisCompleteEvent): Promise<void> {
    const content = [
      `Analysis complete for ${event.symbol}`,
      `Bias: ${event.bias} | Confidence: ${(event.confidence * 100).toFixed(0)}%`,
      `Summary: ${event.summary}`,
      event.details ? `Details: ${event.details}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const tokens = extractTokens(content);

    let embedding: number[] | undefined;
    try {
      embedding = await this._embedder.embed(content);
    } catch {
      // Non-fatal — memory is still useful without embedding
    }

    await this._store.add({
      type: "analysis",
      content,
      metadata: {
        symbol: event.symbol,
        direction: event.bias,
        tags: ["analysis", event.bias],
      },
      embedding,
      tokens,
      agentId: event.agentId,
      symbols: [event.symbol],
      importance: 0.3 + 0.4 * event.confidence,
    });
  }

  private async handleSetupDetected(event: SetupDetectedEvent): Promise<void> {
    await this._journal.recordObservation({
      symbol: event.symbol,
      observation: `Setup detected: ${event.setup} (${(event.confidence * 100).toFixed(0)}% confidence)`,
      conditions: event.conditions,
      agentId: event.agentId,
    });
  }

  // --------------------------------------------------------------------------
  // Context Retrieval for Agents
  // --------------------------------------------------------------------------

  /**
   * Get relevant context for an agent, optionally based on the current user query.
   *
   * This retrieves recent memories filtered by agent and/or current topic,
   * formatted as text suitable for injection into agent system prompts.
   *
   * @param agentId - The agent requesting context
   * @param currentQuery - The user's current query (used for semantic retrieval)
   * @returns Formatted context string for prompt injection
   */
  async getContextForAgent(agentId: string, currentQuery?: string): Promise<string> {
    this.ensureInit();

    const parts: string[] = [];

    // 1. Get recent entries from this agent's own work
    const recentOwn = await this._store.getRecent(5);
    const ownEntries = recentOwn.filter((e) => e.agentId === agentId);
    if (ownEntries.length > 0) {
      const formatted = ownEntries
        .map((e) => {
          const age = formatAge(e.createdAt);
          return `- (${age}) ${e.content.slice(0, 200)}`;
        })
        .join("\n");
      parts.push(`### Your Recent Work\n${formatted}`);
    }

    // 2. If there's a current query, do a semantic search for relevant memories
    if (currentQuery) {
      try {
        const results = await this._journal.search(currentQuery, {
          limit: 5,
        });
        if (results.length > 0) {
          const formatted = results
            .map((r) => {
              const age = formatAge(r.entry.createdAt);
              const symbolTag = r.entry.symbols?.length ? ` [${r.entry.symbols.join(", ")}]` : "";
              return `- (${r.entry.type}${symbolTag}, ${age}, relevance: ${(r.score * 100).toFixed(0)}%) ${r.entry.content.slice(0, 200)}`;
            })
            .join("\n");
          parts.push(`### Relevant Memories\n${formatted}`);
        }
      } catch {
        // Non-fatal
      }
    }

    // 3. Get recent trade journal entries (always useful context)
    const recentTrades = await this._store.getByType("trade_journal", {
      limit: 3,
      orderBy: "created_at",
      orderDirection: "desc",
    });
    if (recentTrades.length > 0) {
      const formatted = recentTrades
        .map((e) => {
          const age = formatAge(e.createdAt);
          const firstLine = e.content.split("\n")[0] ?? "";
          return `- (${age}) ${firstLine}`;
        })
        .join("\n");
      parts.push(`### Recent Trades\n${formatted}`);
    }

    if (parts.length === 0) return "";

    return `\n## Persistent Memory\n${parts.join("\n\n")}`;
  }

  // --------------------------------------------------------------------------
  // Accessors
  // --------------------------------------------------------------------------

  /** Get the TradeJournal instance */
  get journal(): TradeJournal {
    return this._journal;
  }

  /** Get the raw MemoryStore */
  get store(): MemoryStore {
    return this._store;
  }

  /** Get the embedding provider */
  get embedder(): EmbeddingProvider {
    return this._embedder;
  }

  // --------------------------------------------------------------------------
  // Cleanup
  // --------------------------------------------------------------------------

  /** Run cleanup tasks on startup */
  private async runStartupCleanup(): Promise<void> {
    // Auto-prune old, low-importance memories (older than 90 days, importance <= 0.3)
    const deleted = await this._store.cleanup();
    if (deleted > 0) {
      logger.info("Startup cleanup pruned old memories", {
        deleted: String(deleted),
      });
    }
  }

  /** Close the memory store */
  close(): void {
    this._store.close();
    this.initialized = false;
    logger.debug("Memory manager closed");
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _instance: MemoryManager | null = null;

/**
 * Get or create the singleton MemoryManager instance.
 * Automatically initializes on first call.
 */
export async function getMemoryManager(): Promise<MemoryManager> {
  if (!_instance) {
    _instance = new MemoryManager();
    await _instance.init();
  }
  return _instance;
}

/**
 * Reset the singleton (for testing).
 */
export function resetMemoryManager(): void {
  if (_instance) {
    _instance.close();
    _instance = null;
  }
}

// ============================================================================
// Helpers
// ============================================================================

function formatAge(isoDate: string): string {
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
