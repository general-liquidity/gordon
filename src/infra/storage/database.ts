import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const GORDON_DIR = join(homedir(), ".gordon");
export const DB_PATH = join(GORDON_DIR, "gordon.db");

let dbInstance: Database | null = null;

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
      stopLoss TEXT NOT NULL,
      takeProfit TEXT NOT NULL,
      reasoning TEXT NOT NULL,
      status TEXT NOT NULL
    )
  `);

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
