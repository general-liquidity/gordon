import { Database, type Statement } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createModuleLogger } from "../logger/index.ts";
import { GORDON_DIR } from "./paths.ts";

const logger = createModuleLogger("database");
export const DB_PATH = join(GORDON_DIR, "gordon.db");

let dbInstance: Database | null = null;

// Query logging configuration
const SLOW_QUERY_THRESHOLD_MS = 100;

// Query statistics tracking
interface QueryStats {
  totalQueries: number;
  totalTimeMs: number;
  slowQueries: number;
  queryCounts: Record<string, number>;
  queryTimes: Record<string, number>;
}

const queryStats: QueryStats = {
  totalQueries: 0,
  totalTimeMs: 0,
  slowQueries: 0,
  queryCounts: {},
  queryTimes: {},
};

// Transaction state tracking
let transactionDepth = 0;
let savepointCounter = 0;

/**
 * Ensures the ~/.gordon directory exists (sync version)
 */
function ensureGordonDirSync(): void {
  mkdirSync(GORDON_DIR, { recursive: true });
}

/**
 * Creates and initializes the SQLite database with all required tables
 */
export function initDatabase(): Database {
  if (dbInstance) {
    return dbInstance;
  }

  ensureGordonDirSync();

  const db = new Database(DB_PATH);

  // Enable WAL mode for better concurrent access
  db.run("PRAGMA journal_mode = WAL");

  // Create plans table
  db.run(`
    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      createdAt TEXT NOT NULL,
      symbol TEXT NOT NULL,
      direction TEXT NOT NULL,
      strategy TEXT NOT NULL,
      allocation TEXT NOT NULL,
      entry TEXT NOT NULL,
      dca TEXT,
      grid TEXT,
      stopLoss TEXT NOT NULL,
      takeProfit TEXT NOT NULL,
      reasoning TEXT NOT NULL,
      status TEXT NOT NULL
    )
  `);

  // Migration: Add grid column if it doesn't exist (for existing databases)
  try {
    db.run(`ALTER TABLE plans ADD COLUMN grid TEXT`);
  } catch {
    // Column already exists, ignore error
  }

  // Migration: Add expiresAt column if it doesn't exist (for plan expiration)
  try {
    db.run(`ALTER TABLE plans ADD COLUMN expiresAt TEXT`);
  } catch {
    // Column already exists, ignore error
  }

  // Create trades table
  db.run(`
    CREATE TABLE IF NOT EXISTS trades (
      id TEXT PRIMARY KEY,
      planId TEXT NOT NULL,
      openedAt TEXT NOT NULL,
      closedAt TEXT,
      symbol TEXT NOT NULL,
      entries TEXT NOT NULL,
      exits TEXT NOT NULL,
      averageEntry REAL NOT NULL,
      realizedPnl REAL NOT NULL,
      realizedPnlPercent REAL NOT NULL,
      status TEXT NOT NULL,
      FOREIGN KEY (planId) REFERENCES plans(id)
    )
  `);

  // Create events table
  db.run(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      type TEXT NOT NULL,
      data TEXT NOT NULL,
      planId TEXT,
      tradeId TEXT,
      FOREIGN KEY (planId) REFERENCES plans(id),
      FOREIGN KEY (tradeId) REFERENCES trades(id)
    )
  `);

  // Create indexes for common queries
  db.run("CREATE INDEX IF NOT EXISTS idx_plans_status ON plans(status)");
  db.run("CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status)");
  db.run("CREATE INDEX IF NOT EXISTS idx_trades_planId ON trades(planId)");
  db.run("CREATE INDEX IF NOT EXISTS idx_events_type ON events(type)");
  db.run("CREATE INDEX IF NOT EXISTS idx_events_planId ON events(planId)");
  db.run("CREATE INDEX IF NOT EXISTS idx_events_tradeId ON events(tradeId)");
  db.run("CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp)");

  // Create positions table (position state machine lifecycle)
  db.run(`
    CREATE TABLE IF NOT EXISTS positions (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      exchangeId TEXT NOT NULL,
      side TEXT NOT NULL CHECK(side IN ('long', 'short')),
      state TEXT NOT NULL,
      stateHistory TEXT NOT NULL DEFAULT '[]',
      setupSignal TEXT,
      analysis TEXT,
      plan TEXT,
      riskDecision TEXT,
      entryOrder TEXT,
      entryPrice REAL,
      quantity REAL,
      stopLoss REAL,
      takeProfit REAL,
      trailingStop TEXT,
      currentPrice REAL,
      unrealizedPnL REAL,
      highWaterMark REAL,
      exitOrder TEXT,
      exitPrice REAL,
      realizedPnL REAL,
      review TEXT,
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
  `);

  db.run("CREATE INDEX IF NOT EXISTS idx_positions_state ON positions(state)");
  db.run("CREATE INDEX IF NOT EXISTS idx_positions_symbol ON positions(symbol)");
  db.run("CREATE INDEX IF NOT EXISTS idx_positions_exchangeId ON positions(exchangeId)");
  db.run("CREATE INDEX IF NOT EXISTS idx_positions_createdAt ON positions(createdAt)");
  db.run("CREATE INDEX IF NOT EXISTS idx_positions_closedAt ON positions(closedAt)");
  db.run("CREATE INDEX IF NOT EXISTS idx_positions_strategyId ON positions(strategyId)");

  // Create data source cache table for historical OHLC data
  db.run(`
    CREATE TABLE IF NOT EXISTS data_source_cache (
      symbol TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      open REAL NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      close REAL NOT NULL,
      volume REAL NOT NULL,
      source_id TEXT NOT NULL,
      fetched_at INTEGER NOT NULL,
      PRIMARY KEY (symbol, timeframe, timestamp)
    )
  `);

  // Create index for efficient coverage queries on data source cache
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_data_cache_coverage
    ON data_source_cache(symbol, timeframe, timestamp)
  `);

  dbInstance = db;
  return db;
}

