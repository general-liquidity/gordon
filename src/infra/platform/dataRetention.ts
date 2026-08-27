/**
 * Data Retention Policy
 *
 * Per-data-type TTLs with a background sweeper that runs at startup.
 * Prevents Gordon's local data files from growing forever and gives users
 * a coherent answer to "how long is my data kept?"
 *
 * Policies (override via env vars or config):
 *   telemetry events JSONL  → 90 days
 *   research data files     → 365 days
 *   audit log SQLite rows   → 7 years (regulatory horizon)
 *   logs (file transport)   → 30 days
 *   cost session files      → 90 days
 *   calibration journal     → forever (intentionally unbounded —
 *                              decision history loses meaning when pruned)
 *   experiment journal      → forever (same reason)
 *
 * The sweeper is best-effort: failures are logged but never crash the app.
 * It runs once on startup; users can re-run via `/telemetry retention-sweep`.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { GORDON_DIR } from "../storage/paths.ts";
import { createModuleLogger } from "../logger/index.ts";

const logger = createModuleLogger("retention");

// ============================================================================
// Policy
// ============================================================================

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RetentionPolicy {
  telemetryEventsDays: number;
  researchDataDays: number;
  auditLogDays: number;
  logsDays: number;
  costSessionsDays: number;
}

export const DEFAULT_RETENTION_POLICY: RetentionPolicy = {
  telemetryEventsDays: 90,
  researchDataDays: 365,
  auditLogDays: 7 * 365, // 7 years
  logsDays: 30,
  costSessionsDays: 90,
};

function loadPolicyFromEnv(): RetentionPolicy {
  const overrideNumber = (key: string, fallback: number): number => {
    const raw = process.env[key];
    if (!raw) return fallback;
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };
  return {
    telemetryEventsDays: overrideNumber(
      "GORDON_RETENTION_TELEMETRY_DAYS",
      DEFAULT_RETENTION_POLICY.telemetryEventsDays,
    ),
    researchDataDays: overrideNumber(
      "GORDON_RETENTION_RESEARCH_DAYS",
      DEFAULT_RETENTION_POLICY.researchDataDays,
    ),
    auditLogDays: overrideNumber(
      "GORDON_RETENTION_AUDIT_DAYS",
      DEFAULT_RETENTION_POLICY.auditLogDays,
    ),
    logsDays: overrideNumber("GORDON_RETENTION_LOGS_DAYS", DEFAULT_RETENTION_POLICY.logsDays),
    costSessionsDays: overrideNumber(
      "GORDON_RETENTION_COST_DAYS",
      DEFAULT_RETENTION_POLICY.costSessionsDays,
    ),
  };
}

// ============================================================================
// Sweeper
// ============================================================================

export interface RetentionSweepResult {
  startedAt: string;
  durationMs: number;
  filesDeleted: number;
  rowsDeleted: number;
  bytesReclaimed: number;
  errors: Array<{ where: string; message: string }>;
}

/**
 * Sweep all data stores for entries past their TTL. Best-effort — never throws.
 */
export async function sweepRetention(
  policyOverride?: Partial<RetentionPolicy>,
): Promise<RetentionSweepResult> {
  const start = Date.now();
  const policy = { ...loadPolicyFromEnv(), ...policyOverride };
  const result: RetentionSweepResult = {
    startedAt: new Date(start).toISOString(),
    durationMs: 0,
    filesDeleted: 0,
    rowsDeleted: 0,
    bytesReclaimed: 0,
    errors: [],
  };

  const sweeps: Array<{ name: string; fn: () => Promise<void> | void }> = [
    {
      name: "research-jsonl",
      fn: () => sweepJsonlDir(path.join(GORDON_DIR, "research"), policy.researchDataDays, result),
    },
    {
      name: "telemetry-jsonl",
      fn: () =>
        sweepJsonlDir(path.join(GORDON_DIR, "telemetry"), policy.telemetryEventsDays, result),
    },
    {
      name: "logs",
      fn: () => sweepLogsDir(path.join(GORDON_DIR, "logs"), policy.logsDays, result),
    },
    {
      name: "cost-sessions",
      fn: () =>
        sweepCostSessions(path.join(GORDON_DIR, "sessions"), policy.costSessionsDays, result),
    },
    { name: "audit-log", fn: () => sweepAuditLog(policy.auditLogDays, result) },
  ];

  for (const sweep of sweeps) {
    try {
      await Promise.resolve(sweep.fn());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push({ where: sweep.name, message });
      logger.warn("Retention sweep step failed", { step: sweep.name, error: message });
    }
  }

  result.durationMs = Date.now() - start;
  if (result.filesDeleted > 0 || result.rowsDeleted > 0) {
    logger.info("Retention sweep complete", {
      filesDeleted: result.filesDeleted,
      rowsDeleted: result.rowsDeleted,
      bytesReclaimed: result.bytesReclaimed,
      durationMs: result.durationMs,
    });
  }
  return result;
}

