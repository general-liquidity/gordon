import { createHash } from "node:crypto";
import { createModuleLogger } from "../../infra/logger/index.ts";
import { executeWithLogging, getDatabase } from "../../infra/storage/database.ts";

const logger = createModuleLogger("gateway-idempotency");

type IdempotencyStatus = "reserved" | "completed" | "failed";

interface RawIdempotencyRow {
  idempotencyKey: string;
  sessionId: string;
  commandType: string;
  requestHash: string;
  status: IdempotencyStatus;
  responseJson: string | null;
  createdAt: string;
  expiresAt: string | null;
}

export type IdempotencyReservationResult =
  | { status: "reserved" }
  | { status: "replayed"; response: unknown }
  | { status: "conflict"; reason: string };

export function hashIdempotencyPayload(payload: unknown): string {
  const canonical = JSON.stringify(payload ?? {});
  return createHash("sha256").update(canonical).digest("hex");
}

export function reserveIdempotencyKey(input: {
  idempotencyKey?: string;
  sessionId: string;
  commandType: string;
  payload: unknown;
  ttlHours?: number;
}): IdempotencyReservationResult {
  const key = input.idempotencyKey;
  if (!key) return { status: "reserved" };

  const db = getDatabase();
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + (input.ttlHours ?? 24) * 60 * 60 * 1000).toISOString();
  const requestHash = hashIdempotencyPayload({
    commandType: input.commandType,
    payload: input.payload,
  });

  const row = executeWithLogging(
    () =>
      db
        .query("SELECT * FROM gateway_idempotency WHERE idempotencyKey = ?")
        .get(key) as RawIdempotencyRow | null,
    "SELECT gateway_idempotency",
  );

  if (!row) {
    executeWithLogging(
      () =>
        db
          .query(
            `INSERT INTO gateway_idempotency
            (idempotencyKey, sessionId, commandType, requestHash, status, responseJson, createdAt, expiresAt)
            VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
          )
          .run(key, input.sessionId, input.commandType, requestHash, "reserved", nowIso, expiresAt),
      "INSERT gateway_idempotency",
    );
    return { status: "reserved" };
  }

  if (row.requestHash !== requestHash) {
    return {
      status: "conflict",
      reason: "Idempotency key reused with different payload.",
    };
  }

  if (row.status === "completed" && row.responseJson) {
    try {
      return { status: "replayed", response: JSON.parse(row.responseJson) };
    } catch {
      logger.warn("Failed to parse idempotency replay payload", { key });
      return { status: "conflict", reason: "Stored idempotent response is invalid JSON." };
    }
  }

  return { status: "reserved" };
}

export function completeIdempotencyKey(input: {
  idempotencyKey?: string;
  response: unknown;
}): void {
  const idempotencyKey = input.idempotencyKey;
  if (!idempotencyKey) return;
  const db = getDatabase();
  executeWithLogging(
    () =>
      db
        .query(
          `UPDATE gateway_idempotency
          SET status = ?, responseJson = ?, expiresAt = ?
          WHERE idempotencyKey = ?`,
        )
        .run(
          "completed",
          JSON.stringify(input.response ?? null),
          new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          idempotencyKey,
        ),
    "UPDATE gateway_idempotency completed",
  );
}

export function failIdempotencyKey(input: { idempotencyKey?: string; error: unknown }): void {
  const idempotencyKey = input.idempotencyKey;
  if (!idempotencyKey) return;
  const db = getDatabase();
  executeWithLogging(
    () =>
      db
        .query(
          `UPDATE gateway_idempotency
          SET status = ?, responseJson = ?
          WHERE idempotencyKey = ?`,
        )
        .run("failed", JSON.stringify({ error: String(input.error) }), idempotencyKey),
    "UPDATE gateway_idempotency failed",
  );
}

export function pruneExpiredIdempotencyKeys(): number {
  const db = getDatabase();
  const now = new Date().toISOString();
  const result = executeWithLogging(
    () =>
      db
        .query("DELETE FROM gateway_idempotency WHERE expiresAt IS NOT NULL AND expiresAt < ?")
        .run(now),
    "DELETE gateway_idempotency expired",
  );
  return Number(result.changes ?? 0);
}
