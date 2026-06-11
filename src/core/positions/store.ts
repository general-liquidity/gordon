/**
 * Position Store
 * SQLite-backed persistent storage for position records.
 * Uses the same database infrastructure as trades and plans.
 */

import { getDatabase, withTransaction, executeWithLogging } from "../../infra/storage/database.ts";
import { createModuleLogger } from "../../infra/logger/index.ts";
import {
  type PositionRecord,
  type PositionState,
  type PositionStats,
  TERMINAL_STATES,
} from "./types.ts";
import type { Database } from "bun:sqlite";

const logger = createModuleLogger("position-store");

// ============================================================================
// Row Conversion Helpers
// ============================================================================

/**
 * Converts a database row to a PositionRecord.
 * JSON fields are parsed from their string representation.
 */
function rowToPosition(row: Record<string, unknown>): PositionRecord {
  return {
    id: row.id as string,
    symbol: row.symbol as string,
    exchangeId: row.exchangeId as string,
    side: row.side as "long" | "short",
    state: row.state as PositionState,
    stateHistory: safeJsonParse(row.stateHistory as string, []),

    // Setup phase
    setupSignal: safeJsonParseOptional(row.setupSignal as string | null),
    analysis: safeJsonParseOptional(row.analysis as string | null),
    plan: safeJsonParseOptional(row.plan as string | null),
    riskDecision: safeJsonParseOptional(row.riskDecision as string | null),

    // Execution phase
    entryOrder: safeJsonParseOptional(row.entryOrder as string | null),
    entryPrice: row.entryPrice as number | undefined,
    quantity: row.quantity as number | undefined,

    // Management phase
    stopLoss: row.stopLoss as number | undefined,
    takeProfit: row.takeProfit as number | undefined,
    trailingStop: safeJsonParseOptional(row.trailingStop as string | null),
    currentPrice: row.currentPrice as number | undefined,
    unrealizedPnL: row.unrealizedPnL as number | undefined,
    highWaterMark: row.highWaterMark as number | undefined,

    // Close phase
    exitOrder: safeJsonParseOptional(row.exitOrder as string | null),
    exitPrice: row.exitPrice as number | undefined,
    realizedPnL: row.realizedPnL as number | undefined,

    // Review phase
    review: safeJsonParseOptional(row.review as string | null),

    // Metadata
    strategyId: row.strategyId as string | undefined,
    playbookId: row.playbookId as string | undefined,
    tags: safeJsonParseOptional(row.tags as string | null),
    cancelReason: row.cancelReason as string | undefined,
    rejectReason: row.rejectReason as string | undefined,
    closeReason: row.closeReason as string | undefined,
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
    closedAt: row.closedAt as string | undefined,
  };
}

function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function safeJsonParseOptional<T>(value: string | null | undefined): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

// ============================================================================
// Position Store
// ============================================================================

export class PositionStore {
  private db: Database;

  constructor() {
    this.db = getDatabase();
  }

