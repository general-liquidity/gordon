/**
 * Generated Strategies Storage
 *
 * Persistence layer for AI-generated strategies and their backtest results.
 * Uses SQLite for efficient querying and retrieval.
 */

import { getDatabase } from "../index.ts";
import type { StrategyDSL } from "../../../strategies/dsl/schema.ts";
import type { BacktestResult } from "../../../backtest/types.ts";
import { createModuleLogger } from "../../logger/index.ts";

const logger = createModuleLogger("generated-strategies-storage");

function ensureBacktestResultColumn(): void {
  const db = getDatabase();

  const columns = db.query("PRAGMA table_info(generated_strategy_backtests)").all();
  const hasResultColumn = columns.some((col) => (col as { name?: string }).name === "result_json");

  if (!hasResultColumn) {
    db.run("ALTER TABLE generated_strategy_backtests ADD COLUMN result_json TEXT");
    logger.info("Added result_json column to generated_strategy_backtests");
  }
}

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Summary of a generated strategy for listing
 */
export interface GeneratedStrategySummary {
  id: string;
  name: string;
  description: string;
  riskLevel: string;
  timeframes: string[];
  createdAt: string;
  backtestReturn?: number;
  backtestSharpe?: number;
  backtestWinRate?: number;
}

/**
 * Query options for listing generated strategies
 */
export interface GeneratedStrategyQueryOptions {
  /** Filter by risk level */
  riskLevel?: "low" | "medium" | "high";
  /** Filter by minimum return */
  minReturn?: number;
  /** Filter by minimum Sharpe ratio */
  minSharpe?: number;
  /** Order by field */
  orderBy?: "createdAt" | "backtestReturn" | "backtestSharpe" | "name";
  /** Order direction */
  orderDirection?: "asc" | "desc";
  /** Limit results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

// ============================================================================
// Database Initialization
// ============================================================================

/**
 * Initialize the generated strategies table
 */
export function initGeneratedStrategiesTable(): void {
  const db = getDatabase();

  db.run(`
    CREATE TABLE IF NOT EXISTS generated_strategies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      version TEXT NOT NULL,
      tier TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      timeframes_json TEXT NOT NULL,
      dsl_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      -- Denormalized backtest metrics
      backtest_return REAL,
      backtest_sharpe REAL,
      backtest_win_rate REAL,
      backtest_drawdown REAL,
      backtest_trades INTEGER
    )
  `);

  // Create indexes
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_generated_strategies_risk_level
    ON generated_strategies(risk_level)
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_generated_strategies_created_at
    ON generated_strategies(created_at)
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_generated_strategies_backtest_return
    ON generated_strategies(backtest_return)
  `);

  // Create backtest results table for generated strategies
  db.run(`
    CREATE TABLE IF NOT EXISTS generated_strategy_backtests (
      id TEXT PRIMARY KEY,
      strategy_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      config_json TEXT NOT NULL,
      metrics_json TEXT NOT NULL,
      trades_json TEXT NOT NULL,
      equity_curve_json TEXT NOT NULL,
      result_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (strategy_id) REFERENCES generated_strategies(id)
    )
  `);

  // Migration for existing databases created before result_json was introduced.
  try {
    ensureBacktestResultColumn();
  } catch (error) {
    logger.warn("Failed to ensure generated_strategy_backtests.result_json column", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_generated_strategy_backtests_strategy_id
    ON generated_strategy_backtests(strategy_id)
  `);

  logger.info("Generated strategies tables initialized");
}

// ============================================================================
// Save Operations
// ============================================================================

/**
 * Save a generated strategy and its backtest result
 */
