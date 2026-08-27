/**
 * Audit Chain Store
 *
 * SQLite-backed persistent storage for decision traces.
 * Follows the same patterns as risk-kernel/audit.ts and positions/store.ts:
 * lazy table initialization, getDatabase(), executeWithLogging().
 *
 * Tables:
 *   audit_traces      — top-level trace records
 *   audit_agent_steps — agent steps within a trace
 *   audit_tool_calls  — tool invocations within a step
 */

import { createModuleLogger } from "../../infra/logger/index.ts";
import { getDatabase, executeWithLogging, withTransaction } from "../../infra/storage/database.ts";
import {
  GENESIS_SIGNATURE,
  resolveAuditHmacKey,
  signTrace,
  verifyAuditChain,
  type AuditChainVerification,
} from "./signing.ts";
import { redactString } from "../../infra/platform/observability/valueRedaction.ts";
import type {
  AuditTrace,
  AuditAgentStep,
  AuditToolCall,
  AuditStats,
  DurabilityClass,
} from "./types.ts";

/** Coerce a stored durability_class column into the typed value or undefined. */
function toDurabilityClass(value: string | null): DurabilityClass | undefined {
  return value === "boundary" || value === "bestEffort" ? value : undefined;
}

const logger = createModuleLogger("audit-store");

// ============================================================================
// Database Setup
// ============================================================================

let tablesInitialized = false;

/**
 * Ensure audit tables and indexes exist.
 * Safe to call multiple times — uses CREATE TABLE IF NOT EXISTS.
 */
export function initAuditTables(): void {
  if (tablesInitialized) return;

  const db = getDatabase();

  // --- audit_traces ---
  executeWithLogging(
    () =>
      db.run(`
        CREATE TABLE IF NOT EXISTS audit_traces (
          trace_id TEXT PRIMARY KEY,
          parent_trace_id TEXT,
          trigger_type TEXT NOT NULL,
          trigger_event_type TEXT,
          trigger_source TEXT NOT NULL,
          trigger_payload_summary TEXT NOT NULL,
          outcome_type TEXT NOT NULL,
          outcome_position_id TEXT,
          outcome_details TEXT NOT NULL,
          started_at TEXT NOT NULL,
          ended_at TEXT,
          duration_ms REAL,
          risk_check_id TEXT,
          content_hash TEXT,
          prev_signature TEXT,
          signature TEXT
        )
      `),
    "CREATE TABLE audit_traces",
  );

  // Migration for databases created before signing shipped.
  addTraceColumnIfMissing(db, "content_hash", "content_hash TEXT");
  addTraceColumnIfMissing(db, "prev_signature", "prev_signature TEXT");
  addTraceColumnIfMissing(db, "signature", "signature TEXT");

  executeWithLogging(
    () =>
      db.run("CREATE INDEX IF NOT EXISTS idx_audit_traces_started_at ON audit_traces(started_at)"),
    "CREATE INDEX idx_audit_traces_started_at",
  );
  executeWithLogging(
    () =>
      db.run(
        "CREATE INDEX IF NOT EXISTS idx_audit_traces_outcome_type ON audit_traces(outcome_type)",
      ),
    "CREATE INDEX idx_audit_traces_outcome_type",
  );
  executeWithLogging(
    () =>
      db.run(
        "CREATE INDEX IF NOT EXISTS idx_audit_traces_outcome_position_id ON audit_traces(outcome_position_id)",
      ),
    "CREATE INDEX idx_audit_traces_outcome_position_id",
  );
  executeWithLogging(
    () =>
      db.run(
        "CREATE INDEX IF NOT EXISTS idx_audit_traces_trigger_type ON audit_traces(trigger_type)",
      ),
    "CREATE INDEX idx_audit_traces_trigger_type",
  );
  executeWithLogging(
    () =>
      db.run(
        "CREATE INDEX IF NOT EXISTS idx_audit_traces_parent_trace_id ON audit_traces(parent_trace_id)",
      ),
    "CREATE INDEX idx_audit_traces_parent_trace_id",
  );

  // --- audit_agent_steps ---
  executeWithLogging(
    () =>
      db.run(`
        CREATE TABLE IF NOT EXISTS audit_agent_steps (
          step_id TEXT PRIMARY KEY,
          trace_id TEXT NOT NULL,
          agent_id TEXT NOT NULL,
          started_at TEXT NOT NULL,
          ended_at TEXT,
          reasoning_summary TEXT NOT NULL DEFAULT '',
          handed_off_to TEXT,
          handoff_reason TEXT,
          durability_class TEXT,
          step_order INTEGER NOT NULL DEFAULT 0,
          FOREIGN KEY (trace_id) REFERENCES audit_traces(trace_id)
        )
      `),
    "CREATE TABLE audit_agent_steps",
  );

  executeWithLogging(
    () =>
      db.run("CREATE INDEX IF NOT EXISTS idx_audit_steps_trace_id ON audit_agent_steps(trace_id)"),
    "CREATE INDEX idx_audit_steps_trace_id",
  );
  executeWithLogging(
    () =>
      db.run("CREATE INDEX IF NOT EXISTS idx_audit_steps_agent_id ON audit_agent_steps(agent_id)"),
    "CREATE INDEX idx_audit_steps_agent_id",
  );

  // --- audit_tool_calls ---
  executeWithLogging(
    () =>
      db.run(`
        CREATE TABLE IF NOT EXISTS audit_tool_calls (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          step_id TEXT NOT NULL,
          tool_name TEXT NOT NULL,
          input_summary TEXT NOT NULL DEFAULT '',
          output_summary TEXT NOT NULL DEFAULT '',
          duration_ms REAL NOT NULL DEFAULT 0,
          success INTEGER NOT NULL DEFAULT 1,
          error TEXT,
          durability_class TEXT,
          call_order INTEGER NOT NULL DEFAULT 0,
          FOREIGN KEY (step_id) REFERENCES audit_agent_steps(step_id)
        )
      `),
    "CREATE TABLE audit_tool_calls",
  );

  executeWithLogging(
    () => db.run("CREATE INDEX IF NOT EXISTS idx_audit_tools_step_id ON audit_tool_calls(step_id)"),
    "CREATE INDEX idx_audit_tools_step_id",
  );
  executeWithLogging(
    () =>
      db.run("CREATE INDEX IF NOT EXISTS idx_audit_tools_tool_name ON audit_tool_calls(tool_name)"),
    "CREATE INDEX idx_audit_tools_tool_name",
  );

  // Migration for databases created before durability tiering shipped.
  addColumnIfMissing(db, "audit_agent_steps", "durability_class", "durability_class TEXT");
  addColumnIfMissing(db, "audit_tool_calls", "durability_class", "durability_class TEXT");

  tablesInitialized = true;
  logger.debug("Audit tables initialized");
}

