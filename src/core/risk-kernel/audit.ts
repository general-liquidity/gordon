/**
 * Risk Audit Log
 *
 * Persistent audit trail for every risk decision made by the Risk Kernel.
 * Stores decisions in the SQLite database alongside the existing plans,
 * trades, and events tables. Supports querying by symbol, decision type,
 * and time range.
 */

import { z } from "zod";
import { createModuleLogger } from "../../infra/logger/index.ts";
import { getDatabase, executeWithLogging } from "../../infra/storage/database.ts";
import type { PortfolioContext } from "./portfolio-context.ts";

const logger = createModuleLogger("risk-audit");

// ============================================================================
// Types
// ============================================================================

export const RiskCheckSchema = z.object({
  name: z.string(),
  passed: z.boolean(),
  details: z.string(),
  severity: z.enum(["info", "warning", "critical"]),
});

export type RiskCheck = z.infer<typeof RiskCheckSchema>;

export const OrderRequestSchema = z.object({
  symbol: z.string(),
  side: z.enum(["buy", "sell"]),
  type: z.enum(["market", "limit", "stop_limit"]),
  quantity: z.number(),
  price: z.number().optional(),
  stopPrice: z.number().optional(),
  exchangeId: z.string(),
  agentId: z.string(),
  strategyId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type OrderRequest = z.infer<typeof OrderRequestSchema>;

export const RiskDecisionSchema = z.object({
  approved: z.boolean(),
  action: z.enum(["approve", "modify", "reject"]),
  originalOrder: OrderRequestSchema,
  modifiedOrder: OrderRequestSchema.optional(),
  checks: z.array(RiskCheckSchema),
  reason: z.string().optional(),
  timestamp: z.string(),
});

export type RiskDecision = z.infer<typeof RiskDecisionSchema>;

export interface RiskAuditEntry {
  id: string;
  timestamp: string;
  order: OrderRequest;
  decision: RiskDecision;
  portfolioSnapshot: PortfolioContext;
}

// ============================================================================
// Database Setup
// ============================================================================

let tableInitialized = false;

/**
 * Ensure the risk_audit table exists.
 * Called lazily on first log/query operation.
 */
function ensureTable(): void {
  if (tableInitialized) return;

  const db = getDatabase();

  executeWithLogging(
    () =>
      db.run(`
        CREATE TABLE IF NOT EXISTS risk_audit (
          id TEXT PRIMARY KEY,
          timestamp TEXT NOT NULL,
          symbol TEXT NOT NULL,
          side TEXT NOT NULL,
          action TEXT NOT NULL,
          approved INTEGER NOT NULL,
          order_data TEXT NOT NULL,
          decision_data TEXT NOT NULL,
          portfolio_snapshot TEXT NOT NULL,
          agent_id TEXT NOT NULL,
          strategy_id TEXT
        )
      `),
    "CREATE TABLE risk_audit"
  );

  executeWithLogging(
    () => db.run("CREATE INDEX IF NOT EXISTS idx_risk_audit_timestamp ON risk_audit(timestamp)"),
    "CREATE INDEX idx_risk_audit_timestamp"
  );
  executeWithLogging(
    () => db.run("CREATE INDEX IF NOT EXISTS idx_risk_audit_symbol ON risk_audit(symbol)"),
    "CREATE INDEX idx_risk_audit_symbol"
  );
  executeWithLogging(
    () => db.run("CREATE INDEX IF NOT EXISTS idx_risk_audit_action ON risk_audit(action)"),
    "CREATE INDEX idx_risk_audit_action"
  );
  executeWithLogging(
    () => db.run("CREATE INDEX IF NOT EXISTS idx_risk_audit_approved ON risk_audit(approved)"),
    "CREATE INDEX idx_risk_audit_approved"
  );

  tableInitialized = true;
  logger.debug("Risk audit table initialized");
}

// ============================================================================
// Audit Log
// ============================================================================

export class RiskAuditLog {
  /**
   * Log a risk decision to the database.
   */
  async log(entry: RiskAuditEntry): Promise<void> {
    try {
      ensureTable();
      const db = getDatabase();

      const sql = `INSERT INTO risk_audit (id, timestamp, symbol, side, action, approved, order_data, decision_data, portfolio_snapshot, agent_id, strategy_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

      executeWithLogging(
        () => {
          const stmt = db.prepare(sql);
          stmt.run(
            entry.id,
            entry.timestamp,
            entry.order.symbol,
            entry.order.side,
            entry.decision.action,
            entry.decision.approved ? 1 : 0,
            JSON.stringify(entry.order),
            JSON.stringify(entry.decision),
            JSON.stringify(entry.portfolioSnapshot),
            entry.order.agentId,
            entry.order.strategyId ?? null,
          );
        },
        "INSERT INTO risk_audit"
      );

      logger.debug("Risk audit entry logged", {
        id: entry.id,
        symbol: entry.order.symbol,
        action: entry.decision.action,
        approved: entry.decision.approved,
      });
    } catch (error) {
      // Audit logging should never block order processing
      logger.error("Failed to log risk audit entry", error as Error);
    }
  }

  /**
   * Get audit history with optional filters.
   */
  async getHistory(options?: {
    limit?: number;
    since?: string;
  }): Promise<RiskAuditEntry[]> {
    try {
      ensureTable();
      const db = getDatabase();

      const limit = options?.limit ?? 100;
      const since = options?.since;

      let sql = "SELECT * FROM risk_audit";

      if (since) {
        sql += " WHERE timestamp >= ?";
      }

      sql += " ORDER BY timestamp DESC LIMIT ?";

      const rows = executeWithLogging(
        () => {
          const stmt = db.prepare(sql);
          if (since) {
            return stmt.all(since, limit) as RawAuditRow[];
          }
          return stmt.all(limit) as RawAuditRow[];
        },
        sql
      );

      return rows.map(deserializeRow);
    } catch (error) {
      logger.error("Failed to query risk audit history", error as Error);
      return [];
    }
  }

  /**
   * Get audit entries for a specific symbol.
   */
  async getBySymbol(symbol: string): Promise<RiskAuditEntry[]> {
    try {
      ensureTable();
      const db = getDatabase();

      const sql = "SELECT * FROM risk_audit WHERE symbol = ? ORDER BY timestamp DESC";
      const rows = executeWithLogging(
        () => db.prepare(sql).all(symbol) as RawAuditRow[],
        sql
      );

      return rows.map(deserializeRow);
    } catch (error) {
      logger.error("Failed to query risk audit by symbol", error as Error);
      return [];
    }
  }

  /**
   * Get all rejected orders.
   */
  async getRejections(): Promise<RiskAuditEntry[]> {
    try {
      ensureTable();
      const db = getDatabase();

      const sql = "SELECT * FROM risk_audit WHERE approved = 0 ORDER BY timestamp DESC";
      const rows = executeWithLogging(
        () => db.prepare(sql).all() as RawAuditRow[],
        sql
      );

      return rows.map(deserializeRow);
    } catch (error) {
      logger.error("Failed to query risk audit rejections", error as Error);
      return [];
    }
  }

  /**
   * Get audit entries for a specific agent.
   */
  async getByAgent(agentId: string): Promise<RiskAuditEntry[]> {
    try {
      ensureTable();
      const db = getDatabase();

      const sql = "SELECT * FROM risk_audit WHERE agent_id = ? ORDER BY timestamp DESC";
      const rows = executeWithLogging(
        () => db.prepare(sql).all(agentId) as RawAuditRow[],
        sql
      );

      return rows.map(deserializeRow);
    } catch (error) {
      logger.error("Failed to query risk audit by agent", error as Error);
      return [];
    }
  }

  /**
   * Get summary statistics for risk decisions.
   */
  async getStats(since?: string): Promise<{
    total: number;
    approved: number;
    modified: number;
    rejected: number;
    approvalRate: number;
  }> {
    try {
      ensureTable();
      const db = getDatabase();

      let sql = `
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN action = 'approve' THEN 1 ELSE 0 END) as approved,
          SUM(CASE WHEN action = 'modify' THEN 1 ELSE 0 END) as modified,
          SUM(CASE WHEN action = 'reject' THEN 1 ELSE 0 END) as rejected
        FROM risk_audit
      `;

      if (since) {
        sql += " WHERE timestamp >= ?";
      }

      type StatsRow = {
        total: number;
        approved: number;
        modified: number;
        rejected: number;
      };

      const row = executeWithLogging(
        () => {
          const stmt = db.prepare(sql);
          if (since) {
            return stmt.get(since) as StatsRow | null;
          }
          return stmt.get() as StatsRow | null;
        },
        sql
      );

      if (!row) {
        return { total: 0, approved: 0, modified: 0, rejected: 0, approvalRate: 0 };
      }

      return {
        total: row.total,
        approved: row.approved,
        modified: row.modified,
        rejected: row.rejected,
        approvalRate: row.total > 0 ? (row.approved + row.modified) / row.total : 0,
      };
    } catch (error) {
      logger.error("Failed to get risk audit stats", error as Error);
      return { total: 0, approved: 0, modified: 0, rejected: 0, approvalRate: 0 };
    }
  }
}

// ============================================================================
// Helpers
// ============================================================================

interface RawAuditRow {
  id: string;
  timestamp: string;
  symbol: string;
  side: string;
  action: string;
  approved: number;
  order_data: string;
  decision_data: string;
  portfolio_snapshot: string;
  agent_id: string;
  strategy_id: string | null;
}

function deserializeRow(row: RawAuditRow): RiskAuditEntry {
  return {
    id: row.id,
    timestamp: row.timestamp,
    order: JSON.parse(row.order_data) as OrderRequest,
    decision: JSON.parse(row.decision_data) as RiskDecision,
    portfolioSnapshot: JSON.parse(row.portfolio_snapshot) as PortfolioContext,
  };
}

/** Default singleton instance */
export const riskAuditLog = new RiskAuditLog();
