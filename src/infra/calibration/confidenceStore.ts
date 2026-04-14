/**
 * Confidence Calibration Store
 *
 * Inspired by CloddsBot's trade ledger pattern: every decision the agent
 * makes with a stated confidence gets recorded, and outcomes are tracked
 * back against those confidence scores. Over time you can answer "when
 * Gordon says it's 80% confident, how often is it actually right?" — the
 * classic calibration curve.
 *
 * This is a parallel system to Gordon's existing audit and trade journal.
 * Tools opt in by calling `recordDecision()` with a confidence value at
 * decision time and `recordOutcome()` later when the result is known.
 * Independent decisions (proactive suggestions, strategy picks, entry
 * calls, verdict screenings) are all calibratable.
 *
 * Persistence: JSONL at ~/.gordon/calibration.jsonl, append-only, line-
 * buffered writes. Outcomes are matched to decisions by decisionId.
 */

import { readFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { createModuleLogger } from "../logger/index.ts";
import { GORDON_DIR } from "../storage/paths.ts";

const logger = createModuleLogger("calibration");

// ============================================================================
// Types
// ============================================================================

export type ConfidenceBucket = "0-10" | "10-20" | "20-30" | "30-40" | "40-50" | "50-60" | "60-70" | "70-80" | "80-90" | "90-100";

export type DecisionDomain =
  | "proactive_suggestion"
  | "strategy_pick"
  | "entry_call"
  | "exit_call"
  | "verdict_screen"
  | "risk_assessment"
  | "regime_classification"
  | "custom";

export type OutcomeResult = "correct" | "wrong" | "partial" | "unknown";

export interface CalibrationDecision {
  /** Unique id for this decision. Used to match outcomes. */
  decisionId: string;
  domain: DecisionDomain;
  /** 0..1 confidence stated at decision time. */
  confidence: number;
  /** Human-readable description of what was decided. */
  decision: string;
  /** Optional: the reasoning the agent used. */
  reasoning?: string;
  /** Context tags for grouping (symbol, category, timeframe, etc.). */
  tags?: Record<string, string>;
  createdAt: string;
}

export interface CalibrationOutcome {
  decisionId: string;
  result: OutcomeResult;
  /** Short description of what actually happened. */
  notes?: string;
  /** Optional P&L impact if this was a trade-adjacent decision. */
  pnl?: number;
  recordedAt: string;
}

/** Paired record joining a decision with its outcome (if any). */
export interface CalibrationRecord extends CalibrationDecision {
  outcome?: CalibrationOutcome;
}

export interface CalibrationStats {
  totalDecisions: number;
  totalWithOutcomes: number;
  overallAccuracy: number;
  bucketStats: Record<ConfidenceBucket, { count: number; correct: number; accuracy: number }>;
  byDomain: Record<string, { count: number; correct: number; accuracy: number; avgConfidence: number }>;
  calibrationError: number;
}

// ============================================================================
// Path helpers
// ============================================================================

function getCalibrationPath(): string {
  // Use GORDON_DIR which honors GORDON_HOME → XDG_CONFIG_HOME → ~/.gordon
  return join(GORDON_DIR, "calibration.jsonl");
}

function ensureDir(): void {
  const dir = dirname(getCalibrationPath());
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// ============================================================================
// Bucketing
// ============================================================================

function toBucket(confidence: number): ConfidenceBucket {
  const c = Math.max(0, Math.min(1, confidence)) * 100;
  if (c < 10) return "0-10";
  if (c < 20) return "10-20";
  if (c < 30) return "20-30";
  if (c < 40) return "30-40";
  if (c < 50) return "40-50";
  if (c < 60) return "50-60";
  if (c < 70) return "60-70";
  if (c < 80) return "70-80";
  if (c < 90) return "80-90";
  return "90-100";
}

function bucketMidpoint(bucket: ConfidenceBucket): number {
  switch (bucket) {
    case "0-10": return 0.05;
    case "10-20": return 0.15;
    case "20-30": return 0.25;
    case "30-40": return 0.35;
    case "40-50": return 0.45;
    case "50-60": return 0.55;
    case "60-70": return 0.65;
    case "70-80": return 0.75;
    case "80-90": return 0.85;
    case "90-100": return 0.95;
  }
}

// ============================================================================
// Write + read
// ============================================================================

interface JournalEntry {
  type: "decision" | "outcome";
  at: string;
  decision?: CalibrationDecision;
  outcome?: CalibrationOutcome;
}

/**
 * Record a decision at decision time. The decisionId must be unique —
 * caller generates it (e.g. timestamp + random suffix, or reuse an
 * existing domain id like proactive suggestion id).
 */
export function recordDecision(decision: Omit<CalibrationDecision, "createdAt">): CalibrationDecision {
  const full: CalibrationDecision = {
    ...decision,
    confidence: Math.max(0, Math.min(1, decision.confidence)),
    createdAt: new Date().toISOString(),
  };
  try {
    ensureDir();
    const entry: JournalEntry = { type: "decision", at: full.createdAt, decision: full };
    appendFileSync(getCalibrationPath(), JSON.stringify(entry) + "\n", "utf8");
  } catch (err) {
    logger.warn("Failed to record calibration decision", { err: String(err) });
  }
  return full;
}

/**
 * Record an outcome for a previously recorded decision. If the decision
 * doesn't exist, the outcome is still written (so backfilled outcomes
 * work) — the stats pass will correlate on read.
 */
export function recordOutcome(outcome: Omit<CalibrationOutcome, "recordedAt">): CalibrationOutcome {
  const full: CalibrationOutcome = {
    ...outcome,
    recordedAt: new Date().toISOString(),
  };
  try {
    ensureDir();
    const entry: JournalEntry = { type: "outcome", at: full.recordedAt, outcome: full };
    appendFileSync(getCalibrationPath(), JSON.stringify(entry) + "\n", "utf8");
  } catch (err) {
    logger.warn("Failed to record calibration outcome", { err: String(err) });
  }
  return full;
}

/** Read all records from the journal, pairing decisions with their outcomes. */
export function readCalibrationRecords(): CalibrationRecord[] {
  const path = getCalibrationPath();
  if (!existsSync(path)) return [];
  try {
    const text = readFileSync(path, "utf8");
    const lines = text.split("\n").filter((l) => l.trim().length > 0);

    const decisionsById = new Map<string, CalibrationDecision>();
    const outcomesById = new Map<string, CalibrationOutcome>();

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as JournalEntry;
        if (entry.type === "decision" && entry.decision) {
          decisionsById.set(entry.decision.decisionId, entry.decision);
        } else if (entry.type === "outcome" && entry.outcome) {
          outcomesById.set(entry.outcome.decisionId, entry.outcome);
        }
      } catch {
        // Skip malformed lines
      }
    }

    const records: CalibrationRecord[] = [];
    for (const [id, decision] of decisionsById.entries()) {
      records.push({ ...decision, outcome: outcomesById.get(id) });
    }
    return records;
  } catch (err) {
    logger.warn("Failed to read calibration records", { err: String(err) });
    return [];
  }
}