function addTraceColumnIfMissing(
  db: ReturnType<typeof getDatabase>,
  column: string,
  columnDef: string,
): void {
  addColumnIfMissing(db, "audit_traces", column, columnDef);
}

function addColumnIfMissing(
  db: ReturnType<typeof getDatabase>,
  table: string,
  column: string,
  columnDef: string,
): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (cols.some((c) => c.name === column)) return;
  executeWithLogging(
    () => db.run(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`),
    `ALTER TABLE ${table} ADD ${column}`,
  );
}

// ============================================================================
// Raw Row Types
// ============================================================================

interface RawTraceRow {
  trace_id: string;
  parent_trace_id: string | null;
  trigger_type: string;
  trigger_event_type: string | null;
  trigger_source: string;
  trigger_payload_summary: string;
  outcome_type: string;
  outcome_position_id: string | null;
  outcome_details: string;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
  risk_check_id: string | null;
  content_hash: string | null;
  prev_signature: string | null;
  signature: string | null;
}

interface RawStepRow {
  step_id: string;
  trace_id: string;
  agent_id: string;
  started_at: string;
  ended_at: string | null;
  reasoning_summary: string;
  handed_off_to: string | null;
  handoff_reason: string | null;
  durability_class: string | null;
  step_order: number;
}

interface RawToolCallRow {
  id: number;
  step_id: string;
  tool_name: string;
  input_summary: string;
  output_summary: string;
  duration_ms: number;
  success: number;
  error: string | null;
  durability_class: string | null;
  call_order: number;
}

// ============================================================================
// Deserialization
// ============================================================================

function rowToToolCall(row: RawToolCallRow): AuditToolCall {
  return {
    tool_name: row.tool_name,
    input_summary: row.input_summary,
    output_summary: row.output_summary,
    duration_ms: row.duration_ms,
    success: row.success === 1,
    error: row.error ?? undefined,
    durability_class: toDurabilityClass(row.durability_class),
  };
}

function rowToStep(row: RawStepRow, toolCalls: AuditToolCall[]): AuditAgentStep {
  return {
    step_id: row.step_id,
    agent_id: row.agent_id,
    started_at: row.started_at,
    ended_at: row.ended_at ?? undefined,
    reasoning_summary: row.reasoning_summary,
    tool_calls: toolCalls,
    handed_off_to: row.handed_off_to ?? undefined,
    handoff_reason: row.handoff_reason ?? undefined,
    durability_class: toDurabilityClass(row.durability_class),
  };
}

function rowToTrace(row: RawTraceRow, steps: AuditAgentStep[]): AuditTrace {
  return {
    trace_id: row.trace_id,
    parent_trace_id: row.parent_trace_id ?? undefined,
    trigger: {
      type: row.trigger_type as AuditTrace["trigger"]["type"],
      event_type: row.trigger_event_type ?? undefined,
      source: row.trigger_source,
      payload_summary: row.trigger_payload_summary,
    },
    agent_steps: steps,
    outcome: {
      type: row.outcome_type as AuditTrace["outcome"]["type"],
      position_id: row.outcome_position_id ?? undefined,
      details: row.outcome_details,
    },
    started_at: row.started_at,
    ended_at: row.ended_at ?? undefined,
    duration_ms: row.duration_ms ?? undefined,
    risk_check_id: row.risk_check_id ?? undefined,
    content_hash: row.content_hash ?? undefined,
    prev_signature: row.prev_signature ?? undefined,
    signature: row.signature ?? undefined,
  };
}

// ============================================================================
// Audit Store
// ============================================================================

/**
 * Save a complete trace to the database (trace + steps + tool calls).
 * Uses a transaction for atomicity.
 *
 * Unsigned traces are signed here, chained onto the most recently stored
 * signature (see signing.ts). Returns the signed trace as persisted, or the
 * input trace unchanged if persistence failed (audit logging never throws).
 */
export function saveTrace(inputTrace: AuditTrace): AuditTrace {
  try {
    ensureTable();
    const db = getDatabase();

    // Redact credential/PII-shaped values out of free-text summary fields
    // BEFORE signing. Redacting after signing would break the tamper chain:
    // the content hash would be computed over unredacted text while the
    // stored (redacted) rows recompute to a different hash. Redacting the
    // content up-front keeps the hash consistent and guarantees no secret
    // ever reaches disk. Only an already-signed trace is left untouched.
    const trace0 = inputTrace.signature ? inputTrace : redactTraceContent(inputTrace);

    // Resolve key outside the transaction — it may touch the filesystem.
    const key = trace0.signature ? null : resolveAuditHmacKey();
    let trace = trace0;

    withTransaction(
      () => {
        if (!trace.signature) {
          trace = signTrace(trace, getLastChainSignature(db) ?? GENESIS_SIGNATURE, key!);
        }

        // Insert the trace row
        const traceStmt = db.prepare(`
        INSERT OR REPLACE INTO audit_traces
          (trace_id, parent_trace_id, trigger_type, trigger_event_type, trigger_source,
           trigger_payload_summary, outcome_type, outcome_position_id, outcome_details,
           started_at, ended_at, duration_ms, risk_check_id,
           content_hash, prev_signature, signature)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

        executeWithLogging(
          () =>
            traceStmt.run(
              trace.trace_id,
              trace.parent_trace_id ?? null,
              trace.trigger.type,
              trace.trigger.event_type ?? null,
              trace.trigger.source,
              trace.trigger.payload_summary,
              trace.outcome.type,
              trace.outcome.position_id ?? null,
              trace.outcome.details,
              trace.started_at,
              trace.ended_at ?? null,
              trace.duration_ms ?? null,
              trace.risk_check_id ?? null,
              trace.content_hash ?? null,
              trace.prev_signature ?? null,
              trace.signature ?? null,
            ),
          "INSERT audit_trace",
        );

        // Insert agent steps
        const stepStmt = db.prepare(`
        INSERT OR REPLACE INTO audit_agent_steps
          (step_id, trace_id, agent_id, started_at, ended_at,
           reasoning_summary, handed_off_to, handoff_reason, durability_class, step_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

        const toolStmt = db.prepare(`
        INSERT INTO audit_tool_calls
          (step_id, tool_name, input_summary, output_summary,
           duration_ms, success, error, durability_class, call_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

        for (let si = 0; si < trace.agent_steps.length; si++) {
          const step = trace.agent_steps[si]!;

          executeWithLogging(
            () =>
              stepStmt.run(
                step.step_id,
                trace.trace_id,
                step.agent_id,
                step.started_at,
                step.ended_at ?? null,
                step.reasoning_summary,
                step.handed_off_to ?? null,
                step.handoff_reason ?? null,
                step.durability_class ?? null,
                si,
              ),
            "INSERT audit_agent_step",
          );

          for (let ti = 0; ti < step.tool_calls.length; ti++) {
            const tc = step.tool_calls[ti]!;
            executeWithLogging(
              () =>
                toolStmt.run(
                  step.step_id,
                  tc.tool_name,
                  tc.input_summary,
                  tc.output_summary,
                  tc.duration_ms,
                  tc.success ? 1 : 0,
                  tc.error ?? null,
                  tc.durability_class ?? null,
                  ti,
                ),
              "INSERT audit_tool_call",
            );
          }
        }
      },
      { mode: "IMMEDIATE" },
    );

    logger.debug("Audit trace saved", { trace_id: trace.trace_id });
    return trace;
  } catch (error) {
    // Audit logging should never crash the caller
    logger.error("Failed to save audit trace", error as Error);
    return inputTrace;
  }
}

