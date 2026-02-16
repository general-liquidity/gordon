import { createHash } from "node:crypto";
import { createModuleLogger } from "../../infra/logger/index.ts";
import { executeWithLogging, getDatabase } from "../../infra/storage/database.ts";

const logger = createModuleLogger("gateway-audit-log");

export interface ImmutableAuditEntry {
  id: number;
  timestamp: string;
  eventType: string;
  actor: string;
  correlationId?: string;
  payload: Record<string, unknown>;
  prevHash?: string;
  entryHash: string;
  signature?: string;
}

interface RawAuditRow {
  id: number;
  timestamp: string;
  eventType: string;
  actor: string;
  correlationId: string | null;
  payloadJson: string;
  prevHash: string | null;
  entryHash: string;
  signature: string | null;
}

function canonicalize(input: {
  timestamp: string;
  eventType: string;
  actor: string;
  correlationId?: string;
  payload: Record<string, unknown>;
  prevHash?: string;
}): string {
  return JSON.stringify({
    timestamp: input.timestamp,
    eventType: input.eventType,
    actor: input.actor,
    correlationId: input.correlationId ?? "",
    payload: input.payload,
    prevHash: input.prevHash ?? "",
  });
}

function computeEntryHash(canonical: string): string {
  return createHash("sha256").update(canonical).digest("hex");
}

function rowToEntry(row: RawAuditRow): ImmutableAuditEntry {
  return {
    id: row.id,
    timestamp: row.timestamp,
    eventType: row.eventType,
    actor: row.actor,
    correlationId: row.correlationId ?? undefined,
    payload: JSON.parse(row.payloadJson) as Record<string, unknown>,
    prevHash: row.prevHash ?? undefined,
    entryHash: row.entryHash,
    signature: row.signature ?? undefined,
  };
}

export function appendImmutableAuditEntry(input: {
  eventType: string;
  actor: string;
  correlationId?: string;
  payload: Record<string, unknown>;
  signature?: string;
}): ImmutableAuditEntry {
  const db = getDatabase();
  const now = new Date().toISOString();

  const previous = executeWithLogging(
    () =>
      db
        .query("SELECT id, entryHash FROM gateway_audit_log ORDER BY id DESC LIMIT 1")
        .get() as { id: number; entryHash: string } | null,
    "SELECT gateway_audit_log last",
  );

  const canonical = canonicalize({
    timestamp: now,
    eventType: input.eventType,
    actor: input.actor,
    correlationId: input.correlationId,
    payload: input.payload,
    prevHash: previous?.entryHash,
  });
  const entryHash = computeEntryHash(canonical);

  const insert = executeWithLogging(
    () =>
      db
        .query(
          `INSERT INTO gateway_audit_log
            (timestamp, eventType, actor, correlationId, payloadJson, prevHash, entryHash, signature)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          now,
          input.eventType,
          input.actor,
          input.correlationId ?? null,
          JSON.stringify(input.payload),
          previous?.entryHash ?? null,
          entryHash,
          input.signature ?? null,
        ),
    "INSERT gateway_audit_log",
  );

  return {
    id: Number(insert.lastInsertRowid ?? 0),
    timestamp: now,
    eventType: input.eventType,
    actor: input.actor,
    correlationId: input.correlationId,
    payload: input.payload,
    prevHash: previous?.entryHash,
    entryHash,
    signature: input.signature,
  };
}

export function verifyAuditChain(limit: number = 1000): {
  valid: boolean;
  checked: number;
  firstInvalidId?: number;
  reason?: string;
} {
  const db = getDatabase();
  const rows = executeWithLogging(
    () =>
      db
        .query(
          `SELECT *
           FROM gateway_audit_log
           ORDER BY id DESC
           LIMIT ?`,
        )
        .all(limit) as RawAuditRow[],
    "SELECT gateway_audit_log verify",
  ).reverse();

  let lastHash: string | undefined;
  for (const row of rows) {
    const canonical = canonicalize({
      timestamp: row.timestamp,
      eventType: row.eventType,
      actor: row.actor,
      correlationId: row.correlationId ?? undefined,
      payload: JSON.parse(row.payloadJson) as Record<string, unknown>,
      prevHash: row.prevHash ?? undefined,
    });
    const expected = computeEntryHash(canonical);
    if (expected !== row.entryHash) {
      return {
        valid: false,
        checked: rows.length,
        firstInvalidId: row.id,
        reason: "Entry hash mismatch",
      };
    }

    if ((row.prevHash ?? undefined) !== lastHash) {
      return {
        valid: false,
        checked: rows.length,
        firstInvalidId: row.id,
        reason: "Previous hash pointer mismatch",
      };
    }

    lastHash = row.entryHash;
  }

  return { valid: true, checked: rows.length };
}

export function getRecentImmutableAuditEntries(limit: number = 100): ImmutableAuditEntry[] {
  const db = getDatabase();
  const rows = executeWithLogging(
    () =>
      db
        .query("SELECT * FROM gateway_audit_log ORDER BY id DESC LIMIT ?")
        .all(limit) as RawAuditRow[],
    "SELECT gateway_audit_log recent",
  );
  return rows.map(rowToEntry);
}

export function safeAppendAudit(input: {
  eventType: string;
  actor: string;
  correlationId?: string;
  payload: Record<string, unknown>;
}): void {
  try {
    appendImmutableAuditEntry(input);
  } catch (error) {
    logger.error("Failed to append immutable audit entry", error as Error);
  }
}