  /**
   * Initialize the positions table and indexes.
   * Safe to call multiple times — uses CREATE TABLE IF NOT EXISTS.
   */
  async init(): Promise<void> {
    const db = this.db;

    executeWithLogging(
      () =>
        db.run(`
          CREATE TABLE IF NOT EXISTS positions (
            id TEXT PRIMARY KEY,
            symbol TEXT NOT NULL,
            exchangeId TEXT NOT NULL,
            side TEXT NOT NULL CHECK(side IN ('long', 'short')),
            state TEXT NOT NULL,
            stateHistory TEXT NOT NULL DEFAULT '[]',

            -- Setup phase (JSON)
            setupSignal TEXT,
            analysis TEXT,
            plan TEXT,
            riskDecision TEXT,

            -- Execution phase
            entryOrder TEXT,
            entryPrice REAL,
            quantity REAL,

            -- Management phase
            stopLoss REAL,
            takeProfit REAL,
            trailingStop TEXT,
            currentPrice REAL,
            unrealizedPnL REAL,
            highWaterMark REAL,

            -- Close phase
            exitOrder TEXT,
            exitPrice REAL,
            realizedPnL REAL,

            -- Review phase
            review TEXT,

            -- Metadata
            strategyId TEXT,
            playbookId TEXT,
            tags TEXT,
            cancelReason TEXT,
            rejectReason TEXT,
            closeReason TEXT,
            createdAt TEXT NOT NULL,
            updatedAt TEXT NOT NULL,
            closedAt TEXT
          )
        `),
      "CREATE TABLE positions"
    );

    // Indexes for common query patterns
    executeWithLogging(
      () => db.run("CREATE INDEX IF NOT EXISTS idx_positions_state ON positions(state)"),
      "CREATE INDEX idx_positions_state"
    );
    executeWithLogging(
      () => db.run("CREATE INDEX IF NOT EXISTS idx_positions_symbol ON positions(symbol)"),
      "CREATE INDEX idx_positions_symbol"
    );
    executeWithLogging(
      () => db.run("CREATE INDEX IF NOT EXISTS idx_positions_exchangeId ON positions(exchangeId)"),
      "CREATE INDEX idx_positions_exchangeId"
    );
    executeWithLogging(
      () => db.run("CREATE INDEX IF NOT EXISTS idx_positions_createdAt ON positions(createdAt)"),
      "CREATE INDEX idx_positions_createdAt"
    );
    executeWithLogging(
      () => db.run("CREATE INDEX IF NOT EXISTS idx_positions_closedAt ON positions(closedAt)"),
      "CREATE INDEX idx_positions_closedAt"
    );
    executeWithLogging(
      () => db.run("CREATE INDEX IF NOT EXISTS idx_positions_strategyId ON positions(strategyId)"),
      "CREATE INDEX idx_positions_strategyId"
    );

    logger.info("Position store initialized");
  }