/**
 * Gets the database instance, initializing if necessary
 */
export function getDatabase(): Database {
  return initDatabase();
}

/**
 * Closes the database connection
 */
export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

// ============================================================================
// Query Logging and Statistics
// ============================================================================

/**
 * Extract query type from SQL for categorization
 */
function extractQueryType(sql: string): string {
  const trimmed = sql.trim().toUpperCase();
  const firstWord = trimmed.split(/\s+/)[0];
  return firstWord || "UNKNOWN";
}

/**
 * Log a query with execution time
 */
function logQuery(sql: string, durationMs: number): void {
  const queryType = extractQueryType(sql);

  // Update statistics
  queryStats.totalQueries++;
  queryStats.totalTimeMs += durationMs;
  queryStats.queryCounts[queryType] = (queryStats.queryCounts[queryType] || 0) + 1;
  queryStats.queryTimes[queryType] = (queryStats.queryTimes[queryType] || 0) + durationMs;

  // Check for slow query
  if (durationMs > SLOW_QUERY_THRESHOLD_MS) {
    queryStats.slowQueries++;
    logger.warn("Slow query detected", {
      durationMs: durationMs.toFixed(2),
      queryType,
      sql: sql.substring(0, 200), // Truncate long queries
    });
  } else {
    logger.debug("Query executed", {
      durationMs: durationMs.toFixed(2),
      queryType,
    });
  }
}

/**
 * Get current query statistics
 */
export function getQueryStats(): Readonly<QueryStats> {
  return { ...queryStats };
}

/**
 * Reset query statistics
 */
export function resetQueryStats(): void {
  queryStats.totalQueries = 0;
  queryStats.totalTimeMs = 0;
  queryStats.slowQueries = 0;
  queryStats.queryCounts = {};
  queryStats.queryTimes = {};
}

/**
 * Get average query time in milliseconds
 */
export function getAverageQueryTime(): number {
  if (queryStats.totalQueries === 0) return 0;
  return queryStats.totalTimeMs / queryStats.totalQueries;
}

/**
 * Execute a query with timing and logging
 */
export function executeWithLogging<T>(
  fn: () => T,
  sql: string
): T {
  const startTime = performance.now();
  try {
    return fn();
  } finally {
    const endTime = performance.now();
    logQuery(sql, endTime - startTime);
  }
}

// ============================================================================
// Transaction Support
// ============================================================================

/**
 * Transaction options
 */
export interface TransactionOptions {
  /** Transaction mode: DEFERRED (default), IMMEDIATE, or EXCLUSIVE */
  mode?: "DEFERRED" | "IMMEDIATE" | "EXCLUSIVE";
}