/**
 * Signature of the most recently stored trace (insertion order), or null
 * when the chain is empty. The next saved trace links onto this.
 */
function getLastChainSignature(db: ReturnType<typeof getDatabase>): string | null {
  const row = executeWithLogging(
    () =>
      db
        .prepare(
          "SELECT signature FROM audit_traces WHERE signature IS NOT NULL ORDER BY rowid DESC LIMIT 1",
        )
        .get() as { signature: string } | null,
    "SELECT last audit chain signature",
  );
  return row?.signature ?? null;
}

/**
 * Load every trace in chain (insertion) order and verify the tamper-evidence
 * chain. Returns the first broken link, if any.
 */
export function verifyStoredAuditChain(): AuditChainVerification {
  ensureTable();
  const db = getDatabase();

  const rows = executeWithLogging(
    () => db.prepare("SELECT * FROM audit_traces ORDER BY rowid ASC").all() as RawTraceRow[],
    "SELECT audit_traces in chain order",
  );

  const traces = rows.map((row) => rowToTrace(row, loadStepsForTrace(db, row.trace_id)));
  return verifyAuditChain(traces);
}

/**
 * Load a single trace by ID, including all steps and tool calls.
 */
export function getTrace(traceId: string): AuditTrace | null {
  try {
    ensureTable();
    const db = getDatabase();

    const traceRow = executeWithLogging(
      () =>
        db
          .prepare("SELECT * FROM audit_traces WHERE trace_id = ?")
          .get(traceId) as RawTraceRow | null,
      "SELECT audit_trace by id",
    );
    if (!traceRow) return null;

    const steps = loadStepsForTrace(db, traceId);
    return rowToTrace(traceRow, steps);
  } catch (error) {
    logger.error("Failed to get audit trace", error as Error);
    return null;
  }
}