// ============================================================================
// Stats
// ============================================================================

export function computeCalibrationStats(
  records?: CalibrationRecord[],
  options: { domain?: DecisionDomain; sinceMs?: number } = {},
): CalibrationStats {
  const all = records ?? readCalibrationRecords();
  const cutoff = options.sinceMs ? Date.now() - options.sinceMs : 0;
  const filtered = all.filter((r) => {
    if (options.domain && r.domain !== options.domain) return false;
    if (cutoff && new Date(r.createdAt).getTime() < cutoff) return false;
    return true;
  });

  const totalDecisions = filtered.length;
  const withOutcomes = filtered.filter((r) => r.outcome && r.outcome.result !== "unknown");
  const totalWithOutcomes = withOutcomes.length;

  const bucketStats: Record<ConfidenceBucket, { count: number; correct: number; accuracy: number }> = {
    "0-10": { count: 0, correct: 0, accuracy: 0 },
    "10-20": { count: 0, correct: 0, accuracy: 0 },
    "20-30": { count: 0, correct: 0, accuracy: 0 },
    "30-40": { count: 0, correct: 0, accuracy: 0 },
    "40-50": { count: 0, correct: 0, accuracy: 0 },
    "50-60": { count: 0, correct: 0, accuracy: 0 },
    "60-70": { count: 0, correct: 0, accuracy: 0 },
    "70-80": { count: 0, correct: 0, accuracy: 0 },
    "80-90": { count: 0, correct: 0, accuracy: 0 },
    "90-100": { count: 0, correct: 0, accuracy: 0 },
  };

  const domainStats: Record<string, { count: number; correct: number; accuracy: number; avgConfidence: number; confidenceSum: number }> = {};

  let calibrationErrorSum = 0;
  let totalCorrect = 0;

  for (const r of withOutcomes) {
    const bucket = toBucket(r.confidence);
    bucketStats[bucket].count += 1;
    const correct = r.outcome!.result === "correct" ? 1 : r.outcome!.result === "partial" ? 0.5 : 0;
    bucketStats[bucket].correct += correct;
    totalCorrect += correct;

    if (!domainStats[r.domain]) {
      domainStats[r.domain] = { count: 0, correct: 0, accuracy: 0, avgConfidence: 0, confidenceSum: 0 };
    }
    const ds = domainStats[r.domain]!;
    ds.count += 1;
    ds.correct += correct;
    ds.confidenceSum += r.confidence;
  }

  for (const bucket of Object.keys(bucketStats) as ConfidenceBucket[]) {
    const b = bucketStats[bucket];
    b.accuracy = b.count > 0 ? Number((b.correct / b.count).toFixed(3)) : 0;
    if (b.count > 0) {
      const midpoint = bucketMidpoint(bucket);
      calibrationErrorSum += Math.abs(midpoint - b.accuracy) * b.count;
    }
  }

  const byDomain: Record<string, { count: number; correct: number; accuracy: number; avgConfidence: number }> = {};
  for (const [domain, ds] of Object.entries(domainStats)) {
    byDomain[domain] = {
      count: ds.count,
      correct: Number(ds.correct.toFixed(1)),
      accuracy: Number((ds.correct / ds.count).toFixed(3)),
      avgConfidence: Number((ds.confidenceSum / ds.count).toFixed(3)),
    };
  }

  const calibrationError = totalWithOutcomes > 0
    ? Number((calibrationErrorSum / totalWithOutcomes).toFixed(3))
    : 0;
  const overallAccuracy = totalWithOutcomes > 0
    ? Number((totalCorrect / totalWithOutcomes).toFixed(3))
    : 0;

  return {
    totalDecisions,
    totalWithOutcomes,
    overallAccuracy,
    bucketStats,
    byDomain,
    calibrationError,
  };
}

/**
 * Generate a unique decision id. Callers can use this or supply their own
 * existing id (e.g. proactive suggestion id, trade id).
 */
export function generateDecisionId(prefix = "dec"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
