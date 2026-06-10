/**
 * Trade Ledger — append-only execution record (GORDON_TRADE_LEDGER).
 *
 * Per-batch execution envelope: every successful `execute_plan` invocation
 * appends one record to `~/.gordon/trade-ledger.jsonl` with:
 *
 *   - recordId        : UUID, unique per batch
 *   - priorRecordId   : id of the previous record (chain link for ordering)
 *   - timestamp       : ms epoch
 *   - planId          : reference to the source plan
 *   - rationale       : the operator-visible "why" (from execute_plan's
 *                       required rationale field)
 *   - operations      : the orders that were submitted
 *   - results         : per-operation outcome (filled / rejected / etc.)
 *   - stateBefore     : account snapshot before execution (optional —
 *                       caller fills what it can capture)
 *   - stateAfter      : account snapshot after execution (optional)
 *
 * Why not git? Trading is append-only with one timeline, no branches, no
 * merges, no undo (money moved). Borrowing git's metaphor implies
 * capabilities the domain doesn't have. A *ledger* — the accountant's
 * artifact traders have used for centuries — matches the actual semantics:
 * sequential, immutable, with running-balance state deltas and a memo
 * field per entry.
 *
 * This primitive provides:
 *   - `buildExecutionRecord`     : pure builder (no I/O)
 *   - `appendExecutionRecord`    : append one JSONL line
 *   - `readExecutionRecords`     : read + filter (by symbol, time, limit)
 *   - `lastRecordId`             : convenience for chain-link continuity
 *   - `appendExecutionRecordFresh`: build + chain + append in one call
 *
 * Together with the signed audit log, each record answers: what did we do,
 * why, and what state did the account end up in?
 *
 * Pure compute for the builders. File I/O isolated in the persistence
 * helpers, which use the same `~/.gordon/` storage path convention as
 * the cost tracker and action log.
 */

import { randomUUID, createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { appendFile, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { GORDON_DIR } from "../storage/paths.ts";

export const TRADE_LEDGER_FLAG_ENV = "GORDON_TRADE_LEDGER";
export const TRADE_LEDGER_PATH_ENV = "GORDON_TRADE_LEDGER_PATH";

export function isTradeLedgerEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    env[TRADE_LEDGER_FLAG_ENV] === "1" ||
    env[TRADE_LEDGER_FLAG_ENV] === "true"
  );
}

export function defaultTradeLedgerPath(): string {
  return process.env[TRADE_LEDGER_PATH_ENV] ?? join(GORDON_DIR, "trade-ledger.jsonl");
}

// ---------------------------- types ----------------------------

export type ExecutionAction =
  | "place_order"
  | "modify_order"
  | "cancel_order"
  | "cancel_replace_order"
  | "close_position";

export interface ExecutionOperation {
  action: ExecutionAction;
  symbol?: string;
  side?: "buy" | "sell" | "short" | "long";
  qty?: number;
  price?: number;
  orderId?: string;
  /** Free-form metadata about the operation (TP/SL params, contract type, etc.). */
  metadata?: Record<string, unknown>;
}

export type OperationStatus =
  | "submitted"
  | "filled"
  | "partial"
  | "rejected"
  | "cancelled"
  | "skipped";

export interface ExecutionResult {
  /** Index into the parent record's `operations` array. */
  operationIndex: number;
  status: OperationStatus;
  filledQty?: number;
  filledPrice?: number;
  brokerOrderId?: string;
  error?: string;
}

export interface AccountSnapshot {
  netLiquidationUsd?: number;
  cashUsd?: number;
  unrealizedPnLUsd?: number;
  realizedPnLUsd?: number;
  positions?: Array<{
    symbol: string;
    qty: number;
    markPrice?: number;
    side?: "long" | "short";
  }>;
  pendingOrders?: Array<{
    orderId: string;
    symbol: string;
    side: string;
    qty: number;
  }>;
}

export interface ExecutionRecord {
  recordId: string;
  priorRecordId: string | null;
  timestamp: number;
  planId?: string;
  symbol?: string;
  rationale: string;
  acknowledgedRisks?: string[];
  operations: ExecutionOperation[];
  results: ExecutionResult[];
  stateBefore?: AccountSnapshot;
  stateAfter?: AccountSnapshot;
  /**
   * Tamper-evidence-lite: sha-256 of the canonical record body (excluding
   * the field itself). Detects accidental mutation of the JSONL file but
   * is NOT a cryptographic commitment to a trusted external authority —
   * the broker has the canonical record, this just tells the operator
   * if their local copy was edited.
   */
  bodyHash: string;
}

export interface ExecutionRecordInput {
  priorRecordId: string | null;
  timestamp?: number;
  planId?: string;
  symbol?: string;
  rationale: string;
  acknowledgedRisks?: string[];
  operations: ExecutionOperation[];
  results: ExecutionResult[];
  stateBefore?: AccountSnapshot;
  stateAfter?: AccountSnapshot;
  /** Override recordId (for tests + deterministic replay). Defaults to randomUUID(). */
  recordIdOverride?: string;
}

// --------------------------- builders --------------------------

function computeBodyHash(body: Omit<ExecutionRecord, "bodyHash">): string {
  const serialized = JSON.stringify(body, Object.keys(body).sort());
  return createHash("sha256").update(serialized).digest("hex").slice(0, 16);
}

