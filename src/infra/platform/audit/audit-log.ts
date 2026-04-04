/**
 * Audit Logging Module
 *
 * Provides comprehensive audit logging for sensitive operations in Gordon.
 * All sensitive operations (execute, close, arm/disarm, mode change) are logged
 * with user, action, timestamp, parameters, and result.
 *
 * Audit logs are stored in SQLite for persistence and queryability.
 */

import { getDatabase, getDatabasePath } from "../storage/database.ts";
import { createModuleLogger } from "../logger/index.ts";
import { recordStructuredAuditEvent } from "../observability/index.ts";
import { v4 as uuidv4 } from "uuid";

const logger = createModuleLogger("audit");

// ============================================================================
// Types
// ============================================================================

/**
 * Types of actions that are audited
 */
export type AuditAction =
  | "EXECUTE_PLAN"
  | "CLOSE_TRADE"
  | "CANCEL_TRADE"
  | "PLACE_OCO_ORDER"
  | "ARM_SYSTEM"
  | "DISARM_SYSTEM"
  | "MODE_CHANGE"
  | "APPROVE_PLAN"
  | "CREATE_PLAN"
  | "API_KEY_USED"
  | "PERMISSION_CHECK"
  | "RATE_LIMIT_EXCEEDED"
  | "GUARDRAIL_TRIGGERED"
  | "ACCESS_DENIED"
  | "WEB_RESEARCH_RUN"
  | "WEB_AUTOMATION_RUN"
  | "WEB_MONITOR_SCHEDULE"
  | "WEB_MONITOR_REMOVE"
  | "WEB_MONITOR_RUN"
  | "AGENT_RAIL_STATUS_READ"
  | "AGENT_RAIL_MCP_SYNC"
  | "HELIUS_QUERY"
  | "MOONPAY_LINK_CREATED"
  | "MOONPAY_QUOTE_READ"
  | "MOONPAY_TRANSACTION_READ"
  | "MOONPAY_CUSTOMER_LIMITS_READ"
  | "MOONPAY_VIRTUAL_ACCOUNT_READ"
  | "MOONPAY_WEBHOOK_VERIFIED"
  | "POLYGON_PAYMENT_INTENT_CREATED"
  | "POLYGON_PAYMENT_INTENT_SIGNED"
  | "SYSTEMATIC_VALIDATION"
  | "SYSTEMATIC_OVERRIDE"
  | "SYSTEMATIC_PROMOTION";

/**
 * Result status of an audited action
 */
export type AuditResult = "SUCCESS" | "FAILURE" | "BLOCKED" | "PENDING";

/**
 * Audit log entry
 */
