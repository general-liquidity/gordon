/**
 * Runtime Store
 *
 * SQLite-backed persistent storage for strategy runtime state.
 * Tables:
 *   - strategy_slots: all slot data (capital, status, performance)
 *   - slot_trades: trades attributed to each slot
 *   - portfolio_snapshots: periodic portfolio state snapshots
 *
 * Follows the same patterns as PositionStore and the core database module.
 */

import type { Database } from "bun:sqlite";
import { getDatabase, executeWithLogging } from "../../infra/storage/database.ts";
import { createModuleLogger } from "../../infra/logger/index.ts";
import type { StrategySlot, SlotTradeRecord, PortfolioSnapshot } from "./types.ts";

const logger = createModuleLogger("runtime-store");

// ============================================================================
// Table Initialization
// ============================================================================

/**
 * Create the runtime tables if they don't exist.
 * Called once during RuntimeStore construction.
 */
export function initRuntimeTables(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS strategy_slots (
      slot_id TEXT PRIMARY KEY,
      playbook_name TEXT NOT NULL,
      allocated_capital REAL NOT NULL DEFAULT 0,
      allocated_percent REAL NOT NULL DEFAULT 0,
      used_capital REAL NOT NULL DEFAULT 0,
      available_capital REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      max_positions INTEGER NOT NULL DEFAULT 3,
      max_daily_trades INTEGER NOT NULL DEFAULT 10,
      max_loss_percent REAL NOT NULL DEFAULT 10,
      total_pnl REAL NOT NULL DEFAULT 0,
      total_trades INTEGER NOT NULL DEFAULT 0,
      winning_trades INTEGER NOT NULL DEFAULT 0,
      current_drawdown_percent REAL NOT NULL DEFAULT 0,
      peak_equity REAL NOT NULL DEFAULT 0,
      allowed_regimes TEXT NOT NULL DEFAULT '[]',
      started_at TEXT NOT NULL,
      paused_at TEXT,
      last_trade_at TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS slot_trades (
      id TEXT PRIMARY KEY,
      slot_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL CHECK(side IN ('long', 'short')),
      size_usd REAL NOT NULL,
      pnl REAL NOT NULL DEFAULT 0,
      fees REAL NOT NULL DEFAULT 0,
      opened_at TEXT NOT NULL,
      closed_at TEXT,
      FOREIGN KEY (slot_id) REFERENCES strategy_slots(slot_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS portfolio_snapshots (
      id TEXT PRIMARY KEY,
      total_capital REAL NOT NULL,
      allocated_capital REAL NOT NULL,
      deployed_capital REAL NOT NULL,
      total_pnl REAL NOT NULL,
      portfolio_drawdown_percent REAL NOT NULL DEFAULT 0,
      active_slots INTEGER NOT NULL DEFAULT 0,
      total_open_positions INTEGER NOT NULL DEFAULT 0,
      snapshot_at TEXT NOT NULL
    )
  `);

  // Indexes
  db.run("CREATE INDEX IF NOT EXISTS idx_strategy_slots_status ON strategy_slots(status)");
  db.run("CREATE INDEX IF NOT EXISTS idx_strategy_slots_playbook ON strategy_slots(playbook_name)");
  db.run("CREATE INDEX IF NOT EXISTS idx_slot_trades_slot_id ON slot_trades(slot_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_slot_trades_opened_at ON slot_trades(opened_at)");
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_at ON portfolio_snapshots(snapshot_at)",
  );

  logger.debug("Runtime tables initialized");
}

// ============================================================================
// JSON Helpers
// ============================================================================

function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

// ============================================================================
// Row Conversion
// ============================================================================

function rowToSlot(row: Record<string, unknown>): StrategySlot {
  return {
    slot_id: row.slot_id as string,
    playbook_name: row.playbook_name as string,
    allocated_capital: (row.allocated_capital as number) ?? 0,
    allocated_percent: (row.allocated_percent as number) ?? 0,
    used_capital: (row.used_capital as number) ?? 0,
    available_capital: (row.available_capital as number) ?? 0,
    status: (row.status as StrategySlot["status"]) ?? "stopped",
    max_positions: (row.max_positions as number) ?? 3,
    max_daily_trades: (row.max_daily_trades as number) ?? 10,
    max_loss_percent: (row.max_loss_percent as number) ?? 10,
    total_pnl: (row.total_pnl as number) ?? 0,
    total_trades: (row.total_trades as number) ?? 0,
    winning_trades: (row.winning_trades as number) ?? 0,
    current_drawdown_percent: (row.current_drawdown_percent as number) ?? 0,
    peak_equity: (row.peak_equity as number) ?? 0,
    allowed_regimes: safeJsonParse(row.allowed_regimes as string | null, []),
    started_at: row.started_at as string,
    paused_at: (row.paused_at as string) ?? undefined,
    last_trade_at: (row.last_trade_at as string) ?? undefined,
  };
}

function rowToSlotTrade(row: Record<string, unknown>): SlotTradeRecord {
  return {
    id: row.id as string,
    slot_id: row.slot_id as string,
    symbol: row.symbol as string,
    side: row.side as "long" | "short",
    size_usd: (row.size_usd as number) ?? 0,
    pnl: (row.pnl as number) ?? 0,
    fees: (row.fees as number) ?? 0,
    opened_at: row.opened_at as string,
    closed_at: (row.closed_at as string) ?? undefined,
  };
}

function rowToSnapshot(row: Record<string, unknown>): PortfolioSnapshot {
  return {
    id: row.id as string,
    total_capital: (row.total_capital as number) ?? 0,
    allocated_capital: (row.allocated_capital as number) ?? 0,
    deployed_capital: (row.deployed_capital as number) ?? 0,
    total_pnl: (row.total_pnl as number) ?? 0,
    portfolio_drawdown_percent: (row.portfolio_drawdown_percent as number) ?? 0,
    active_slots: (row.active_slots as number) ?? 0,
    total_open_positions: (row.total_open_positions as number) ?? 0,
    snapshot_at: row.snapshot_at as string,
  };
}

// ============================================================================
// Runtime Store
// ============================================================================

export class RuntimeStore {
  private db: Database;

  constructor(db?: Database) {
    this.db = db ?? getDatabase();
    initRuntimeTables(this.db);
  }

  // ==========================================================================
  // Strategy Slots
  // ==========================================================================

  /**
   * Save (upsert) a strategy slot.
   */
  saveSlot(slot: StrategySlot): void {
    const sql = `
      INSERT OR REPLACE INTO strategy_slots (
        slot_id, playbook_name,
        allocated_capital, allocated_percent, used_capital, available_capital,
        status,
        max_positions, max_daily_trades, max_loss_percent,
        total_pnl, total_trades, winning_trades,
        current_drawdown_percent, peak_equity,
        allowed_regimes,
        started_at, paused_at, last_trade_at
      ) VALUES (
        ?, ?,
        ?, ?, ?, ?,
        ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?,
        ?,
        ?, ?, ?
      )
    `;

    const stmt = this.db.prepare(sql);
    executeWithLogging(
      () =>
        stmt.run(
          slot.slot_id,
          slot.playbook_name,
          slot.allocated_capital,
          slot.allocated_percent,
          slot.used_capital,
          slot.available_capital,
          slot.status,
          slot.max_positions,
          slot.max_daily_trades,
          slot.max_loss_percent,
          slot.total_pnl,
          slot.total_trades,
          slot.winning_trades,
          slot.current_drawdown_percent,
          slot.peak_equity,
          JSON.stringify(slot.allowed_regimes),
          slot.started_at,
          slot.paused_at ?? null,
          slot.last_trade_at ?? null,
        ),
      "INSERT OR REPLACE strategy_slots",
    );
  }

  /**
   * Load a single slot by ID.
   */
  loadSlot(slotId: string): StrategySlot | null {
    const stmt = this.db.prepare("SELECT * FROM strategy_slots WHERE slot_id = ?");
    const row = executeWithLogging(
      () => stmt.get(slotId) as Record<string, unknown> | null,
      "SELECT strategy_slots by slot_id",
    );

    return row ? rowToSlot(row) : null;
  }

  /**
   * Load all slots with a given status.
   */
  loadSlotsByStatus(status: StrategySlot["status"]): StrategySlot[] {
    const stmt = this.db.prepare("SELECT * FROM strategy_slots WHERE status = ?");
    const rows = executeWithLogging(
      () => stmt.all(status) as Record<string, unknown>[],
      "SELECT strategy_slots by status",
    );

    return rows.map(rowToSlot);
  }

  /**
   * Load all slots (any status).
   */
  loadAllSlots(): StrategySlot[] {
    const stmt = this.db.prepare("SELECT * FROM strategy_slots ORDER BY started_at DESC");
    const rows = executeWithLogging(
      () => stmt.all() as Record<string, unknown>[],
      "SELECT all strategy_slots",
    );

    return rows.map(rowToSlot);
  }

  /**
   * Delete a slot by ID.
   */
  deleteSlot(slotId: string): void {
    const stmt = this.db.prepare("DELETE FROM strategy_slots WHERE slot_id = ?");
    executeWithLogging(() => stmt.run(slotId), "DELETE strategy_slots");
  }

  /**
   * Find a slot by playbook name (returns the first active/paused/cooldown slot).
   */
  findSlotByPlaybook(playbookName: string): StrategySlot | null {
    const sql = `
      SELECT * FROM strategy_slots
      WHERE playbook_name = ?
        AND status IN ('active', 'paused', 'cooldown', 'draining')
      ORDER BY started_at DESC
      LIMIT 1
    `;
    const stmt = this.db.prepare(sql);
    const row = executeWithLogging(
      () => stmt.get(playbookName) as Record<string, unknown> | null,
      "SELECT strategy_slots by playbook_name",
    );

    return row ? rowToSlot(row) : null;
  }

  // ==========================================================================
  // Slot Trades
  // ==========================================================================

  /**
   * Record a trade attributed to a slot.
   */
  recordTrade(trade: SlotTradeRecord): void {
    const sql = `
      INSERT INTO slot_trades (
        id, slot_id, symbol, side, size_usd, pnl, fees, opened_at, closed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const stmt = this.db.prepare(sql);
    executeWithLogging(
      () =>
        stmt.run(
          trade.id,
          trade.slot_id,
          trade.symbol,
          trade.side,
          trade.size_usd,
          trade.pnl,
          trade.fees,
          trade.opened_at,
          trade.closed_at ?? null,
        ),
      "INSERT slot_trades",
    );
  }

  /**
   * Update an existing trade (e.g., when it closes).
   */
  updateTrade(tradeId: string, updates: { pnl?: number; fees?: number; closed_at?: string }): void {
    const setParts: string[] = [];
    const values: (string | number)[] = [];

    if (updates.pnl !== undefined) {
      setParts.push("pnl = ?");
      values.push(updates.pnl);
    }
    if (updates.fees !== undefined) {
      setParts.push("fees = ?");
      values.push(updates.fees);
    }
    if (updates.closed_at !== undefined) {
      setParts.push("closed_at = ?");
      values.push(updates.closed_at);
    }

    if (setParts.length === 0) return;

    values.push(tradeId);
    const sql = `UPDATE slot_trades SET ${setParts.join(", ")} WHERE id = ?`;
    const stmt = this.db.prepare(sql);
    executeWithLogging(() => stmt.run(...values), "UPDATE slot_trades");
  }

  /**
   * Get trades for a specific slot.
   */
  getTradesForSlot(slotId: string, limit = 50): SlotTradeRecord[] {
    const stmt = this.db.prepare(
      "SELECT * FROM slot_trades WHERE slot_id = ? ORDER BY opened_at DESC LIMIT ?",
    );
    const rows = executeWithLogging(
      () => stmt.all(slotId, limit) as Record<string, unknown>[],
      "SELECT slot_trades by slot_id",
    );

    return rows.map(rowToSlotTrade);
  }

  /**
   * Count today's trades for a slot (for daily trade limits).
   */
  countTodaysTrades(slotId: string): number {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const stmt = this.db.prepare(
      "SELECT COUNT(*) as count FROM slot_trades WHERE slot_id = ? AND opened_at >= ?",
    );
    const row = executeWithLogging(
      () => stmt.get(slotId, todayStart.toISOString()) as { count: number } | null,
      "SELECT COUNT slot_trades today",
    );

    return row?.count ?? 0;
  }

  // ==========================================================================
  // Portfolio Snapshots
  // ==========================================================================

  /**
   * Save a portfolio snapshot.
   */
  saveSnapshot(snapshot: PortfolioSnapshot): void {
    const sql = `
      INSERT INTO portfolio_snapshots (
        id, total_capital, allocated_capital, deployed_capital,
        total_pnl, portfolio_drawdown_percent,
        active_slots, total_open_positions, snapshot_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const stmt = this.db.prepare(sql);
    executeWithLogging(
      () =>
        stmt.run(
          snapshot.id,
          snapshot.total_capital,
          snapshot.allocated_capital,
          snapshot.deployed_capital,
          snapshot.total_pnl,
          snapshot.portfolio_drawdown_percent,
          snapshot.active_slots,
          snapshot.total_open_positions,
          snapshot.snapshot_at,
        ),
      "INSERT portfolio_snapshots",
    );
  }

  /**
   * Get recent portfolio snapshots.
   */
  getRecentSnapshots(limit = 100): PortfolioSnapshot[] {
    const stmt = this.db.prepare(
      "SELECT * FROM portfolio_snapshots ORDER BY snapshot_at DESC LIMIT ?",
    );
    const rows = executeWithLogging(
      () => stmt.all(limit) as Record<string, unknown>[],
      "SELECT recent portfolio_snapshots",
    );

    return rows.map(rowToSnapshot);
  }

  /**
   * Get snapshots within a time range.
   */
  getSnapshotsInRange(from: string, to: string): PortfolioSnapshot[] {
    const stmt = this.db.prepare(
      "SELECT * FROM portfolio_snapshots WHERE snapshot_at >= ? AND snapshot_at <= ? ORDER BY snapshot_at ASC",
    );
    const rows = executeWithLogging(
      () => stmt.all(from, to) as Record<string, unknown>[],
      "SELECT portfolio_snapshots in range",
    );

    return rows.map(rowToSnapshot);
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _store: RuntimeStore | null = null;

/**
 * Get or create the default RuntimeStore singleton.
 */
export function getRuntimeStore(): RuntimeStore {
  if (!_store) {
    _store = new RuntimeStore();
  }
  return _store;
}

/**
 * Reset the singleton (for testing).
 */
export function resetRuntimeStore(): void {
  _store = null;
}
