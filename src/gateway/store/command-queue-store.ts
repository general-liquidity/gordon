import { executeWithLogging, getDatabase } from "../../infra/storage/database.ts";
import type { GatewayCommandEnvelope } from "../protocol/commands.ts";

export type QueueStatus = "pending" | "running" | "completed" | "failed";

export interface QueueEntry {
  id: number;
  sessionId: string;
  correlationId: string;
  idempotencyKey?: string;
  commandType: string;
  payload: GatewayCommandEnvelope;
  status: QueueStatus;
  priority: number;
  attempts: number;
  maxAttempts: number;
  availableAt: string;
  startedAt?: string;
  finishedAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

interface RawQueueRow {
  id: number;
  sessionId: string;
  correlationId: string;
  idempotencyKey: string | null;
  commandType: string;
  payloadJson: string;
  status: QueueStatus;
  priority: number;
  attempts: number;
  maxAttempts: number;
  availableAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

function rowToQueueEntry(row: RawQueueRow): QueueEntry {
  return {
    id: row.id,
    sessionId: row.sessionId,
    correlationId: row.correlationId,
    idempotencyKey: row.idempotencyKey ?? undefined,
    commandType: row.commandType,
    payload: JSON.parse(row.payloadJson) as GatewayCommandEnvelope,
    status: row.status,
    priority: row.priority,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    availableAt: row.availableAt,
    startedAt: row.startedAt ?? undefined,
    finishedAt: row.finishedAt ?? undefined,
    lastError: row.lastError ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function enqueueCommand(input: {
  envelope: GatewayCommandEnvelope;
  priority?: number;
  maxAttempts?: number;
  availableAt?: string;
}): number {
  const db = getDatabase();
  const now = new Date().toISOString();
  const result = executeWithLogging(
    () =>
      db
        .query(
          `INSERT INTO gateway_command_queue
            (sessionId, correlationId, idempotencyKey, commandType, payloadJson, status,
             priority, attempts, maxAttempts, availableAt, startedAt, finishedAt, lastError, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL, NULL, NULL, ?, ?)`,
        )
        .run(
          input.envelope.meta.sessionId,
          input.envelope.meta.correlationId,
          input.envelope.meta.idempotencyKey ?? null,
          input.envelope.command.type,
          JSON.stringify(input.envelope),
          "pending",
          input.priority ?? 100,
          input.maxAttempts ?? 3,
          input.availableAt ?? now,
          now,
          now,
        ),
    "INSERT gateway_command_queue",
  );

  return Number(result.lastInsertRowid ?? 0);
}

export function dequeueNextCommand(sessionId: string): QueueEntry | null {
  const db = getDatabase();
  const now = new Date().toISOString();
  const row = executeWithLogging(
    () =>
      db
        .query(
          `SELECT *
           FROM gateway_command_queue
           WHERE sessionId = ?
             AND status = 'pending'
             AND availableAt <= ?
           ORDER BY priority ASC, id ASC
           LIMIT 1`,
        )
        .get(sessionId, now) as RawQueueRow | null,
    "SELECT gateway_command_queue dequeue",
  );
  if (!row) return null;

  executeWithLogging(
    () =>
      db
        .query(
          `UPDATE gateway_command_queue
           SET status = 'running', attempts = attempts + 1, startedAt = ?, updatedAt = ?
           WHERE id = ?`,
        )
        .run(now, now, row.id),
    "UPDATE gateway_command_queue running",
  );

  return rowToQueueEntry({
    ...row,
    status: "running",
    attempts: row.attempts + 1,
    startedAt: now,
    updatedAt: now,
  });
}

export function markQueueCommandCompleted(id: number): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  executeWithLogging(
    () =>
      db
        .query(
          `UPDATE gateway_command_queue
           SET status = 'completed', finishedAt = ?, updatedAt = ?
           WHERE id = ?`,
        )
        .run(now, now, id),
    "UPDATE gateway_command_queue completed",
  );
}

export function markQueueCommandFailed(id: number, error: string, retryDelayMs: number = 0): void {
  const db = getDatabase();
  const now = new Date();
  const nextAvailable = new Date(now.getTime() + retryDelayMs).toISOString();

  const row = executeWithLogging(
    () =>
      db
        .query("SELECT attempts, maxAttempts FROM gateway_command_queue WHERE id = ?")
        .get(id) as { attempts: number; maxAttempts: number } | null,
    "SELECT gateway_command_queue retry-state",
  );

  const terminal = row ? row.attempts >= row.maxAttempts : true;

  executeWithLogging(
    () =>
      db
        .query(
          `UPDATE gateway_command_queue
           SET status = ?, lastError = ?, availableAt = ?, finishedAt = ?, updatedAt = ?
           WHERE id = ?`,
        )
        .run(
          terminal ? "failed" : "pending",
          error,
          nextAvailable,
          terminal ? now.toISOString() : null,
          now.toISOString(),
          id,
        ),
    "UPDATE gateway_command_queue failed",
  );
}

/**
 * Commands safe to re-run after a daemon crash interrupted them mid-execution.
 * Fail-closed allow-list: any command type NOT listed here (including future
 * additions) is marked failed instead of requeued, because a crash
 * mid-execution may already have produced side effects (orders placed, agent
 * actions taken) that a blind retry would duplicate.
 *
 * Deliberately excluded: chat.send_message (an agent turn can place orders
 * before the crash), execution.start_intent (starts an order-placing
 * execution session), autonomous.run_cycle (full trading cycle),
 * daemon.shutdown (moot after restart).
 */
const CRASH_RETRY_SAFE_COMMANDS = new Set<string>([
  "runtime.background_status",
  "runtime.health_check",
  "scheduler.list_tasks",
  "reconcile.run",
  "capital.refresh",
  "regime.check",
  "circuit_breaker.evaluate",
  "scan.run",
  "monitor.run_cycle",
  "learning.analyze_trade",
  "evolution.tick",
  "plugin.reload",
  "scheduler.create_task",
  "scheduler.delete_task",
  "system.set_permission_mode",
]);

export interface OrphanedCommandResetResult {
  requeued: number;
  failed: number;
  entries: Array<{ id: number; commandType: string; outcome: "pending" | "failed"; reason: string }>;
}

/**
 * Recover queue entries left in 'running' by a previous daemon process that
 * died mid-execution. Without this, those entries block their session
 * forever. Call once at daemon startup, before any command processing.
 */
export function resetOrphanedRunningCommands(): OrphanedCommandResetResult {
  const db = getDatabase();
  const now = new Date().toISOString();

  const rows = executeWithLogging(
    () =>
      db
        .query(
          `SELECT id, commandType, attempts, maxAttempts
           FROM gateway_command_queue
           WHERE status = 'running'`,
        )
        .all() as Array<{ id: number; commandType: string; attempts: number; maxAttempts: number }>,
    "SELECT gateway_command_queue orphaned-running",
  );

  const result: OrphanedCommandResetResult = { requeued: 0, failed: 0, entries: [] };

  for (const row of rows) {
    const retrySafe = CRASH_RETRY_SAFE_COMMANDS.has(row.commandType);
    if (retrySafe && row.attempts < row.maxAttempts) {
      const reason = "orphaned running entry from previous daemon process; requeued";
      executeWithLogging(
        () =>
          db
            .query(
              `UPDATE gateway_command_queue
               SET status = 'pending', availableAt = ?, lastError = ?, startedAt = NULL, updatedAt = ?
               WHERE id = ?`,
            )
            .run(now, reason, now, row.id),
        "UPDATE gateway_command_queue orphan-requeue",
      );
      result.requeued++;
      result.entries.push({ id: row.id, commandType: row.commandType, outcome: "pending", reason });
    } else {
      const reason = retrySafe
        ? "orphaned running entry from previous daemon process; attempts exhausted"
        : `orphaned running entry from previous daemon process; '${row.commandType}' is not crash-retry-safe (may have had side effects before the crash)`;
      executeWithLogging(
        () =>
          db
            .query(
              `UPDATE gateway_command_queue
               SET status = 'failed', lastError = ?, finishedAt = ?, updatedAt = ?
               WHERE id = ?`,
            )
            .run(reason, now, now, row.id),
        "UPDATE gateway_command_queue orphan-fail",
      );
      result.failed++;
      result.entries.push({ id: row.id, commandType: row.commandType, outcome: "failed", reason });
    }
  }

  return result;
}

export function getQueueDepth(sessionId: string): {
  pending: number;
  running: number;
  failed: number;
} {
  const db = getDatabase();
  const rows = executeWithLogging(
    () =>
      db
        .query(
          `SELECT status, COUNT(*) as count
           FROM gateway_command_queue
           WHERE sessionId = ?
           GROUP BY status`,
        )
        .all(sessionId) as Array<{ status: QueueStatus; count: number }>,
    "SELECT gateway_command_queue depth",
  );

  return {
    pending: rows.find((r) => r.status === "pending")?.count ?? 0,
    running: rows.find((r) => r.status === "running")?.count ?? 0,
    failed: rows.find((r) => r.status === "failed")?.count ?? 0,
  };
}

