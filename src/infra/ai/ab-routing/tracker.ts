/**
 * Acceptance tracking — append-only JSONL ledger of (testId, variantId,
 * outcome) records. Same persistence pattern as trade-ledger + skill-
 * usage + agent-feedback.
 *
 * Path: ~/.gordon/model-ab-routing.jsonl (override via
 * GORDON_MODEL_AB_PATH; disable entirely via GORDON_MODEL_AB_DISABLED=1).
 * Silent on I/O failure — tracking outage must never break the
 * underlying LLM invocation.
 *
 * The stats aggregator reuses `wilsonInterval` from the expectancy
 * module to avoid duplicating the CI math. When the two variants'
 * 95% Wilson CIs don't overlap, the higher-mean variant is declared
 * the significant winner.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { GORDON_DIR } from "../../storage/paths.ts";
import { wilsonInterval } from "../../safety/expectancyByTag.ts";
import type {
  AbTestStats,
  AcceptanceOutcome,
  AcceptanceRecord,
  ReadOptions,
  RecordOptions,
  VariantStats,
} from "./types.ts";

export function defaultAbLedgerPath(): string {
  return process.env.GORDON_MODEL_AB_PATH ?? join(GORDON_DIR, "model-ab-routing.jsonl");
}

function isDisabled(): boolean {
  return process.env.GORDON_MODEL_AB_DISABLED === "1";
}

/**
 * Append an acceptance outcome to the ledger. The caller decides what
 * "accepted" means in context (plan approved, tool call confirmed,
 * etc.) — this module just records what's passed.
 */
export function recordOutcome(
  testId: string,
  variantId: string,
  invocationId: string,
  outcome: AcceptanceOutcome,
  options: RecordOptions = {},
): void {
  if (isDisabled()) return;
  try {
    const record: AcceptanceRecord = {
      timestamp: new Date().toISOString(),
      testId,
      variantId,
      invocationId,
      outcome,
    };
    const filePath = options.path ?? defaultAbLedgerPath();
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(filePath, JSON.stringify(record) + "\n");
  } catch {
    // swallow — tracking must not fail the call
  }
}

/**
 * Read all records for a test. Skips malformed JSONL lines silently.
 */
export function readAbTestRecords(
  testId: string,
  options: ReadOptions = {},
): AcceptanceRecord[] {
  const filePath = options.path ?? defaultAbLedgerPath();
  if (!existsSync(filePath)) return [];
  try {
    const raw = readFileSync(filePath, "utf-8");
    const records: AcceptanceRecord[] = [];
    const sinceMs = options.sinceIso ? Date.parse(options.sinceIso) : null;
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as AcceptanceRecord;
        if (parsed.testId !== testId) continue;
        if (!parsed.variantId || !parsed.timestamp) continue;
        if (sinceMs !== null) {
          const ts = Date.parse(parsed.timestamp);
          if (!Number.isFinite(ts) || ts < sinceMs) continue;
        }
        records.push(parsed);
      } catch {
        // skip malformed line
      }
    }
    return records;
  } catch {
    return [];
  }
}

/**
 * Aggregate per-variant statistics for a test. Reports each variant's
 * acceptance rate + Wilson CI + a winner determination (non-overlapping
 * CIs).
 */
export function getAbTestStats(
  testId: string,
  options: ReadOptions = {},
): AbTestStats {
  const records = readAbTestRecords(testId, options);
  const byVariant = new Map<string, { total: number; accepted: number }>();

  for (const record of records) {
    let stats = byVariant.get(record.variantId);
    if (!stats) {
      stats = { total: 0, accepted: 0 };
      byVariant.set(record.variantId, stats);
    }
    stats.total += 1;
    if (record.outcome.accepted) stats.accepted += 1;
  }

  const variants: VariantStats[] = Array.from(byVariant.entries())
    .map(([variantId, { total, accepted }]) => ({
      variantId,
      totalInvocations: total,
      acceptedCount: accepted,
      acceptanceRate: total === 0 ? 0 : accepted / total,
      acceptanceCi95: wilsonInterval(accepted, total),
    }))
    .sort((a, b) => b.acceptanceRate - a.acceptanceRate);

  let significantWinner: string | null = null;
  if (variants.length >= 2) {
    // Sort already places highest-acceptance variant first. A clear
    // winner means variants[0]'s CI lower bound > variants[1]'s CI
    // upper bound (no overlap at 95% confidence).
    const top = variants[0]!;
    const next = variants[1]!;
    if (top.acceptanceCi95.lower > next.acceptanceCi95.upper && top.totalInvocations >= 10) {
      significantWinner = top.variantId;
    }
  }

  const summary =
    records.length === 0
      ? `${testId}: no records yet`
      : `${testId}: ${records.length} records across ${variants.length} variants. ` +
        variants
          .map((v) => `${v.variantId} ${(v.acceptanceRate * 100).toFixed(1)}% (n=${v.totalInvocations})`)
          .join(", ") +
        (significantWinner ? ` → winner: ${significantWinner}` : ` → no significant winner yet`);

  return {
    testId,
    totalRecords: records.length,
    variants,
    significantWinner,
    summary,
  };
}
