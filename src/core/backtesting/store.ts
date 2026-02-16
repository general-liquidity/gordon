/**
 * Playbook Backtest Store
 *
 * SQLite persistence for playbook backtest results.
 * Follows the same patterns as src/backtest/storage.ts for consistency.
 */

import { getDatabase } from "../../infra/storage/index.ts";
import type { PlaybookBacktestResult } from "./types.ts";
import { createModuleLogger } from "../../infra/logger/index.ts";

const logger = createModuleLogger("playbook-backtest-store");

// ============================================================================
// Database Schema
// ============================================================================

/**
 * Initialize the playbook_backtest_results table.
 * Should be called during application startup.
 */
export function initPlaybookBacktestTable(): void {
  const db = getDatabase();

  db.run(`
    CREATE TABLE IF NOT EXISTS playbook_backtest_results (
      id TEXT PRIMARY KEY,
      playbook_name TEXT NOT NULL,
      symbol TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      config_json TEXT NOT NULL,
      result_json TEXT NOT NULL,
      created_at TEXT NOT NULL,

      -- Denormalized metrics for efficient queries
      total_return REAL NOT NULL,
      max_drawdown REAL NOT NULL,
      sharpe_ratio REAL NOT NULL,
      win_rate REAL NOT NULL,
      profit_factor REAL NOT NULL,
      total_trades INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_pb_bt_playbook_name
    ON playbook_backtest_results(playbook_name)
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_pb_bt_symbol
    ON playbook_backtest_results(symbol)
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_pb_bt_created_at
    ON playbook_backtest_results(created_at)
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_pb_bt_composite
    ON playbook_backtest_results(playbook_name, symbol, timeframe)
  `);

  logger.info("Playbook backtest results table initialized");
}

// ============================================================================
// Row Types
// ============================================================================

interface PlaybookBacktestRow {
  id: string;
  playbook_name: string;
  symbol: string;
  timeframe: string;
  start_date: string;
  end_date: string;
  config_json: string;
  result_json: string;
  created_at: string;
  total_return: number;
  max_drawdown: number;
  sharpe_ratio: number;
  win_rate: number;
  profit_factor: number;
  total_trades: number;
  duration_ms: number;
}

// ============================================================================
// Save
// ============================================================================

/**
 * Save a playbook backtest result to the database.
 *
 * @param result - The backtest result to persist
 * @returns The generated ID on success, null on failure
 */
export function savePlaybookBacktestResult(result: PlaybookBacktestResult): string | null {
  try {
    const db = getDatabase();
    initPlaybookBacktestTable();

    const id = `pbt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const stmt = db.prepare(`
      INSERT OR REPLACE INTO playbook_backtest_results (
        id, playbook_name, symbol, timeframe,
        start_date, end_date, config_json, result_json,
        created_at, total_return, max_drawdown,
        sharpe_ratio, win_rate, profit_factor,
        total_trades, duration_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      result.playbook_name,
      result.config.symbol,
      result.config.timeframe,
      result.config.start_date,
      result.config.end_date,
      JSON.stringify(result.config),
      JSON.stringify(result),
      result.ran_at,
      result.total_return_percent,
      result.max_drawdown_percent,
      result.sharpe_ratio,
      result.win_rate,
      result.profit_factor,
      result.total_trades,
      result.duration_ms
    );

    logger.info("Saved playbook backtest result", {
      id,
      playbook: result.playbook_name,
      symbol: result.config.symbol,
    });

    return id;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("Failed to save playbook backtest result", { error: msg });
    return null;
  }
}

// ============================================================================
// Load
// ============================================================================

/**
 * Load a playbook backtest result by ID.
 */
export function loadPlaybookBacktestResult(id: string): PlaybookBacktestResult | null {
  try {
    const db = getDatabase();
    initPlaybookBacktestTable();

    const stmt = db.prepare<PlaybookBacktestRow, [string]>(
      "SELECT * FROM playbook_backtest_results WHERE id = ?"
    );
    const row = stmt.get(id);
    if (!row) return null;

    return JSON.parse(row.result_json) as PlaybookBacktestResult;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("Failed to load playbook backtest result", { id, error: msg });
    return null;
  }
}

