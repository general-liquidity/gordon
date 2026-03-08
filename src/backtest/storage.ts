/**
 * Backtest Result Storage Module
 *
 * Provides persistence for backtest results using SQLite.
 * Enables saving, loading, and querying historical backtest runs.
 */

import { getDatabase } from "../infra/storage/index.ts";
import type { BacktestResult, BacktestMetrics } from "./types.ts";
import { createModuleLogger } from "../infra/logger/index.ts";

const logger = createModuleLogger("backtest-storage");

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Storage key for identifying a backtest
 */
export interface BacktestKey {
  /** Strategy ID */
  strategyId: string;

  /** Trading symbol */
  symbol: string;

  /** Start date (ISO string or timestamp) */
  startDate: string | number;

  /** End date (ISO string or timestamp) */
  endDate: string | number;

  /** Timeframe (optional, for more specific queries) */
  timeframe?: string;
}

/**
 * Query options for listing backtest history
 */
export interface BacktestQueryOptions {
  /** Filter by strategy ID */
  strategyId?: string;

  /** Filter by symbol */
  symbol?: string;

  /** Filter by timeframe */
  timeframe?: string;

  /** Filter by minimum total return */
  minReturn?: number;

  /** Filter by maximum drawdown */
  maxDrawdown?: number;

  /** Filter by date range - start */
  fromDate?: string;

  /** Filter by date range - end */
  toDate?: string;

  /** Order by field */
  orderBy?: "createdAt" | "totalReturn" | "sharpeRatio" | "maxDrawdown" | "winRate";

  /** Order direction */
  orderDirection?: "asc" | "desc";

  /** Limit number of results */
  limit?: number;

  /** Offset for pagination */
  offset?: number;
}

/**
 * Summary of a backtest result for listing
 */
export interface BacktestSummary {
  /** Unique result ID */
  id: string;

  /** Strategy ID */
  strategyId: string;

  /** Strategy name */
  strategyName: string;

  /** Trading symbol */
  symbol: string;

  /** Timeframe */
  timeframe: string;

  /** Start date */
  startDate: string;

  /** End date */
  endDate: string;

  /** Total return percentage */
  totalReturn: number;

  /** Maximum drawdown percentage */
  maxDrawdown: number;

  /** Sharpe ratio */
  sharpeRatio: number;

  /** Win rate percentage */
  winRate: number;

  /** Total number of trades */
  totalTrades: number;

  /** When the backtest was run */
  createdAt: string;
}

/**
 * Result of a storage operation
 */
export interface StorageOperationResult {
  /** Whether the operation succeeded */
  success: boolean;

  /** Result ID (for save operations) */
  id?: string;

  /** Error message if failed */
  error?: string;
}

// ============================================================================
// Database Schema
// ============================================================================

/**
 * Initialize the backtest_results table in the database.
 * Should be called during application startup.
 */
export function initBacktestResultsTable(): void {
  const db = getDatabase();

  db.run(`
    CREATE TABLE IF NOT EXISTS backtest_results (
      id TEXT PRIMARY KEY,
      strategy_id TEXT NOT NULL,
      strategy_name TEXT NOT NULL,
      symbol TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      config_json TEXT NOT NULL,
      metrics_json TEXT NOT NULL,
      trades_json TEXT NOT NULL,
      equity_curve_json TEXT NOT NULL,
      drawdown_curve_json TEXT NOT NULL,
      execution_time INTEGER NOT NULL,
      warnings_json TEXT NOT NULL,
      metadata_json TEXT,
      created_at TEXT NOT NULL,

      -- Denormalized metrics for efficient querying
      total_return REAL NOT NULL,
      max_drawdown REAL NOT NULL,
      sharpe_ratio REAL NOT NULL,
      win_rate REAL NOT NULL,
      total_trades INTEGER NOT NULL
    )
  `);

  // Create indexes for common queries
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_backtest_results_strategy_id
    ON backtest_results(strategy_id)
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_backtest_results_symbol
    ON backtest_results(symbol)
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_backtest_results_timeframe
    ON backtest_results(timeframe)
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_backtest_results_created_at
    ON backtest_results(created_at)
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_backtest_results_total_return
    ON backtest_results(total_return)
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_backtest_results_sharpe_ratio
    ON backtest_results(sharpe_ratio)
  `);

  // Create composite index for key lookups
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_backtest_results_key
    ON backtest_results(strategy_id, symbol, start_date, end_date)
  `);

  logger.info("Backtest results table initialized");

  try {
    db.run("ALTER TABLE backtest_results ADD COLUMN metadata_json TEXT");
  } catch {
    // Column already exists in most runs. SQLite does not support IF NOT EXISTS here.
  }
}

