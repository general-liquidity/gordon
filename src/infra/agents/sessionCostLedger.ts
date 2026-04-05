import { executeWithLogging, getDatabase } from "../storage/database.ts";
import { recordStructuredSessionCost } from "../platform/observability/index.ts";

export interface SessionCostUsageInput {
  threadId: string;
  sessionId?: string;
  resourceId?: string;
  provider?: string;
  model?: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface SessionCostLedgerEntry {
  threadId: string;
  sessionId?: string;
  resourceId?: string;
  provider?: string;
  model?: string | null;
  requestCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  updatedAt: string;
}

interface SessionCostLedgerRow {
  threadId: string;
  sessionId: string | null;
  resourceId: string | null;
  provider: string | null;
  model: string | null;
  requestCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  updatedAt: string;
}

function rowToEntry(row: SessionCostLedgerRow | null): SessionCostLedgerEntry | null {
  if (!row) {
    return null;
  }

  return {
    threadId: row.threadId,
    sessionId: row.sessionId ?? undefined,
    resourceId: row.resourceId ?? undefined,
    provider: row.provider ?? undefined,
    model: row.model ?? undefined,
    requestCount: Number(row.requestCount ?? 0),
    promptTokens: Number(row.promptTokens ?? 0),
    completionTokens: Number(row.completionTokens ?? 0),
    totalTokens: Number(row.totalTokens ?? 0),
    updatedAt: row.updatedAt,
  };
}

export function recordSessionCostUsage(input: SessionCostUsageInput): SessionCostLedgerEntry {
  const db = getDatabase();
  const updatedAt = new Date().toISOString();

  executeWithLogging(
    () =>
      db.query(
        `INSERT INTO session_cost_ledger
          (threadId, sessionId, resourceId, provider, model, requestCount, promptTokens, completionTokens, totalTokens, updatedAt)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
         ON CONFLICT(threadId) DO UPDATE SET
           sessionId = COALESCE(excluded.sessionId, session_cost_ledger.sessionId),
           resourceId = COALESCE(excluded.resourceId, session_cost_ledger.resourceId),
           provider = COALESCE(excluded.provider, session_cost_ledger.provider),
           model = COALESCE(excluded.model, session_cost_ledger.model),
           requestCount = session_cost_ledger.requestCount + 1,
           promptTokens = session_cost_ledger.promptTokens + excluded.promptTokens,
           completionTokens = session_cost_ledger.completionTokens + excluded.completionTokens,
           totalTokens = session_cost_ledger.totalTokens + excluded.totalTokens,
           updatedAt = excluded.updatedAt`,
      ).run(
        input.threadId,
        input.sessionId ?? null,
        input.resourceId ?? null,
        input.provider ?? null,
        input.model ?? null,
        input.promptTokens,
        input.completionTokens,
        input.totalTokens,
        updatedAt,
      ),
    "UPSERT session_cost_ledger",
  );

  const entry = getSessionCostLedgerEntry(input.threadId) ?? {
    threadId: input.threadId,
    sessionId: input.sessionId,
    resourceId: input.resourceId,
    provider: input.provider,
    model: input.model,
    requestCount: 1,
    promptTokens: input.promptTokens,
    completionTokens: input.completionTokens,
    totalTokens: input.totalTokens,
    updatedAt,
  };

  try {
    recordStructuredSessionCost(entry);
  } catch {
    // Non-fatal observability path
  }

  return entry;
}

export function getSessionCostLedgerEntry(threadId?: string): SessionCostLedgerEntry | null {
  if (!threadId) {
    return null;
  }

  const db = getDatabase();
  const row = executeWithLogging(
    () =>
      db.query("SELECT * FROM session_cost_ledger WHERE threadId = ?").get(threadId) as SessionCostLedgerRow | null,
    "SELECT session_cost_ledger one",
  );

  return rowToEntry(row);
}

export function clearSessionCostLedger(threadId: string): void {
  const db = getDatabase();
  executeWithLogging(
    () => db.query("DELETE FROM session_cost_ledger WHERE threadId = ?").run(threadId),
    "DELETE session_cost_ledger",
  );
}