export async function saveGeneratedStrategy(
  strategy: StrategyDSL,
  backtestResult?: BacktestResult
): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    const db = getDatabase();

    // Ensure tables exist
    initGeneratedStrategiesTable();

    const now = new Date().toISOString();

    // Insert or replace the strategy
    const insertStmt = db.prepare(`
      INSERT OR REPLACE INTO generated_strategies (
        id, name, description, version, tier, risk_level,
        timeframes_json, dsl_json, created_at, updated_at,
        backtest_return, backtest_sharpe, backtest_win_rate,
        backtest_drawdown, backtest_trades
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertStmt.run(
      strategy.id,
      strategy.name,
      strategy.description,
      strategy.version,
      strategy.tier,
      strategy.riskLevel,
      JSON.stringify(strategy.timeframes),
      JSON.stringify(strategy),
      strategy.metadata?.generatedAt || now,
      now,
      backtestResult?.metrics.totalReturn ?? null,
      backtestResult?.metrics.sharpeRatio ?? null,
      backtestResult?.metrics.winRate ?? null,
      backtestResult?.metrics.maxDrawdown ?? null,
      backtestResult?.metrics.totalTrades ?? null
    );

    // Save backtest result if provided
    if (backtestResult) {
      const backtestStmt = db.prepare(`
        INSERT OR REPLACE INTO generated_strategy_backtests (
          id, strategy_id, symbol, timeframe, config_json,
          metrics_json, trades_json, equity_curve_json, result_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      backtestStmt.run(
        backtestResult.id,
        strategy.id,
        backtestResult.config.symbol,
        backtestResult.config.timeframe,
        JSON.stringify(backtestResult.config),
        JSON.stringify(backtestResult.metrics),
        JSON.stringify(backtestResult.trades.slice(0, 100)), // Limit trades stored
        JSON.stringify(backtestResult.equityCurve.slice(0, 500)), // Limit curve points
        JSON.stringify(backtestResult),
        now
      );
    }

    logger.info("Saved generated strategy", { id: strategy.id, name: strategy.name });

    return { success: true, id: strategy.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Failed to save generated strategy", { error: message });
    return { success: false, error: message };
  }
}

// ============================================================================
// Load Operations
// ============================================================================

/**
 * Load a generated strategy by ID
 */
export async function loadGeneratedStrategy(id: string): Promise<StrategyDSL | null> {
  try {
    const db = getDatabase();

    // Ensure tables exist
    initGeneratedStrategiesTable();

    const query = db.prepare<{ dsl_json: string }, [string]>(`
      SELECT dsl_json FROM generated_strategies WHERE id = ?
    `);

    const row = query.get(id);

    if (!row) {
      return null;
    }

    return JSON.parse(row.dsl_json) as StrategyDSL;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Failed to load generated strategy", { id, error: message });
    return null;
  }
}

/**
 * Get backtest result for a generated strategy
 */