/**
 * Get all traces linked to a specific position.
 */
export function getTracesByPosition(positionId: string): AuditTrace[] {
  try {
    ensureTable();
    const db = getDatabase();

    const rows = executeWithLogging(
      () =>
        db
          .prepare(
            "SELECT * FROM audit_traces WHERE outcome_position_id = ? ORDER BY started_at DESC",
          )
          .all(positionId) as RawTraceRow[],
      "SELECT audit_traces by position",
    );

    return rows.map((row) => {
      const steps = loadStepsForTrace(db, row.trace_id);
      return rowToTrace(row, steps);
    });
  } catch (error) {
    logger.error("Failed to get traces by position", error as Error);
    return [];
  }
}

/**
 * Get traces that involved a specific agent (by agent_id in steps).
 */
export function getTracesByAgent(agentId: string, limit: number = 50): AuditTrace[] {
  try {
    ensureTable();
    const db = getDatabase();

    const traceIds = executeWithLogging(
      () =>
        db
          .prepare(
            `SELECT DISTINCT trace_id FROM audit_agent_steps
             WHERE agent_id = ?
             ORDER BY started_at DESC
             LIMIT ?`,
          )
          .all(agentId, limit) as { trace_id: string }[],
      "SELECT trace_ids by agent",
    );

    return traceIds.map((r) => getTrace(r.trace_id)).filter((t): t is AuditTrace => t !== null);
  } catch (error) {
    logger.error("Failed to get traces by agent", error as Error);
    return [];
  }
}

