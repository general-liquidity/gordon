import { executeWithLogging, getDatabase } from "../../infra/storage/database.ts";

export interface ReplayCheckResult {
  ok: boolean;
  reason?: string;
}

export function checkAndRegisterNonce(input: {
  nonce: string;
  sessionId: string;
  ttlSeconds?: number;
}): ReplayCheckResult {
  const db = getDatabase();
  const existing = executeWithLogging(
    () => db.query("SELECT nonce FROM gateway_nonce_cache WHERE nonce = ?").get(input.nonce) as { nonce: string } | null,
    "SELECT gateway_nonce_cache nonce",
  );
  if (existing) {
    return { ok: false, reason: "Replay detected: nonce already used." };
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + (input.ttlSeconds ?? 300) * 1000).toISOString();
  executeWithLogging(
    () =>
      db
        .query(
          `INSERT INTO gateway_nonce_cache (nonce, sessionId, createdAt, expiresAt)
           VALUES (?, ?, ?, ?)`,
        )
        .run(input.nonce, input.sessionId, now.toISOString(), expiresAt),
    "INSERT gateway_nonce_cache",
  );

  return { ok: true };
}

export function pruneExpiredNonces(): number {
  const db = getDatabase();
  const now = new Date().toISOString();
  const result = executeWithLogging(
    () => db.query("DELETE FROM gateway_nonce_cache WHERE expiresAt < ?").run(now),
    "DELETE gateway_nonce_cache expired",
  );
  return Number(result.changes ?? 0);
}

