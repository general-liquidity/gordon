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