/**
 * Get traces within a time range.
 */
export function getTracesByTimeRange(from: Date, to: Date): AuditTrace[] {
  try {
    ensureTable();
    const db = getDatabase();

    const rows = executeWithLogging(
      () =>
        db
          .prepare(
            "SELECT * FROM audit_traces WHERE started_at >= ? AND started_at <= ? ORDER BY started_at DESC",
          )
          .all(from.toISOString(), to.toISOString()) as RawTraceRow[],
      "SELECT audit_traces by time range",
    );

    return rows.map((row) => {
      const steps = loadStepsForTrace(db, row.trace_id);
      return rowToTrace(row, steps);
    });
  } catch (error) {
    logger.error("Failed to get traces by time range", error as Error);
    return [];
  }
}

/**
 * Get traces by outcome type.
 */
export function getTracesByOutcomeType(outcomeType: string): AuditTrace[] {
  try {
    ensureTable();
    const db = getDatabase();

    const rows = executeWithLogging(
      () =>
        db
          .prepare("SELECT * FROM audit_traces WHERE outcome_type = ? ORDER BY started_at DESC")
          .all(outcomeType) as RawTraceRow[],
      "SELECT audit_traces by outcome type",
    );

    return rows.map((row) => {
      const steps = loadStepsForTrace(db, row.trace_id);
      return rowToTrace(row, steps);
    });
  } catch (error) {
    logger.error("Failed to get traces by outcome type", error as Error);
    return [];
  }
}

/**
 * Get the most recent traces.
 */
export function getRecentTraces(limit: number = 20): AuditTrace[] {
  try {
    ensureTable();
    const db = getDatabase();

    const rows = executeWithLogging(
      () =>
        db
          .prepare("SELECT * FROM audit_traces ORDER BY started_at DESC LIMIT ?")
          .all(limit) as RawTraceRow[],
      "SELECT recent audit_traces",
    );

    return rows.map((row) => {
      const steps = loadStepsForTrace(db, row.trace_id);
      return rowToTrace(row, steps);
    });
  } catch (error) {
    logger.error("Failed to get recent traces", error as Error);
    return [];
  }
}

/**
 * Get aggregate statistics across the audit trail.
 */
export function getTraceStats(): AuditStats {
  try {
    ensureTable();
    const db = getDatabase();

    // Total count and avg duration
    const summaryRow = executeWithLogging(
      () =>
        db
          .prepare("SELECT COUNT(*) as total, AVG(duration_ms) as avg_dur FROM audit_traces")
          .get() as { total: number; avg_dur: number | null } | null,
      "SELECT audit trace summary stats",
    );

    const total = summaryRow?.total ?? 0;
    const avgDurationMs = summaryRow?.avg_dur ?? 0;

    if (total === 0) {
      return { total: 0, byAgent: {}, byOutcome: {}, byTrigger: {}, avgDurationMs: 0 };
    }

    // By outcome type
    const outcomeRows = executeWithLogging(
      () =>
        db
          .prepare("SELECT outcome_type, COUNT(*) as cnt FROM audit_traces GROUP BY outcome_type")
          .all() as { outcome_type: string; cnt: number }[],
      "SELECT audit outcome stats",
    );
    const byOutcome: Record<string, number> = {};
    for (const row of outcomeRows) {
      byOutcome[row.outcome_type] = row.cnt;
    }

    // By trigger type
    const triggerRows = executeWithLogging(
      () =>
        db
          .prepare("SELECT trigger_type, COUNT(*) as cnt FROM audit_traces GROUP BY trigger_type")
          .all() as { trigger_type: string; cnt: number }[],
      "SELECT audit trigger stats",
    );
    const byTrigger: Record<string, number> = {};
    for (const row of triggerRows) {
      byTrigger[row.trigger_type] = row.cnt;
    }

    // By agent (from steps)
    const agentRows = executeWithLogging(
      () =>
        db
          .prepare(
            "SELECT agent_id, COUNT(DISTINCT trace_id) as cnt FROM audit_agent_steps GROUP BY agent_id",
          )
          .all() as { agent_id: string; cnt: number }[],
      "SELECT audit agent stats",
    );
    const byAgent: Record<string, number> = {};
    for (const row of agentRows) {
      byAgent[row.agent_id] = row.cnt;
    }

    return { total, byAgent, byOutcome, byTrigger, avgDurationMs };
  } catch (error) {
    logger.error("Failed to get audit stats", error as Error);
    return { total: 0, byAgent: {}, byOutcome: {}, byTrigger: {}, avgDurationMs: 0 };
  }
}