export function buildExecutionRecord(input: ExecutionRecordInput): ExecutionRecord {
  if (!input.rationale || input.rationale.length < 10) {
    throw new Error("rationale must be a string of at least 10 characters");
  }
  if (!Array.isArray(input.operations) || input.operations.length === 0) {
    throw new Error("operations must be a non-empty array");
  }
  if (!Array.isArray(input.results)) {
    throw new Error("results must be an array (may be empty if no executions)");
  }

  const body: Omit<ExecutionRecord, "bodyHash"> = {
    recordId: input.recordIdOverride ?? randomUUID(),
    priorRecordId: input.priorRecordId,
    timestamp: input.timestamp ?? Date.now(),
    planId: input.planId,
    symbol: input.symbol,
    rationale: input.rationale,
    acknowledgedRisks: input.acknowledgedRisks,
    operations: [...input.operations],
    results: [...input.results],
    stateBefore: input.stateBefore,
    stateAfter: input.stateAfter,
  };

  const bodyHash = computeBodyHash(body);
  return Object.freeze({ ...body, bodyHash });
}

// ----------------------- persistence ---------------------------

function ensureLedgerDir(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export async function appendExecutionRecord(
  record: ExecutionRecord,
  ledgerPath: string = defaultTradeLedgerPath(),
): Promise<void> {
  ensureLedgerDir(ledgerPath);
  await appendFile(ledgerPath, JSON.stringify(record) + "\n", "utf-8");
}

export interface ReadOptions {
  /** Filter to records whose `symbol` matches this string. */
  symbol?: string;
  /** Only records with timestamp >= this value (ms epoch). */
  sinceMs?: number;
  /** Maximum number of records to return (returns the most recent N). */
  limit?: number;
  /** Filter to records whose planId matches. */
  planId?: string;
}

export async function readExecutionRecords(
  options: ReadOptions = {},
  ledgerPath: string = defaultTradeLedgerPath(),
): Promise<ExecutionRecord[]> {
  if (!existsSync(ledgerPath)) return [];
  const raw = await readFile(ledgerPath, "utf-8");
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  const records: ExecutionRecord[] = [];
  for (const line of lines) {
    try {
      const rec = JSON.parse(line) as ExecutionRecord;
      if (options.symbol && rec.symbol !== options.symbol) continue;
      if (options.planId && rec.planId !== options.planId) continue;
      if (options.sinceMs !== undefined && rec.timestamp < options.sinceMs) continue;
      records.push(rec);
    } catch {
      // Skip malformed lines — never throw mid-read; the ledger is best-effort
      // for navigation, the broker is canonical truth.
    }
  }
  if (options.limit !== undefined && options.limit > 0) {
    return records.slice(-options.limit);
  }
  return records;
}

export async function getExecutionRecord(
  recordId: string,
  ledgerPath: string = defaultTradeLedgerPath(),
): Promise<ExecutionRecord | null> {
  const all = await readExecutionRecords({}, ledgerPath);
  return all.find((r) => r.recordId === recordId) ?? null;
}

export async function lastRecordId(
  ledgerPath: string = defaultTradeLedgerPath(),
): Promise<string | null> {
  const all = await readExecutionRecords({}, ledgerPath);
  if (all.length === 0) return null;
  return all[all.length - 1]!.recordId;
}

/**
 * Convenience: read the last recordId for chain continuity, build the
 * record, append it. Returns the persisted record. All errors swallowed —
 * caller should treat ledger writes as best-effort (broker is canonical).
 */
export async function appendExecutionRecordFresh(
  input: Omit<ExecutionRecordInput, "priorRecordId">,
  ledgerPath: string = defaultTradeLedgerPath(),
): Promise<ExecutionRecord | null> {
  try {
    const prior = await lastRecordId(ledgerPath);
    const record = buildExecutionRecord({ ...input, priorRecordId: prior });
    await appendExecutionRecord(record, ledgerPath);
    return record;
  } catch {
    return null;
  }
}

// --------------------------- payload helper --------------------

export function executionRecordToPayload(
  record: ExecutionRecord,
): Record<string, unknown> {
  return {
    kind: "trade_ledger.recorded",
    recordId: record.recordId,
    priorRecordId: record.priorRecordId,
    timestamp: record.timestamp,
    planId: record.planId,
    symbol: record.symbol,
    rationale: record.rationale,
    operationsCount: record.operations.length,
    resultsCount: record.results.length,
    netLiqDelta:
      record.stateBefore?.netLiquidationUsd !== undefined &&
      record.stateAfter?.netLiquidationUsd !== undefined
        ? Number(
            (
              record.stateAfter.netLiquidationUsd -
              record.stateBefore.netLiquidationUsd
            ).toFixed(4),
          )
        : null,
    realizedPnLDelta:
      record.stateBefore?.realizedPnLUsd !== undefined &&
      record.stateAfter?.realizedPnLUsd !== undefined
        ? Number(
            (
              record.stateAfter.realizedPnLUsd -
              record.stateBefore.realizedPnLUsd
            ).toFixed(4),
          )
        : null,
    bodyHash: record.bodyHash,
  };
}