function sweepJsonlDir(dir: string, ttlDays: number, result: RetentionSweepResult): void {
  if (!fs.existsSync(dir)) return;
  const cutoff = Date.now() - ttlDays * DAY_MS;
  const entries = fs.readdirSync(dir);
  for (const name of entries) {
    if (!name.endsWith(".jsonl") && !name.endsWith(".json")) continue;
    const filePath = path.join(dir, name);
    try {
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs < cutoff) {
        result.bytesReclaimed += stat.size;
        fs.unlinkSync(filePath);
        result.filesDeleted++;
      }
    } catch {
      // Single-file failures shouldn't block the rest
    }
  }
}

function sweepLogsDir(dir: string, ttlDays: number, result: RetentionSweepResult): void {
  if (!fs.existsSync(dir)) return;
  const cutoff = Date.now() - ttlDays * DAY_MS;
  const entries = fs.readdirSync(dir);
  for (const name of entries) {
    const filePath = path.join(dir, name);
    try {
      const stat = fs.statSync(filePath);
      if (stat.isFile() && stat.mtimeMs < cutoff) {
        result.bytesReclaimed += stat.size;
        fs.unlinkSync(filePath);
        result.filesDeleted++;
      }
    } catch {
      // Skip
    }
  }
}

function sweepCostSessions(dir: string, ttlDays: number, result: RetentionSweepResult): void {
  if (!fs.existsSync(dir)) return;
  const cutoff = Date.now() - ttlDays * DAY_MS;
  const entries = fs.readdirSync(dir);
  for (const name of entries) {
    if (!name.endsWith(".cost.json")) continue;
    const filePath = path.join(dir, name);
    try {
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs < cutoff) {
        result.bytesReclaimed += stat.size;
        fs.unlinkSync(filePath);
        result.filesDeleted++;
      }
    } catch {
      // Skip
    }
  }
}

function sweepAuditLog(ttlDays: number, result: RetentionSweepResult): void {
  // Lazy import — keeps dataRetention free of SQLite deps when no audit DB exists
  let getDatabase: (() => unknown) | null = null;
  try {
    getDatabase = require("../storage/database.ts").getDatabase;
  } catch {
    return; // SQLite not available — skip silently
  }
  if (!getDatabase) return;

  const cutoffIso = new Date(Date.now() - ttlDays * DAY_MS).toISOString();
  try {
    const db = getDatabase() as { run: (sql: string, params?: unknown[]) => { changes: number } };
    const out = db.run("DELETE FROM audit_log WHERE timestamp < ?", [cutoffIso]);
    if (out && typeof out.changes === "number") result.rowsDeleted += out.changes;
  } catch (err) {
    throw new Error(`audit-log delete failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ============================================================================
// Public API
// ============================================================================

let lastSweep: RetentionSweepResult | null = null;

/**
 * Run the sweeper at most once per process start. Subsequent calls return the
 * cached result. Use this from index.tsx / startup hooks.
 */
export async function sweepRetentionOnStartup(): Promise<RetentionSweepResult> {
  if (lastSweep) return lastSweep;
  lastSweep = await sweepRetention();
  return lastSweep;
}

export function getLastSweepResult(): RetentionSweepResult | null {
  return lastSweep;
}

export function describeRetentionPolicy(): string {
  const policy = loadPolicyFromEnv();
  return [
    `telemetry events:  ${policy.telemetryEventsDays}d`,
    `research data:     ${policy.researchDataDays}d`,
    `audit log:         ${policy.auditLogDays}d (${(policy.auditLogDays / 365).toFixed(1)}y)`,
    `logs:              ${policy.logsDays}d`,
    `cost sessions:     ${policy.costSessionsDays}d`,
    `calibration:       forever (intentionally unbounded)`,
    `experiments:       forever (intentionally unbounded)`,
  ].join("\n");
}