export interface AuditEntry {
  id: string;
  timestamp: string;
  userId: string;
  action: AuditAction;
  parameters: Record<string, unknown>;
  result: AuditResult;
  resultDetails?: string;
  ipAddress?: string;
  userAgent?: string;
  sessionId?: string;
  tradeId?: string;
  planId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Options for querying audit history
 */
export interface AuditQueryOptions {
  userId?: string;
  action?: AuditAction;
  result?: AuditResult;
  startTime?: string;
  endTime?: string;
  planId?: string;
  tradeId?: string;
  limit?: number;
  offset?: number;
}

// ============================================================================
// Database Initialization
// ============================================================================

let initializedDatabasePath: string | null = null;

/**
 * Initialize the audit_log table if it doesn't exist
 */
function initAuditTable(): void {
  const currentDatabasePath = getDatabasePath();
  if (initializedDatabasePath === currentDatabasePath) return;

  const db = getDatabase();

  db.run(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      userId TEXT NOT NULL,
      action TEXT NOT NULL,
      parameters TEXT NOT NULL,
      result TEXT NOT NULL,
      resultDetails TEXT,
      ipAddress TEXT,
      userAgent TEXT,
      sessionId TEXT,
      tradeId TEXT,
      planId TEXT,
      metadata TEXT
    )
  `);

  // Create indexes for common queries
  db.run("CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp)");
  db.run("CREATE INDEX IF NOT EXISTS idx_audit_userId ON audit_log(userId)");
  db.run("CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action)");
  db.run("CREATE INDEX IF NOT EXISTS idx_audit_result ON audit_log(result)");
  db.run("CREATE INDEX IF NOT EXISTS idx_audit_planId ON audit_log(planId)");
  db.run("CREATE INDEX IF NOT EXISTS idx_audit_tradeId ON audit_log(tradeId)");

  initializedDatabasePath = currentDatabasePath;
  logger.debug("Audit table initialized");
}

// ============================================================================
// AuditLogger Class
// ============================================================================

/**
 * AuditLogger provides methods for recording and querying audit logs
 */
export class AuditLogger {
  private userId: string;
  private sessionId?: string;
  private ipAddress?: string;
  private userAgent?: string;

  constructor(options: {
    userId: string;
    sessionId?: string;
    ipAddress?: string;
    userAgent?: string;
  }) {
    this.userId = options.userId;
    this.sessionId = options.sessionId;
    this.ipAddress = options.ipAddress;
    this.userAgent = options.userAgent;

    // Ensure table exists
    initAuditTable();
  }

  /**
   * Record an audit entry
   */
  record(
    action: AuditAction,
    parameters: Record<string, unknown>,
    result: AuditResult,
    options?: {
      resultDetails?: string;
      tradeId?: string;
      planId?: string;
      metadata?: Record<string, unknown>;
    }
  ): AuditEntry {
    const entry: AuditEntry = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      userId: this.userId,
      action,
      parameters,
      result,
      resultDetails: options?.resultDetails,
      ipAddress: this.ipAddress,
      userAgent: this.userAgent,
      sessionId: this.sessionId,
      tradeId: options?.tradeId,
      planId: options?.planId,
      metadata: options?.metadata,
    };

    const db = getDatabase();
    const stmt = db.prepare(`
      INSERT INTO audit_log (
        id, timestamp, userId, action, parameters, result,
        resultDetails, ipAddress, userAgent, sessionId, tradeId, planId, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      entry.id,
      entry.timestamp,
      entry.userId,
      entry.action,
      JSON.stringify(entry.parameters),
      entry.result,
      entry.resultDetails || null,
      entry.ipAddress || null,
      entry.userAgent || null,
      entry.sessionId || null,
      entry.tradeId || null,
      entry.planId || null,
      entry.metadata ? JSON.stringify(entry.metadata) : null
    );

    logger.info("Audit entry recorded", {
      id: entry.id,
      action: entry.action,
      result: entry.result,
      userId: entry.userId,
    });

    try {
      recordStructuredAuditEvent({
        timestamp: entry.timestamp,
        userId: entry.userId,
        action: entry.action,
        parameters: entry.parameters,
        result: entry.result,
        resultDetails: entry.resultDetails,
        sessionId: entry.sessionId,
        tradeId: entry.tradeId,
        planId: entry.planId,
        metadata: entry.metadata,
      });
    } catch (error) {
      logger.debug("Structured audit export failed (non-fatal)", {
        action: entry.action,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return entry;
  }

  /**
   * Record a successful action
   */
  success(
    action: AuditAction,
    parameters: Record<string, unknown>,
    options?: {
      resultDetails?: string;
      tradeId?: string;
      planId?: string;
      metadata?: Record<string, unknown>;
    }
  ): AuditEntry {
    return this.record(action, parameters, "SUCCESS", options);
  }

  /**
   * Record a failed action
   */
  failure(
    action: AuditAction,
    parameters: Record<string, unknown>,
    error: string,
    options?: {
      tradeId?: string;
      planId?: string;
      metadata?: Record<string, unknown>;
    }
  ): AuditEntry {
    return this.record(action, parameters, "FAILURE", {
      ...options,
      resultDetails: error,
    });
  }

  /**
   * Record a blocked action
   */
  blocked(
    action: AuditAction,
    parameters: Record<string, unknown>,
    reason: string,
    options?: {
      tradeId?: string;
      planId?: string;
      metadata?: Record<string, unknown>;
    }
  ): AuditEntry {
    return this.record(action, parameters, "BLOCKED", {
      ...options,
      resultDetails: reason,
    });
  }
}

// ============================================================================
// Query Functions
// ============================================================================

/**
 * Get audit history with optional filtering
 */
export function getAuditHistory(options: AuditQueryOptions = {}): AuditEntry[] {
  initAuditTable();

  const db = getDatabase();
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (options.userId) {
    conditions.push("userId = ?");
    params.push(options.userId);
  }

  if (options.action) {
    conditions.push("action = ?");
    params.push(options.action);
  }

  if (options.result) {
    conditions.push("result = ?");
    params.push(options.result);
  }

  if (options.startTime) {
    conditions.push("timestamp >= ?");
    params.push(options.startTime);
  }

  if (options.endTime) {
    conditions.push("timestamp <= ?");
    params.push(options.endTime);
  }

  if (options.planId) {
    conditions.push("planId = ?");
    params.push(options.planId);
  }

  if (options.tradeId) {
    conditions.push("tradeId = ?");
    params.push(options.tradeId);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(options.limit ?? 100, 500);
  const offset = options.offset ?? 0;

  const query = `
    SELECT * FROM audit_log
    ${whereClause}
    ORDER BY timestamp DESC
    LIMIT ? OFFSET ?
  `;

  params.push(limit, offset);

  const rows = db.prepare(query).all(...params) as Array<{
    id: string;
    timestamp: string;
    userId: string;
    action: string;
    parameters: string;
    result: string;
    resultDetails: string | null;
    ipAddress: string | null;
    userAgent: string | null;
    sessionId: string | null;
    tradeId: string | null;
    planId: string | null;
    metadata: string | null;
  }>;

  return rows.map((row) => ({
    id: row.id,
    timestamp: row.timestamp,
    userId: row.userId,
    action: row.action as AuditAction,
    parameters: JSON.parse(row.parameters),
    result: row.result as AuditResult,
    resultDetails: row.resultDetails ?? undefined,
    ipAddress: row.ipAddress ?? undefined,
    userAgent: row.userAgent ?? undefined,
    sessionId: row.sessionId ?? undefined,
    tradeId: row.tradeId ?? undefined,
    planId: row.planId ?? undefined,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
  }));
}

/**
 * Get audit entry by ID
 */
export function getAuditEntry(id: string): AuditEntry | null {
  initAuditTable();

  const db = getDatabase();
  const row = db.prepare("SELECT * FROM audit_log WHERE id = ?").get(id) as {
    id: string;
    timestamp: string;
    userId: string;
    action: string;
    parameters: string;
    result: string;
    resultDetails: string | null;
    ipAddress: string | null;
    userAgent: string | null;
    sessionId: string | null;
    tradeId: string | null;
    planId: string | null;
    metadata: string | null;
  } | undefined;

  if (!row) return null;

  return {
    id: row.id,
    timestamp: row.timestamp,
    userId: row.userId,
    action: row.action as AuditAction,
    parameters: JSON.parse(row.parameters),
    result: row.result as AuditResult,
    resultDetails: row.resultDetails ?? undefined,
    ipAddress: row.ipAddress ?? undefined,
    userAgent: row.userAgent ?? undefined,
    sessionId: row.sessionId ?? undefined,
    tradeId: row.tradeId ?? undefined,
    planId: row.planId ?? undefined,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
  };
}

/**
 * Get recent audit entries for a specific user
 */
export function getRecentUserActivity(userId: string, limit: number = 20): AuditEntry[] {
  return getAuditHistory({ userId, limit });
}

/**
 * Get audit entries for a specific trade
 */
export function getTradeAuditHistory(tradeId: string): AuditEntry[] {
  return getAuditHistory({ tradeId, limit: 100 });
}

/**
 * Get audit entries for a specific plan
 */
export function getPlanAuditHistory(planId: string): AuditEntry[] {
  return getAuditHistory({ planId, limit: 100 });
}

/**
 * Count audit entries matching criteria
 */
export function countAuditEntries(options: Omit<AuditQueryOptions, "limit" | "offset"> = {}): number {
  initAuditTable();

  const db = getDatabase();
  const conditions: string[] = [];
  const params: string[] = [];

  if (options.userId) {
    conditions.push("userId = ?");
    params.push(options.userId);
  }

  if (options.action) {
    conditions.push("action = ?");
    params.push(options.action);
  }

  if (options.result) {
    conditions.push("result = ?");
    params.push(options.result);
  }

  if (options.startTime) {
    conditions.push("timestamp >= ?");
    params.push(options.startTime);
  }

  if (options.endTime) {
    conditions.push("timestamp <= ?");
    params.push(options.endTime);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const query = `SELECT COUNT(*) as count FROM audit_log ${whereClause}`;
  const row = db.prepare(query).get(...params) as { count: number };

  return row.count;
}

// ============================================================================
// Singleton Instance for Global Access
// ============================================================================

let globalAuditLogger: AuditLogger | null = null;

/**
 * Get or create a global audit logger instance
 */
export function getAuditLogger(userId: string = "system"): AuditLogger {
  if (!globalAuditLogger || globalAuditLogger["userId"] !== userId) {
    globalAuditLogger = new AuditLogger({ userId });
  }
  return globalAuditLogger;
}

/**
 * Convenience function to record an audit entry using the global logger
 */
export const auditLog = {
  record: (
    userId: string,
    action: AuditAction,
    parameters: Record<string, unknown>,
    result: AuditResult,
    options?: {
      resultDetails?: string;
      tradeId?: string;
      planId?: string;
      metadata?: Record<string, unknown>;
    }
  ): AuditEntry => {
    const auditLogger = new AuditLogger({ userId });
    return auditLogger.record(action, parameters, result, options);
  },

  success: (
    userId: string,
    action: AuditAction,
    parameters: Record<string, unknown>,
    options?: {
      resultDetails?: string;
      tradeId?: string;
      planId?: string;
      metadata?: Record<string, unknown>;
    }
  ): AuditEntry => {
    const auditLogger = new AuditLogger({ userId });
    return auditLogger.success(action, parameters, options);
  },

  failure: (
    userId: string,
    action: AuditAction,
    parameters: Record<string, unknown>,
    error: string,
    options?: {
      tradeId?: string;
      planId?: string;
      metadata?: Record<string, unknown>;
    }
  ): AuditEntry => {
    const auditLogger = new AuditLogger({ userId });
    return auditLogger.failure(action, parameters, error, options);
  },

  blocked: (
    userId: string,
    action: AuditAction,
    parameters: Record<string, unknown>,
    reason: string,
    options?: {
      tradeId?: string;
      planId?: string;
      metadata?: Record<string, unknown>;
    }
  ): AuditEntry => {
    const auditLogger = new AuditLogger({ userId });
    return auditLogger.blocked(action, parameters, reason, options);
  },
};

// ============================================================================
// Export Summary Report Functions
// ============================================================================

/**
 * Generate a summary of audit activity
 */
export function getAuditSummary(options: { startTime?: string; endTime?: string } = {}): {
  totalEntries: number;
  byAction: Record<string, number>;
  byResult: Record<string, number>;
  byUser: Record<string, number>;
  recentBlocked: AuditEntry[];
  recentFailures: AuditEntry[];
} {
  initAuditTable();

  const db = getDatabase();
  const conditions: string[] = [];
  const params: string[] = [];

  if (options.startTime) {
    conditions.push("timestamp >= ?");
    params.push(options.startTime);
  }

  if (options.endTime) {
    conditions.push("timestamp <= ?");
    params.push(options.endTime);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Total count
  const totalRow = db.prepare(`SELECT COUNT(*) as count FROM audit_log ${whereClause}`).get(...params) as { count: number };

  // By action
  const actionRows = db.prepare(`
    SELECT action, COUNT(*) as count FROM audit_log ${whereClause} GROUP BY action
  `).all(...params) as Array<{ action: string; count: number }>;
  const byAction: Record<string, number> = {};
  for (const row of actionRows) {
    byAction[row.action] = row.count;
  }

  // By result
  const resultRows = db.prepare(`
    SELECT result, COUNT(*) as count FROM audit_log ${whereClause} GROUP BY result
  `).all(...params) as Array<{ result: string; count: number }>;
  const byResult: Record<string, number> = {};
  for (const row of resultRows) {
    byResult[row.result] = row.count;
  }

  // By user
  const userRows = db.prepare(`
    SELECT userId, COUNT(*) as count FROM audit_log ${whereClause} GROUP BY userId
  `).all(...params) as Array<{ userId: string; count: number }>;
  const byUser: Record<string, number> = {};
  for (const row of userRows) {
    byUser[row.userId] = row.count;
  }

  // Recent blocked
  const recentBlocked = getAuditHistory({ result: "BLOCKED", limit: 10 });

  // Recent failures
  const recentFailures = getAuditHistory({ result: "FAILURE", limit: 10 });

  return {
    totalEntries: totalRow.count,
    byAction,
    byResult,
    byUser,
    recentBlocked,
    recentFailures,
  };
}
