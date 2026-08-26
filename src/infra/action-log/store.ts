import { randomUUID } from "node:crypto";
import { executeWithLogging, getDatabase } from "../storage/database.ts";
// Leaf import (zero deps) — avoids a cycle back through Curator, which reads
// this store. Stamps the active ACE lesson revision onto each logged action.
import { stampAceLessonRevision } from "../agents/ace/activeRevision.ts";
import type {
  ActionLogEntry,
  ActionLogEntryType,
  AppendActionLogEntryInput,
  ListActionLogEntriesOptions,
} from "./types.ts";

interface ActionLogRow {
  id: string;
  threadId: string | null;
  resourceId: string | null;
  sessionId: string | null;
  correlationId: string | null;
  runId: string | null;
  parentEntryId: string | null;
  entryType: string;
  title: string;
  content: string;
  payloadJson: string;
  label: string | null;
  bookmarked: number;
  createdAt: string;
}

function rowToEntry(row: ActionLogRow): ActionLogEntry {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(row.payloadJson) as Record<string, unknown>;
  } catch {
    payload = { rawPayloadJson: row.payloadJson };
  }
  return {
    id: row.id,
    threadId: row.threadId ?? undefined,
    resourceId: row.resourceId ?? undefined,
    sessionId: row.sessionId ?? undefined,
    correlationId: row.correlationId ?? undefined,
    runId: row.runId ?? undefined,
    parentEntryId: row.parentEntryId ?? undefined,
    entryType: row.entryType as ActionLogEntryType,
    title: row.title,
    content: row.content,
    payload,
    label: row.label ?? undefined,
    bookmarked: row.bookmarked === 1,
    createdAt: row.createdAt,
  };
}

function serializePayload(payload: Record<string, unknown>): string {
  try {
    return JSON.stringify(payload);
  } catch {
    return JSON.stringify({
      serializationError: true,
      preview: String(payload),
    });
  }
}

export function appendActionLogEntry(input: AppendActionLogEntryInput): ActionLogEntry {
  const db = getDatabase();
  const entry: ActionLogEntry = {
    id: input.id ?? randomUUID(),
    threadId: input.threadId,
    resourceId: input.resourceId,
    sessionId: input.sessionId,
    correlationId: input.correlationId,
    runId: input.runId,
    parentEntryId: input.parentEntryId,
    entryType: input.entryType,
    title: input.title,
    content: input.content ?? "",
    payload: stampAceLessonRevision(input.payload ?? {}, [
      input.sessionId,
      input.threadId,
      input.resourceId,
    ]),
    label: input.label,
    bookmarked: input.bookmarked ?? false,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };

  executeWithLogging(
    () =>
      db.query(
        `INSERT INTO action_log_entries
          (id, threadId, resourceId, sessionId, correlationId, runId, parentEntryId, entryType, title, content, payloadJson, label, bookmarked, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        entry.id,
        entry.threadId ?? null,
        entry.resourceId ?? null,
        entry.sessionId ?? null,
        entry.correlationId ?? null,
        entry.runId ?? null,
        entry.parentEntryId ?? null,
        entry.entryType,
        entry.title,
        entry.content,
        serializePayload(entry.payload),
        entry.label ?? null,
        entry.bookmarked ? 1 : 0,
        entry.createdAt,
      ),
    "INSERT action_log_entries",
  );

  return entry;
}

export function getActionLogEntry(entryId: string): ActionLogEntry | null {
  const db = getDatabase();
  const row = executeWithLogging(
    () => db.query("SELECT * FROM action_log_entries WHERE id = ?").get(entryId) as ActionLogRow | null,
    "SELECT action_log_entries one",
  );
  return row ? rowToEntry(row) : null;
}

export function listActionLogEntries(options: ListActionLogEntriesOptions = {}): ActionLogEntry[] {
  const db = getDatabase();
  const clauses: string[] = [];
  const params: Array<string | number> = [];

  if (options.threadId) {
    clauses.push("threadId = ?");
    params.push(options.threadId);
  }
  if (options.resourceId) {
    clauses.push("resourceId = ?");
    params.push(options.resourceId);
  }
  if (options.sessionId) {
    clauses.push("sessionId = ?");
    params.push(options.sessionId);
  }
  if (options.correlationId) {
    clauses.push("correlationId = ?");
    params.push(options.correlationId);
  }
  if (options.runId) {
    clauses.push("runId = ?");
    params.push(options.runId);
  }
  if (options.parentEntryId) {
    clauses.push("parentEntryId = ?");
    params.push(options.parentEntryId);
  }
  if (options.entryTypes && options.entryTypes.length > 0) {
    clauses.push(`entryType IN (${options.entryTypes.map(() => "?").join(", ")})`);
    params.push(...options.entryTypes);
  }
  if (options.bookmarkedOnly) {
    clauses.push("bookmarked = 1");
  }

  const sql = [
    "SELECT * FROM action_log_entries",
    clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
    "ORDER BY datetime(createdAt) DESC, rowid DESC",
    "LIMIT ?",
  ].filter(Boolean).join(" ");
  params.push(options.limit ?? 100);

  const rows = executeWithLogging(
    () => db.query(sql).all(...params) as ActionLogRow[],
    "SELECT action_log_entries many",
  );

  return rows.map(rowToEntry);
}

export function setActionLogBookmarked(entryId: string, bookmarked: boolean, label?: string): boolean {
  const db = getDatabase();
  const result = executeWithLogging(
    () =>
      db.query(
        `UPDATE action_log_entries
         SET bookmarked = ?, label = COALESCE(?, label)
         WHERE id = ?`,
      ).run(bookmarked ? 1 : 0, label ?? null, entryId),
    "UPDATE action_log_entries bookmark",
  );
  return Number(result.changes ?? 0) > 0;
}