export async function getGeneratedStrategyBacktest(
  strategyId: string
): Promise<BacktestResult | null> {
  try {
    const db = getDatabase();

    // Ensure tables exist
    initGeneratedStrategiesTable();

    const query = db.prepare<{
      id: string;
      strategy_id: string;
      symbol: string;
      timeframe: string;
      config_json: string;
      metrics_json: string;
      trades_json: string;
      equity_curve_json: string;
      result_json: string | null;
      created_at: string;
    }, [string]>(`
      SELECT * FROM generated_strategy_backtests
      WHERE strategy_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `);

    const row = query.get(strategyId);

    if (!row) {
      return null;
    }

    if (row.result_json) {
      try {
        const parsed = JSON.parse(row.result_json) as BacktestResult;

        return {
          ...parsed,
          id: parsed.id || row.id,
          strategyName: parsed.strategyName || strategyId,
          drawdownCurve: Array.isArray(parsed.drawdownCurve) ? parsed.drawdownCurve : [],
          startDate: parsed.startDate || "",
          endDate: parsed.endDate || "",
          executionTime: parsed.executionTime ?? 0,
          createdAt: parsed.createdAt || row.created_at,
          warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
        };
      } catch (error) {
        logger.warn("Failed to parse result_json for generated strategy backtest", {
          strategyId,
          backtestId: row.id,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return {
      id: row.id,
      strategyName: strategyId,
      config: JSON.parse(row.config_json),
      metrics: JSON.parse(row.metrics_json),
      trades: JSON.parse(row.trades_json),
      equityCurve: JSON.parse(row.equity_curve_json),
      drawdownCurve: [],
      startDate: "",
      endDate: "",
      executionTime: 0,
      createdAt: row.created_at,
      warnings: ["Loaded legacy backtest record with partial metadata."],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Failed to get backtest for strategy", { strategyId, error: message });
    return null;
  }
}

// ============================================================================
// List Operations
// ============================================================================

/**
 * List generated strategies with optional filtering
 */
export function listGeneratedStrategies(
  options: GeneratedStrategyQueryOptions = {}
): GeneratedStrategySummary[] {
  try {
    const db = getDatabase();

    // Ensure tables exist
    initGeneratedStrategiesTable();

    // Build query
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (options.riskLevel) {
      conditions.push("risk_level = ?");
      params.push(options.riskLevel);
    }

    if (options.minReturn !== undefined) {
      conditions.push("backtest_return >= ?");
      params.push(options.minReturn);
    }

    if (options.minSharpe !== undefined) {
      conditions.push("backtest_sharpe >= ?");
      params.push(options.minSharpe);
    }

    // Build ORDER BY
    const orderByMap: Record<string, string> = {
      createdAt: "created_at",
      backtestReturn: "backtest_return",
      backtestSharpe: "backtest_sharpe",
      name: "name",
    };

    const orderBy = orderByMap[options.orderBy ?? "createdAt"] ?? "created_at";
    const orderDirection = options.orderDirection === "asc" ? "ASC" : "DESC";

    let sql = `
      SELECT
        id, name, description, risk_level, timeframes_json, created_at,
        backtest_return, backtest_sharpe, backtest_win_rate
      FROM generated_strategies
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

    interface StrategyRow {
      id: string;
      name: string;
      description: string;
      risk_level: string;
      timeframes_json: string;
      created_at: string;
      backtest_return: number | null;
      backtest_sharpe: number | null;
      backtest_win_rate: number | null;
    }

    const query = db.prepare<StrategyRow, (string | number)[]>(sql);
    const rows = query.all(...params);

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      riskLevel: row.risk_level,
      timeframes: JSON.parse(row.timeframes_json),
      createdAt: row.created_at,
      backtestReturn: row.backtest_return ?? undefined,
      backtestSharpe: row.backtest_sharpe ?? undefined,
      backtestWinRate: row.backtest_win_rate ?? undefined,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Failed to list generated strategies", { error: message });
    return [];
  }
}

/**
 * Count generated strategies
 */
export function countGeneratedStrategies(
  options: Omit<GeneratedStrategyQueryOptions, "orderBy" | "orderDirection" | "limit" | "offset"> = {}
): number {
  try {
    const db = getDatabase();

    // Ensure tables exist
    initGeneratedStrategiesTable();

    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (options.riskLevel) {
      conditions.push("risk_level = ?");
      params.push(options.riskLevel);
    }

    if (options.minReturn !== undefined) {
      conditions.push("backtest_return >= ?");
      params.push(options.minReturn);
    }

    if (options.minSharpe !== undefined) {
      conditions.push("backtest_sharpe >= ?");
      params.push(options.minSharpe);
    }

    let sql = "SELECT COUNT(*) as count FROM generated_strategies";

    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(" AND ")}`;
    }

    const query = db.prepare<{ count: number }, (string | number)[]>(sql);
    const result = query.get(...params);

    return result?.count ?? 0;
  } catch (error) {
    logger.error("Failed to count generated strategies", {
      error: error instanceof Error ? error.message : "Unknown",
    });
    return 0;
  }
}

// ============================================================================
// Delete Operations
// ============================================================================

/**
 * Delete a generated strategy by ID
 */
export function deleteGeneratedStrategy(id: string): boolean {
  try {
    const db = getDatabase();

    // Delete backtest results first (foreign key)
    db.run("DELETE FROM generated_strategy_backtests WHERE strategy_id = ?", [id]);

    // Delete strategy
    const result = db.run("DELETE FROM generated_strategies WHERE id = ?", [id]);

    logger.info("Deleted generated strategy", { id });

    return result.changes > 0;
  } catch (error) {
    logger.error("Failed to delete generated strategy", {
      id,
      error: error instanceof Error ? error.message : "Unknown",
    });
    return false;
  }
}

/**
 * Clean up old generated strategies
 */
export function cleanupOldGeneratedStrategies(olderThanDays: number): number {
  try {
    const db = getDatabase();
    const cutoff = new Date(
      Date.now() - olderThanDays * 24 * 60 * 60 * 1000
    ).toISOString();

    // Get IDs to delete
    const query = db.prepare<{ id: string }, [string]>(`
      SELECT id FROM generated_strategies WHERE created_at < ?
    `);
    const rows = query.all(cutoff);
    const ids = rows.map((r) => r.id);

    if (ids.length === 0) {
      return 0;
    }

    // Delete backtests first
    const placeholders = ids.map(() => "?").join(",");
    db.run(
      `DELETE FROM generated_strategy_backtests WHERE strategy_id IN (${placeholders})`,
      ids
    );

    // Delete strategies
    const result = db.run(
      `DELETE FROM generated_strategies WHERE id IN (${placeholders})`,
      ids
    );

    logger.info("Cleaned up old generated strategies", {
      deleted: result.changes,
      olderThan: cutoff,
    });

    return result.changes;
  } catch (error) {
    logger.error("Failed to cleanup old generated strategies", {
      error: error instanceof Error ? error.message : "Unknown",
    });
    return 0;
  }
}