// ============================================================================
// Save Operations
// ============================================================================

/**
 * Save a backtest result to the database.
 *
 * @param result - The backtest result to save
 * @returns Operation result with the saved ID
 *
 * @example
 * ```typescript
 * const { success, id } = await saveBacktestResult(backtestResult);
 * if (success) {
 *   console.log(`Saved backtest with ID: ${id}`);
 * }
 * ```
 */
export function saveBacktestResult(result: BacktestResult): StorageOperationResult {
  try {
    const db = getDatabase();

    // Ensure table exists
    initBacktestResultsTable();

    const id = result.id || `bt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const insertStmt = db.prepare(`
      INSERT OR REPLACE INTO backtest_results (
        id,
        strategy_id,
        strategy_name,
        symbol,
        timeframe,
        start_date,
        end_date,
        config_json,
        metrics_json,
        trades_json,
        equity_curve_json,
        drawdown_curve_json,
        execution_time,
        warnings_json,
        metadata_json,
        created_at,
        total_return,
        max_drawdown,
        sharpe_ratio,
        win_rate,
        total_trades
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertStmt.run(
      id,
      result.config.strategyId,
      result.strategyName,
      result.config.symbol,
      result.config.timeframe,
      result.startDate,
      result.endDate,
      JSON.stringify(result.config),
      JSON.stringify(result.metrics),
      JSON.stringify(result.trades),
      JSON.stringify(result.equityCurve),
      JSON.stringify(result.drawdownCurve),
      result.executionTime,
      JSON.stringify(result.warnings),
      result.systematic ? JSON.stringify(result.systematic) : null,
      result.createdAt,
      result.metrics.totalReturn,
      result.metrics.maxDrawdown,
      result.metrics.sharpeRatio,
      result.metrics.winRate,
      result.metrics.totalTrades
    );

    logger.info("Saved backtest result", {
      id,
      strategy: result.config.strategyId,
      symbol: result.config.symbol,
    });

    return { success: true, id };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Failed to save backtest result", { error: message });
    return { success: false, error: message };
  }
}

// ============================================================================
// Load Operations
// ============================================================================

/**
 * Load a backtest result by ID.
 *
 * @param id - The backtest result ID
 * @returns The backtest result or null if not found
 */
export function loadBacktestResult(id: string): BacktestResult | null {
  try {
    const db = getDatabase();

    // Ensure table exists
    initBacktestResultsTable();

    const query = db.prepare<BacktestResultRow, [string]>(`
      SELECT * FROM backtest_results WHERE id = ?
    `);

    const row = query.get(id);

    if (!row) {
      return null;
    }

    return rowToBacktestResult(row);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Failed to load backtest result", { id, error: message });
    return null;
  }
}

/**
 * Load a backtest result by key (strategy + symbol + date range).
 *
 * @param key - The backtest key
 * @returns The backtest result or null if not found
 */
export function loadBacktestResultByKey(key: BacktestKey): BacktestResult | null {
  try {
    const db = getDatabase();

    // Ensure table exists
    initBacktestResultsTable();

    const startDate = typeof key.startDate === "number"
      ? new Date(key.startDate).toISOString()
      : key.startDate;

    const endDate = typeof key.endDate === "number"
      ? new Date(key.endDate).toISOString()
      : key.endDate;

    let sql = `
      SELECT * FROM backtest_results
      WHERE strategy_id = ? AND symbol = ? AND start_date = ? AND end_date = ?
    `;
    const params: string[] = [key.strategyId, key.symbol, startDate, endDate];

    if (key.timeframe) {
      sql += " AND timeframe = ?";
      params.push(key.timeframe);
    }

    sql += " ORDER BY created_at DESC LIMIT 1";

    const query = db.prepare<BacktestResultRow, string[]>(sql);
    const row = query.get(...params);

    if (!row) {
      return null;
    }

    return rowToBacktestResult(row);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Failed to load backtest result by key", { error: message });
    return null;
  }
}

// ============================================================================
// Query Operations
// ============================================================================

/**
 * List backtest history with optional filters.
 *
 * @param options - Query options for filtering and sorting
 * @returns Array of backtest summaries
 *
 * @example
 * ```typescript
 * const history = listBacktestHistory({
 *   strategyId: 'support_bounce',
 *   symbol: 'BTCUSDT',
 *   orderBy: 'totalReturn',
 *   orderDirection: 'desc',
 *   limit: 10,
 * });
 * ```
 */
export function listBacktestHistory(
  options: BacktestQueryOptions = {}
): BacktestSummary[] {
  try {
    const db = getDatabase();

    // Ensure table exists
    initBacktestResultsTable();

    // Build WHERE clause
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (options.strategyId) {
      conditions.push("strategy_id = ?");
      params.push(options.strategyId);
    }

    if (options.symbol) {
      conditions.push("symbol = ?");
      params.push(options.symbol.toUpperCase());
    }

    if (options.timeframe) {
      conditions.push("timeframe = ?");
      params.push(options.timeframe);
    }

    if (options.minReturn !== undefined) {
      conditions.push("total_return >= ?");
      params.push(options.minReturn);
    }

    if (options.maxDrawdown !== undefined) {
      conditions.push("max_drawdown <= ?");
      params.push(options.maxDrawdown);
    }

    if (options.fromDate) {
      conditions.push("created_at >= ?");
      params.push(options.fromDate);
    }

    if (options.toDate) {
      conditions.push("created_at <= ?");
      params.push(options.toDate);
    }

    // Build ORDER BY clause
    const orderByMap: Record<string, string> = {
      createdAt: "created_at",
      totalReturn: "total_return",
      sharpeRatio: "sharpe_ratio",
      maxDrawdown: "max_drawdown",
      winRate: "win_rate",
    };

    const orderBy = orderByMap[options.orderBy ?? "createdAt"] ?? "created_at";
    const orderDirection = options.orderDirection === "asc" ? "ASC" : "DESC";

    // Build query
    let sql = `
      SELECT
        id,
        strategy_id,
        strategy_name,
        symbol,
        timeframe,
        start_date,
        end_date,
        total_return,
        max_drawdown,
        sharpe_ratio,
        win_rate,
        total_trades,
        created_at
      FROM backtest_results
    `;

    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(" AND ")}`;
    }

    sql += ` ORDER BY ${orderBy} ${orderDirection}`;

    if (options.limit) {
      sql += ` LIMIT ${options.limit}`;
    }

    if (options.offset) {
      sql += ` OFFSET ${options.offset}`;
    }

    const query = db.prepare<BacktestSummaryRow, (string | number)[]>(sql);
    const rows = query.all(...params);

    return rows.map(rowToBacktestSummary);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Failed to list backtest history", { error: message });
    return [];
  }
}

/**
 * Get the count of backtest results matching filters.
 *
 * @param options - Query options for filtering
 * @returns Number of matching results
 */
export function countBacktestHistory(
  options: Omit<BacktestQueryOptions, "orderBy" | "orderDirection" | "limit" | "offset"> = {}
): number {
  try {
    const db = getDatabase();

    // Ensure table exists
    initBacktestResultsTable();

    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (options.strategyId) {
      conditions.push("strategy_id = ?");
      params.push(options.strategyId);
    }

    if (options.symbol) {
      conditions.push("symbol = ?");
      params.push(options.symbol.toUpperCase());
    }

    if (options.timeframe) {
      conditions.push("timeframe = ?");
      params.push(options.timeframe);
    }

    if (options.minReturn !== undefined) {
      conditions.push("total_return >= ?");
      params.push(options.minReturn);
    }

    if (options.maxDrawdown !== undefined) {
      conditions.push("max_drawdown <= ?");
      params.push(options.maxDrawdown);
    }

    let sql = "SELECT COUNT(*) as count FROM backtest_results";

    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(" AND ")}`;
    }

    const query = db.prepare<{ count: number }, (string | number)[]>(sql);
    const result = query.get(...params);

    return result?.count ?? 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Failed to count backtest history", { error: message });
    return 0;
  }
}

