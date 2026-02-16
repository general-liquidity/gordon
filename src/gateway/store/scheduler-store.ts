import { executeWithLogging, getDatabase } from "../../infra/storage/database.ts";
import type { GatewayCommandType } from "../protocol/commands.ts";

export interface SchedulerTaskRecord {
  taskId: string;
  cronExpr: string;
  commandType: GatewayCommandType;
  payload: Record<string, unknown>;
  enabled: boolean;
  nextRunAt?: string;
  lastRunAt?: string;
  createdAt: string;
  updatedAt: string;
}

interface RawTaskRow {
  taskId: string;
  cronExpr: string;
  commandType: GatewayCommandType;
  payloadJson: string;
  enabled: number;
  nextRunAt: string | null;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function rowToTask(row: RawTaskRow): SchedulerTaskRecord {
  return {
    taskId: row.taskId,
    cronExpr: row.cronExpr,
    commandType: row.commandType,
    payload: JSON.parse(row.payloadJson) as Record<string, unknown>,
    enabled: row.enabled === 1,
    nextRunAt: row.nextRunAt ?? undefined,
    lastRunAt: row.lastRunAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function upsertSchedulerTask(input: {
  taskId: string;
  cronExpr: string;
  commandType: GatewayCommandType;
  payload?: Record<string, unknown>;
  enabled?: boolean;
  nextRunAt?: string;
}): SchedulerTaskRecord {
  const db = getDatabase();
  const now = new Date().toISOString();

  executeWithLogging(
    () =>
      db
        .query(
          `INSERT INTO gateway_scheduler_tasks
            (taskId, cronExpr, commandType, payloadJson, enabled, nextRunAt, lastRunAt, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
           ON CONFLICT(taskId) DO UPDATE SET
             cronExpr=excluded.cronExpr,
             commandType=excluded.commandType,
             payloadJson=excluded.payloadJson,
             enabled=excluded.enabled,
             nextRunAt=excluded.nextRunAt,
             updatedAt=excluded.updatedAt`,
        )
        .run(
          input.taskId,
          input.cronExpr,
          input.commandType,
          JSON.stringify(input.payload ?? {}),
          input.enabled === false ? 0 : 1,
          input.nextRunAt ?? null,
          now,
          now,
        ),
    "UPSERT gateway_scheduler_tasks",
  );

  return getSchedulerTask(input.taskId)!;
}

export function getSchedulerTask(taskId: string): SchedulerTaskRecord | null {
  const db = getDatabase();
  const row = executeWithLogging(
    () => db.query("SELECT * FROM gateway_scheduler_tasks WHERE taskId = ?").get(taskId) as RawTaskRow | null,
    "SELECT gateway_scheduler_tasks one",
  );
  return row ? rowToTask(row) : null;
}

export function listSchedulerTasks(): SchedulerTaskRecord[] {
  const db = getDatabase();
  const rows = executeWithLogging(
    () =>
      db
        .query("SELECT * FROM gateway_scheduler_tasks ORDER BY taskId ASC")
        .all() as RawTaskRow[],
    "SELECT gateway_scheduler_tasks all",
  );
  return rows.map(rowToTask);
}

export function deleteSchedulerTask(taskId: string): boolean {
  const db = getDatabase();
  const result = executeWithLogging(
    () => db.query("DELETE FROM gateway_scheduler_tasks WHERE taskId = ?").run(taskId),
    "DELETE gateway_scheduler_tasks",
  );
  return Number(result.changes ?? 0) > 0;
}

export function updateSchedulerTaskRunState(taskId: string, input: {
  nextRunAt?: string;
  lastRunAt?: string;
}): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  executeWithLogging(
    () =>
      db
        .query(
          `UPDATE gateway_scheduler_tasks
           SET nextRunAt = ?, lastRunAt = ?, updatedAt = ?
           WHERE taskId = ?`,
        )
        .run(input.nextRunAt ?? null, input.lastRunAt ?? null, now, taskId),
    "UPDATE gateway_scheduler_tasks run-state",
  );
}