/**
 * Execute a function within a database transaction.
 * Supports nested transactions via savepoints.
 * Automatically rolls back on error and commits on success.
 *
 * @param fn - Function to execute within the transaction
 * @param options - Transaction options
 * @returns The result of the function
 *
 * @example
 * ```ts
 * const result = await withTransaction(async () => {
 *   const plan = createPlan({ ... });
 *   const trade = createTrade({ planId: plan.id, ... });
 *   return { plan, trade };
 * });
 * ```
 */
export function withTransaction<T>(
  fn: () => T,
  options: TransactionOptions = {}
): T {
  const db = getDatabase();
  const { mode = "DEFERRED" } = options;
  const isNested = transactionDepth > 0;

  let savepointName: string | null = null;

  try {
    if (isNested) {
      // Nested transaction: use savepoint
      savepointName = `sp_${++savepointCounter}`;
      executeWithLogging(
        () => db.run(`SAVEPOINT ${savepointName}`),
        `SAVEPOINT ${savepointName}`
      );
      logger.debug("Savepoint created", { name: savepointName, depth: transactionDepth + 1 });
    } else {
      // Top-level transaction: BEGIN
      executeWithLogging(
        () => db.run(`BEGIN ${mode} TRANSACTION`),
        `BEGIN ${mode} TRANSACTION`
      );
      logger.debug("Transaction started", { mode });
    }

    transactionDepth++;

    // Execute the function
    const result = fn();

    // Handle async functions (Promise)
    if (result instanceof Promise) {
      return result
        .then((value) => {
          commitOrRelease(db, savepointName);
          return value;
        })
        .catch((error) => {
          rollbackOrRevert(db, savepointName);
          throw error;
        }) as T;
    }

    // Synchronous: commit/release
    commitOrRelease(db, savepointName);
    return result;
  } catch (error) {
    rollbackOrRevert(db, savepointName);
    throw error;
  }
}

/**
 * Commit transaction or release savepoint
 */
function commitOrRelease(db: Database, savepointName: string | null): void {
  transactionDepth--;

  if (savepointName) {
    executeWithLogging(
      () => db.run(`RELEASE SAVEPOINT ${savepointName}`),
      `RELEASE SAVEPOINT ${savepointName}`
    );
    logger.debug("Savepoint released", { name: savepointName });
  } else {
    executeWithLogging(
      () => db.run("COMMIT"),
      "COMMIT"
    );
    logger.debug("Transaction committed");
  }
}

/**
 * Rollback transaction or revert to savepoint
 */
function rollbackOrRevert(db: Database, savepointName: string | null): void {
  transactionDepth--;

  if (savepointName) {
    try {
      executeWithLogging(
        () => db.run(`ROLLBACK TO SAVEPOINT ${savepointName}`),
        `ROLLBACK TO SAVEPOINT ${savepointName}`
      );
      // Release the savepoint after rollback
      executeWithLogging(
        () => db.run(`RELEASE SAVEPOINT ${savepointName}`),
        `RELEASE SAVEPOINT ${savepointName}`
      );
      logger.debug("Savepoint rolled back", { name: savepointName });
    } catch (e) {
      logger.error("Failed to rollback savepoint", e instanceof Error ? e : undefined);
    }
  } else {
    try {
      executeWithLogging(
        () => db.run("ROLLBACK"),
        "ROLLBACK"
      );
      logger.debug("Transaction rolled back");
    } catch (e) {
      logger.error("Failed to rollback transaction", e instanceof Error ? e : undefined);
    }
  }
}

/**
 * Check if currently in a transaction
 */
export function isInTransaction(): boolean {
  return transactionDepth > 0;
}

/**
 * Get current transaction depth (0 = no transaction)
 */
export function getTransactionDepth(): number {
  return transactionDepth;
}

/**
 * Create a plan and trade atomically within a transaction
 * This is a convenience function that wraps plan+trade creation in a transaction
 */
export function createPlanAndTradeInTransaction<P, T>(
  createPlanFn: () => P,
  createTradeFn: (plan: P) => T
): { plan: P; trade: T } {
  return withTransaction(() => {
    const plan = createPlanFn();
    const trade = createTradeFn(plan);
    return { plan, trade };
  });
}