  /**
   * Save a position record (insert or replace).
   */
  async save(position: PositionRecord): Promise<void> {
    withTransaction(() => {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO positions (
          id, symbol, exchangeId, side, state, stateHistory,
          setupSignal, analysis, plan, riskDecision,
          entryOrder, entryPrice, quantity,
          stopLoss, takeProfit, trailingStop, currentPrice, unrealizedPnL, highWaterMark,
          exitOrder, exitPrice, realizedPnL,
          review,
          strategyId, playbookId, tags, cancelReason, rejectReason, closeReason,
          createdAt, updatedAt, closedAt
        ) VALUES (
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?,
          ?,
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?
        )
      `);

      executeWithLogging(
        () =>
          stmt.run(
            position.id,
            position.symbol,
            position.exchangeId,
            position.side,
            position.state,
            JSON.stringify(position.stateHistory),
            // Setup phase
            position.setupSignal ? JSON.stringify(position.setupSignal) : null,
            position.analysis ? JSON.stringify(position.analysis) : null,
            position.plan ? JSON.stringify(position.plan) : null,
            position.riskDecision ? JSON.stringify(position.riskDecision) : null,
            // Execution phase
            position.entryOrder ? JSON.stringify(position.entryOrder) : null,
            position.entryPrice ?? null,
            position.quantity ?? null,
            // Management phase
            position.stopLoss ?? null,
            position.takeProfit ?? null,
            position.trailingStop ? JSON.stringify(position.trailingStop) : null,
            position.currentPrice ?? null,
            position.unrealizedPnL ?? null,
            position.highWaterMark ?? null,
            // Close phase
            position.exitOrder ? JSON.stringify(position.exitOrder) : null,
            position.exitPrice ?? null,
            position.realizedPnL ?? null,
            // Review phase
            position.review ? JSON.stringify(position.review) : null,
            // Metadata
            position.strategyId ?? null,
            position.playbookId ?? null,
            position.tags ? JSON.stringify(position.tags) : null,
            position.cancelReason ?? null,
            position.rejectReason ?? null,
            position.closeReason ?? null,
            position.createdAt,
            position.updatedAt,
            position.closedAt ?? null
          ),
        "INSERT OR REPLACE INTO positions"
      );
    }, { mode: "IMMEDIATE" });
  }

  /**
   * Get a position by ID.
   */
  async get(id: string): Promise<PositionRecord | null> {
    const stmt = this.db.prepare("SELECT * FROM positions WHERE id = ?");
    const row = executeWithLogging(
      () => stmt.get(id) as Record<string, unknown> | null,
      "SELECT position by id"
    );
    if (!row) return null;
    return rowToPosition(row);
  }

  /**
   * Get all positions in a given state.
   */
  async getByState(state: PositionState): Promise<PositionRecord[]> {
    const stmt = this.db.prepare(
      "SELECT * FROM positions WHERE state = ? ORDER BY updatedAt DESC"
    );
    const rows = executeWithLogging(
      () => stmt.all(state) as Record<string, unknown>[],
      "SELECT positions by state"
    );
    return rows.map(rowToPosition);
  }

  /**
   * Get all active (non-terminal) positions.
   */
  async getActive(): Promise<PositionRecord[]> {
    const terminalList = Array.from(TERMINAL_STATES)
      .map((s) => `'${s}'`)
      .join(", ");

    const query = `SELECT * FROM positions WHERE state NOT IN (${terminalList}) ORDER BY updatedAt DESC`;
    const stmt = this.db.prepare(query);
    const rows = executeWithLogging(
      () => stmt.all() as Record<string, unknown>[],
      "SELECT active positions"
    );
    return rows.map(rowToPosition);
  }

  /**
   * Get all positions for a symbol.
   */
  async getBySymbol(symbol: string): Promise<PositionRecord[]> {
    const stmt = this.db.prepare(
      "SELECT * FROM positions WHERE symbol = ? ORDER BY createdAt DESC"
    );
    const rows = executeWithLogging(
      () => stmt.all(symbol) as Record<string, unknown>[],
      "SELECT positions by symbol"
    );
    return rows.map(rowToPosition);
  }

  /**
   * Get position history with filtering options.
   */
  async getHistory(options: {
    limit?: number;
    since?: string;
    symbol?: string;
    state?: PositionState;
  }): Promise<PositionRecord[]> {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (options.symbol) {
      conditions.push("symbol = ?");
      params.push(options.symbol);
    }

    if (options.since) {
      conditions.push("createdAt >= ?");
      params.push(options.since);
    }

    if (options.state) {
      conditions.push("state = ?");
      params.push(options.state);
    }

    let query = "SELECT * FROM positions";
    if (conditions.length > 0) {
      query += " WHERE " + conditions.join(" AND ");
    }
    query += " ORDER BY createdAt DESC";

    if (options.limit) {
      query += ` LIMIT ${options.limit}`;
    }

    const stmt = this.db.prepare(query);
    const rows = executeWithLogging(
      () => (params.length > 0 ? stmt.all(...params) : stmt.all()) as Record<string, unknown>[],
      "SELECT position history"
    );
    return rows.map(rowToPosition);
  }

  /**
   * Update a position record in place.
   */
  async update(id: string, data: Partial<PositionRecord>): Promise<void> {
    const existing = await this.get(id);
    if (!existing) {
      throw new Error(`Position not found: ${id}`);
    }

    const merged: PositionRecord = { ...existing, ...data, updatedAt: new Date().toISOString() };
    await this.save(merged);
  }

  /**
   * Get aggregate statistics across all positions.
   */
  async getStats(): Promise<PositionStats> {
    const all = await this.getHistory({});

    const closed = all.filter((p) => p.state === "closed" || p.state === "reviewed");
    const cancelled = all.filter((p) => p.state === "cancelled");
    const rejected = all.filter((p) => p.state === "rejected");
    const active = all.filter((p) => !TERMINAL_STATES.has(p.state));

    const wins = closed.filter((p) => (p.realizedPnL ?? 0) > 0);
    const losses = closed.filter((p) => (p.realizedPnL ?? 0) < 0);
    const totalPnL = closed.reduce((sum, p) => sum + (p.realizedPnL ?? 0), 0);

    const pnlValues = closed.map((p) => p.realizedPnL ?? 0);
    const bestTrade = pnlValues.length > 0 ? Math.max(...pnlValues) : 0;
    const worstTrade = pnlValues.length > 0 ? Math.min(...pnlValues) : 0;

    return {
      totalPositions: all.length,
      activePositions: active.length,
      closedPositions: closed.length,
      cancelledPositions: cancelled.length,
      rejectedPositions: rejected.length,
      winRate: closed.length > 0 ? wins.length / closed.length : 0,
      totalPnL,
      averagePnL: closed.length > 0 ? totalPnL / closed.length : 0,
      bestTrade,
      worstTrade,
    };
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _store: PositionStore | null = null;
let _initialized = false;

/**
 * Get the default PositionStore instance, initializing tables on first call.
 */
export async function getPositionStore(): Promise<PositionStore> {
  if (!_store) {
    _store = new PositionStore();
  }
  if (!_initialized) {
    await _store.init();
    _initialized = true;
  }
  return _store;
}
