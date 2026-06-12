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
 * SQLite returns NULL columns as JS null, but PositionRecord optionals (and
 * the zod schema validating every state transition) only accept undefined.
 * Without this conversion, any position reloaded from the DB failed
 * validateMergedPosition on its next transition — the failure was swallowed
 * upstream and left phantom rows stuck in pre-fill states.
 */
function optScalar<T>(value: unknown): T | undefined {
  return value === null || value === undefined ? undefined : (value as T);
}

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
    entryPrice: optScalar<number>(row.entryPrice),
    quantity: optScalar<number>(row.quantity),

    // Management phase
    stopLoss: optScalar<number>(row.stopLoss),
    takeProfit: optScalar<number>(row.takeProfit),
    trailingStop: safeJsonParseOptional(row.trailingStop as string | null),
    currentPrice: optScalar<number>(row.currentPrice),
    unrealizedPnL: optScalar<number>(row.unrealizedPnL),
    highWaterMark: optScalar<number>(row.highWaterMark),

    // Close phase
    exitOrder: safeJsonParseOptional(row.exitOrder as string | null),
    exitPrice: optScalar<number>(row.exitPrice),
    realizedPnL: optScalar<number>(row.realizedPnL),

    // Review phase
    review: safeJsonParseOptional(row.review as string | null),

    // Metadata
    strategyId: optScalar<string>(row.strategyId),
    playbookId: optScalar<string>(row.playbookId),
    tags: safeJsonParseOptional(row.tags as string | null),
    cancelReason: optScalar<string>(row.cancelReason),
    rejectReason: optScalar<string>(row.rejectReason),
    closeReason: optScalar<string>(row.closeReason),
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
    closedAt: optScalar<string>(row.closedAt),
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
// Phantom Positions
// ============================================================================

/**
 * A position claiming zero (or explicitly non-positive) quantity/entryPrice
 * is not a position. NULL quantity/entry is legitimate only for fresh
 * pre-fill records; once a record is older than the grace window and has no
 * entry order either, it is debris (typically left behind by interrupted
 * lifecycle syncs).
 */
export const PHANTOM_GRACE_MS = 60 * 60 * 1000;

/** SQL predicate matching phantom rows. Takes one bound param: createdAt cutoff (ISO). */
const PHANTOM_PREDICATE_SQL =
  "(IFNULL(quantity, 0) = 0 AND IFNULL(entryPrice, 0) = 0 AND entryOrder IS NULL AND createdAt < ?)";

function phantomCutoffIso(): string {
  return new Date(Date.now() - PHANTOM_GRACE_MS).toISOString();
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
   * Rejects explicit zero/negative quantity or entryPrice — a position with
   * qty 0 and entry 0 is not a position. Absent (undefined) values stay legal
   * for pre-fill lifecycle states.
   */
  async save(position: PositionRecord): Promise<void> {
    for (const [field, value] of [
      ["quantity", position.quantity],
      ["entryPrice", position.entryPrice],
    ] as const) {
      if (typeof value === "number" && !(value > 0)) {
        throw new Error(
          `Phantom position rejected: ${field}=${value} for ${position.symbol} (${position.id}). ` +
            `Positions must have positive quantity and entryPrice, or omit them pre-fill.`,
        );
      }
    }
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
   * Legacy phantom rows (zero qty + zero entry + no entry order, past the
   * grace window) are excluded at read — they are not open positions.
   */
  async getActive(): Promise<PositionRecord[]> {
    const terminalList = Array.from(TERMINAL_STATES)
      .map((s) => `'${s}'`)
      .join(", ");

    const query =
      `SELECT * FROM positions WHERE state NOT IN (${terminalList}) ` +
      `AND NOT ${PHANTOM_PREDICATE_SQL} ORDER BY updatedAt DESC`;
    const stmt = this.db.prepare(query);
    const rows = executeWithLogging(
      () => stmt.all(phantomCutoffIso()) as Record<string, unknown>[],
      "SELECT active positions"
    );
    return rows.map(rowToPosition);
  }

  /**
   * Get active phantom rows (the complement of the getActive filter) so the
   * reconciliation cycle can archive them.
   */
  async getPhantoms(): Promise<PositionRecord[]> {
    const terminalList = Array.from(TERMINAL_STATES)
      .map((s) => `'${s}'`)
      .join(", ");

    const query =
      `SELECT * FROM positions WHERE state NOT IN (${terminalList}) ` +
      `AND ${PHANTOM_PREDICATE_SQL} ORDER BY createdAt ASC`;
    const stmt = this.db.prepare(query);
    const rows = executeWithLogging(
      () => stmt.all(phantomCutoffIso()) as Record<string, unknown>[],
      "SELECT phantom positions"
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

/**
 * Reset the singleton. Required by test isolation: the store caches a
 * Database handle, so after setDatabasePathForTesting() switches (and
 * closes) the underlying DB, a cached store would hold a dead handle.
 */
export function _resetPositionStoreForTests(): void {
  _store = null;
  _initialized = false;
}