/**
 * Delete traces older than the specified number of days.
 * Returns the number of traces pruned.
 */
export function pruneOldTraces(olderThanDays: number): number {
  try {
    ensureTable();
    const db = getDatabase();

    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();

    let pruned = 0;

    withTransaction(
      () => {
        // Get trace IDs to prune
        const traceIds = executeWithLogging(
          () =>
            db.prepare("SELECT trace_id FROM audit_traces WHERE started_at < ?").all(cutoff) as {
              trace_id: string;
            }[],
          "SELECT old audit trace ids",
        );

        if (traceIds.length === 0) return;

        const idList = traceIds.map((r) => r.trace_id);
        const placeholders = idList.map(() => "?").join(",");

        // Delete tool calls for those steps
        executeWithLogging(
          () =>
            db
              .prepare(
                `DELETE FROM audit_tool_calls WHERE step_id IN
                (SELECT step_id FROM audit_agent_steps WHERE trace_id IN (${placeholders}))`,
              )
              .run(...idList),
          "DELETE old audit_tool_calls",
        );

        // Delete steps
        executeWithLogging(
          () =>
            db
              .prepare(`DELETE FROM audit_agent_steps WHERE trace_id IN (${placeholders})`)
              .run(...idList),
          "DELETE old audit_agent_steps",
        );

        // Delete traces
        const result = executeWithLogging(
          () =>
            db
              .prepare(`DELETE FROM audit_traces WHERE trace_id IN (${placeholders})`)
              .run(...idList),
          "DELETE old audit_traces",
        );

        pruned = result.changes;
      },
      { mode: "IMMEDIATE" },
    );

    if (pruned > 0) {
      logger.info("Audit traces pruned", {
        pruned: String(pruned),
        olderThanDays: String(olderThanDays),
      });
    }

    return pruned;
  } catch (error) {
    logger.error("Failed to prune audit traces", error as Error);
    return 0;
  }
}

// ============================================================================
// Internal Helpers
// ============================================================================

function ensureTable(): void {
  initAuditTables();
}

/**
 * Return a copy of the trace with credential/PII-shaped values redacted out
 * of every free-text summary field that gets persisted: the outcome details,
 * the trigger payload summary, and each tool call's input/output summary and
 * error. Runs before signing so the tamper chain stays consistent.
 */
function redactTraceContent(trace: AuditTrace): AuditTrace {
  return {
    ...trace,
    trigger: {
      ...trace.trigger,
      payload_summary: redactString(trace.trigger.payload_summary),
    },
    outcome: {
      ...trace.outcome,
      details: redactString(trace.outcome.details),
    },
    agent_steps: trace.agent_steps.map((step) => ({
      ...step,
      tool_calls: step.tool_calls.map((tc) => ({
        ...tc,
        input_summary: redactString(tc.input_summary),
        output_summary: redactString(tc.output_summary),
        ...(tc.error !== undefined ? { error: redactString(tc.error) } : {}),
      })),
    })),
  };
}

/**
 * Load all steps (with their tool calls) for a given trace_id.
 */
function loadStepsForTrace(db: ReturnType<typeof getDatabase>, traceId: string): AuditAgentStep[] {
  const stepRows = executeWithLogging(
    () =>
      db
        .prepare("SELECT * FROM audit_agent_steps WHERE trace_id = ? ORDER BY step_order ASC")
        .all(traceId) as RawStepRow[],
    "SELECT audit_agent_steps for trace",
  );

  return stepRows.map((stepRow) => {
    const toolRows = executeWithLogging(
      () =>
        db
          .prepare("SELECT * FROM audit_tool_calls WHERE step_id = ? ORDER BY call_order ASC")
          .all(stepRow.step_id) as RawToolCallRow[],
      "SELECT audit_tool_calls for step",
    );
    const toolCalls = toolRows.map(rowToToolCall);
    return rowToStep(stepRow, toolCalls);
  });
}