// ============================================================================
// Query
// ============================================================================

export interface PlaybookBacktestQuery {
  playbook_name?: string;
  symbol?: string;
  timeframe?: string;
  limit?: number;
  order_by?: "created_at" | "total_return" | "sharpe_ratio" | "win_rate";
  order_dir?: "asc" | "desc";
}

export interface PlaybookBacktestSummary {
  id: string;
  playbook_name: string;
  symbol: string;
  timeframe: string;
  start_date: string;
  end_date: string;
  total_return: number;
  max_drawdown: number;
  sharpe_ratio: number;
  win_rate: number;
  profit_factor: number;
  total_trades: number;
  created_at: string;
}

/**
 * List playbook backtest results with optional filters.
 */
export function listPlaybookBacktestResults(
  query: PlaybookBacktestQuery = {}
): PlaybookBacktestSummary[] {
  try {
    const db = getDatabase();
    initPlaybookBacktestTable();

    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (query.playbook_name) {
      conditions.push("playbook_name = ?");
      params.push(query.playbook_name);
    }
    if (query.symbol) {
      conditions.push("symbol = ?");
      params.push(query.symbol.toUpperCase());
    }
    if (query.timeframe) {
      conditions.push("timeframe = ?");
      params.push(query.timeframe);
    }

    const orderCol: Record<string, string> = {
      created_at: "created_at",
      total_return: "total_return",
      sharpe_ratio: "sharpe_ratio",
      win_rate: "win_rate",
    };
    const orderBy = orderCol[query.order_by ?? "created_at"] ?? "created_at";
    const orderDir = query.order_dir === "asc" ? "ASC" : "DESC";
    const limit = query.limit ?? 20;

    let sql = `
      SELECT id, playbook_name, symbol, timeframe,
             start_date, end_date, total_return, max_drawdown,
             sharpe_ratio, win_rate, profit_factor, total_trades,
             created_at
      FROM playbook_backtest_results
    `;

    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(" AND ")}`;
    }
    sql += ` ORDER BY ${orderBy} ${orderDir} LIMIT ${limit}`;

    const stmt = db.prepare<PlaybookBacktestSummary, (string | number)[]>(sql);
    return stmt.all(...params);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("Failed to list playbook backtest results", { error: msg });
    return [];
  }
}

/**
 * Get the most recent backtest result for a given playbook+symbol+timeframe.
 */
export function getLatestPlaybookBacktest(
  playbookName: string,
  symbol: string,
  timeframe: string
): PlaybookBacktestResult | null {
  try {
    const db = getDatabase();
    initPlaybookBacktestTable();

    const stmt = db.prepare<PlaybookBacktestRow, [string, string, string]>(`
      SELECT * FROM playbook_backtest_results
      WHERE playbook_name = ? AND symbol = ? AND timeframe = ?
      ORDER BY created_at DESC
      LIMIT 1
    `);
    const row = stmt.get(playbookName, symbol.toUpperCase(), timeframe);
    if (!row) return null;

    return JSON.parse(row.result_json) as PlaybookBacktestResult;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("Failed to get latest playbook backtest", { error: msg });
    return null;
  }
}

/**
 * Delete old playbook backtest results.
 */
export function cleanupPlaybookBacktests(olderThanDays: number): number {
  try {
    const db = getDatabase();
    const cutoff = new Date(
      Date.now() - olderThanDays * 24 * 60 * 60 * 1000
    ).toISOString();

    const result = db.run(
      "DELETE FROM playbook_backtest_results WHERE created_at < ?",
      [cutoff]
    );

    if (result.changes > 0) {
      logger.info("Cleaned up old playbook backtest results", {
        deleted: String(result.changes),
      });
    }

    return result.changes;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("Failed to cleanup playbook backtests", { error: msg });
    return 0;
  }
}