// ============================================================================
// Delete Operations
// ============================================================================

/**
 * Delete a backtest result by ID.
 *
 * @param id - The backtest result ID
 * @returns Whether the deletion was successful
 */
export function deleteBacktestResult(id: string): boolean {
  try {
    const db = getDatabase();
    const result = db.run("DELETE FROM backtest_results WHERE id = ?", [id]);
    return result.changes > 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Failed to delete backtest result", { id, error: message });
    return false;
  }
}

/**
 * Delete all backtest results for a strategy.
 *
 * @param strategyId - The strategy ID
 * @returns Number of deleted records
 */
export function deleteBacktestResultsByStrategy(strategyId: string): number {
  try {
    const db = getDatabase();
    const result = db.run(
      "DELETE FROM backtest_results WHERE strategy_id = ?",
      [strategyId]
    );
    return result.changes;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Failed to delete backtest results by strategy", {
      strategyId,
      error: message,
    });
    return 0;
  }
}

/**
 * Clean up old backtest results.
 *
 * @param olderThanDays - Delete results older than this many days
 * @returns Number of deleted records
 */
export function cleanupOldBacktestResults(olderThanDays: number): number {
  try {
    const db = getDatabase();
    const cutoff = new Date(
      Date.now() - olderThanDays * 24 * 60 * 60 * 1000
    ).toISOString();

    const result = db.run(
      "DELETE FROM backtest_results WHERE created_at < ?",
      [cutoff]
    );

    if (result.changes > 0) {
      logger.info("Cleaned up old backtest results", {
        deleted: String(result.changes),
        olderThan: cutoff,
      });
    }

    return result.changes;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Failed to cleanup old backtest results", { error: message });
    return 0;
  }
}

// ============================================================================
// Statistics Operations
// ============================================================================

/**
 * Get statistics about stored backtest results.
 *
 * @returns Statistics object
 */
export function getBacktestStorageStats(): {
  totalResults: number;
  strategyCounts: Record<string, number>;
  symbolCounts: Record<string, number>;
  oldestResult: string | null;
  newestResult: string | null;
  avgTotalReturn: number;
  avgSharpeRatio: number;
} {
  try {
    const db = getDatabase();

    // Ensure table exists
    initBacktestResultsTable();

    // Total count
    const totalResult = db.prepare<{ count: number }, []>(
      "SELECT COUNT(*) as count FROM backtest_results"
    ).get();
    const totalResults = totalResult?.count ?? 0;

    if (totalResults === 0) {
      return {
        totalResults: 0,
        strategyCounts: {},
        symbolCounts: {},
        oldestResult: null,
        newestResult: null,
        avgTotalReturn: 0,
        avgSharpeRatio: 0,
      };
    }

    // Strategy counts
    const strategyRows = db.prepare<{ strategy_id: string; count: number }, []>(
      "SELECT strategy_id, COUNT(*) as count FROM backtest_results GROUP BY strategy_id"
    ).all();
    const strategyCounts: Record<string, number> = {};
    for (const row of strategyRows) {
      strategyCounts[row.strategy_id] = row.count;
    }

    // Symbol counts
    const symbolRows = db.prepare<{ symbol: string; count: number }, []>(
      "SELECT symbol, COUNT(*) as count FROM backtest_results GROUP BY symbol"
    ).all();
    const symbolCounts: Record<string, number> = {};
    for (const row of symbolRows) {
      symbolCounts[row.symbol] = row.count;
    }

    // Date range
    const dateResult = db.prepare<
      { oldest: string | null; newest: string | null },
      []
    >(
      "SELECT MIN(created_at) as oldest, MAX(created_at) as newest FROM backtest_results"
    ).get();

    // Averages
    const avgResult = db.prepare<
      { avg_return: number | null; avg_sharpe: number | null },
      []
    >(
      "SELECT AVG(total_return) as avg_return, AVG(sharpe_ratio) as avg_sharpe FROM backtest_results"
    ).get();

    return {
      totalResults,
      strategyCounts,
      symbolCounts,
      oldestResult: dateResult?.oldest ?? null,
      newestResult: dateResult?.newest ?? null,
      avgTotalReturn: avgResult?.avg_return ?? 0,
      avgSharpeRatio: avgResult?.avg_sharpe ?? 0,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Failed to get backtest storage stats", { error: message });
    return {
      totalResults: 0,
      strategyCounts: {},
      symbolCounts: {},
      oldestResult: null,
      newestResult: null,
      avgTotalReturn: 0,
      avgSharpeRatio: 0,
    };
  }
}

// ============================================================================
// Internal Types
// ============================================================================

interface BacktestResultRow {
  id: string;
  strategy_id: string;
  strategy_name: string;
  symbol: string;
  timeframe: string;
  start_date: string;
  end_date: string;
  config_json: string;
  metrics_json: string;
  trades_json: string;
  equity_curve_json: string;
  drawdown_curve_json: string;
  execution_time: number;
  warnings_json: string;
  metadata_json: string | null;
  created_at: string;
  total_return: number;
  max_drawdown: number;
  sharpe_ratio: number;
  win_rate: number;
  total_trades: number;
}

interface BacktestSummaryRow {
  id: string;
  strategy_id: string;
  strategy_name: string;
  symbol: string;
  timeframe: string;
  start_date: string;
  end_date: string;
  total_return: number;
  max_drawdown: number;
  sharpe_ratio: number;
  win_rate: number;
  total_trades: number;
  created_at: string;
}

// ============================================================================
// Conversion Functions
// ============================================================================

function rowToBacktestResult(row: BacktestResultRow): BacktestResult {
  return {
    id: row.id,
    strategyName: row.strategy_name,
    config: JSON.parse(row.config_json),
    metrics: JSON.parse(row.metrics_json),
    trades: JSON.parse(row.trades_json),
    equityCurve: JSON.parse(row.equity_curve_json),
    drawdownCurve: JSON.parse(row.drawdown_curve_json),
    startDate: row.start_date,
    endDate: row.end_date,
    executionTime: row.execution_time,
    createdAt: row.created_at,
    warnings: JSON.parse(row.warnings_json),
    systematic: row.metadata_json ? JSON.parse(row.metadata_json) : undefined,
  };
}

function rowToBacktestSummary(row: BacktestSummaryRow): BacktestSummary {
  return {
    id: row.id,
    strategyId: row.strategy_id,
    strategyName: row.strategy_name,
    symbol: row.symbol,
    timeframe: row.timeframe,
    startDate: row.start_date,
    endDate: row.end_date,
    totalReturn: row.total_return,
    maxDrawdown: row.max_drawdown,
    sharpeRatio: row.sharpe_ratio,
    winRate: row.win_rate,
    totalTrades: row.total_trades,
    createdAt: row.created_at,
  };
}
