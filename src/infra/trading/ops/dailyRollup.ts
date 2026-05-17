/**
 * Daily Rollup (GORDON_DAILY_ROLLUP).
 *
 * Port of the 12-12 framework Wright credits to Brent Donnelly (Ch 2).
 * Twelve hours back, twelve hours forward — the operator runs a brief
 * post-mortem on yesterday's session and then writes today's plan.
 *
 * Gordon already has the forward half via WW5 dailyDecisionJournal.
 * This module is the BACKWARD half: aggregates the last N hours of
 * decisionLog + debriefMatrix + frictionTracker entries into a single
 * "what to repeat / what to fix" summary that fires at session_start.
 *
 *   - Wins from deserved_success quadrant → reinforce
 *   - Losses from dumb_luck quadrant → toxic alpha to extinguish
 *   - Friction trend → executor or process issue
 *   - Repeated rule violations → guardrail candidate
 *
 * Pure compute over JSONL — caller provides the file paths or relies
 * on the defaults from the source modules.
 */

import { existsSync, readFileSync } from "node:fs";

export const DAILY_ROLLUP_FLAG_ENV = "GORDON_DAILY_ROLLUP";

export function isDailyRollupEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[DAILY_ROLLUP_FLAG_ENV] === "1" || env[DAILY_ROLLUP_FLAG_ENV] === "true";
}

export interface DailyRollupInput {
  /** Path to decisionLog JSONL. */
  decisionsPath?: string;
  /** Path to debriefMatrix JSONL. */
  debriefsPath?: string;
  /** Path to frictionTracker JSONL. */
  frictionPath?: string;
  /** Lookback window in hours. Default 24. */
  windowHours?: number;
  /** Override "now" for tests/replay. */
  nowMs?: number;
}

export interface RollupSummary {
  windowStartIso: string;
  windowEndIso: string;
  decisionCount: number;
  debriefCounts: {
    deserved_success: number;
    bad_luck: number;
    dumb_luck: number;
    poetic_justice: number;
  };
  frictionUsdTotal: number;
  reinforcements: string[];
  fixes: string[];
  toxicAlphaWarning: boolean;
}

interface JsonLineReader {
  exists: boolean;
  rows: ReadonlyArray<Record<string, unknown>>;
}

function readWindow(
  path: string | undefined,
  startMs: number,
  endMs: number,
  timestampField: string,
): JsonLineReader {
  if (!path || !existsSync(path)) return { exists: false, rows: [] };
  const raw = readFileSync(path, "utf8");
  const rows: Record<string, unknown>[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as Record<string, unknown>;
      const ts = row[timestampField];
      if (typeof ts === "string") {
        const t = Date.parse(ts);
        if (Number.isFinite(t) && t >= startMs && t <= endMs) rows.push(row);
      }
    } catch {
      /* skip */
    }
  }
  return { exists: true, rows };
}

const DEFAULT_WINDOW_HOURS = 24;

export function buildRollup(input: DailyRollupInput): RollupSummary {
  const windowHours = input.windowHours ?? DEFAULT_WINDOW_HOURS;
  const nowMs = input.nowMs ?? Date.now();
  const startMs = nowMs - windowHours * 60 * 60_000;

  const decisions = readWindow(input.decisionsPath, startMs, nowMs, "recordedAt");
  const debriefs = readWindow(input.debriefsPath, startMs, nowMs, "recordedAt");
  const friction = readWindow(input.frictionPath, startMs, nowMs, "recordedAt");

  const debriefCounts = {
    deserved_success: 0,
    bad_luck: 0,
    dumb_luck: 0,
    poetic_justice: 0,
  };
  const reinforcements: string[] = [];
  const fixes: string[] = [];
  for (const row of debriefs.rows) {
    const q = row.quadrant as keyof typeof debriefCounts | undefined;
    if (q && q in debriefCounts) {
      debriefCounts[q]++;
      const symbol = (row.symbol as string | undefined) ?? "unknown";
      const tradeId = (row.tradeId as string | undefined) ?? "unknown";
      if (q === "deserved_success") reinforcements.push(`Repeat ${symbol} setup (${tradeId})`);
      if (q === "poetic_justice") fixes.push(`${symbol} ${tradeId}: bad process + bad outcome — root-cause`);
      if (q === "dumb_luck") fixes.push(`${symbol} ${tradeId}: rule-breaker that paid out — extinguish behavior`);
    }
  }

  let frictionUsd = 0;
  for (const row of friction.rows) {
    const cost = row.costUsd;
    if (typeof cost === "number") frictionUsd += cost;
  }

  const wins = debriefCounts.deserved_success + debriefCounts.dumb_luck;
  const toxicAlphaWarning = wins > 0 && debriefCounts.dumb_luck / wins > 0.2;

  return {
    windowStartIso: new Date(startMs).toISOString(),
    windowEndIso: new Date(nowMs).toISOString(),
    decisionCount: decisions.rows.length,
    debriefCounts,
    frictionUsdTotal: frictionUsd,
    reinforcements,
    fixes,
    toxicAlphaWarning,
  };
}

export function formatRollup(summary: RollupSummary): string {
  const lines: string[] = [];
  lines.push(`Daily rollup ${summary.windowStartIso.slice(0, 10)} → ${summary.windowEndIso.slice(0, 10)}`);
  lines.push(
    `  Decisions ${summary.decisionCount} | Friction $${summary.frictionUsdTotal.toFixed(2)}`,
  );
  lines.push(
    `  Debriefs: deserved=${summary.debriefCounts.deserved_success} bad_luck=${summary.debriefCounts.bad_luck} dumb_luck=${summary.debriefCounts.dumb_luck} poetic=${summary.debriefCounts.poetic_justice}`,
  );
  if (summary.toxicAlphaWarning) lines.push("  ⚠ Toxic-alpha alarm: dumb-luck wins > 20% of total wins");
  if (summary.reinforcements.length > 0) {
    lines.push("  Reinforce:");
    for (const r of summary.reinforcements.slice(0, 5)) lines.push(`    - ${r}`);
  }
  if (summary.fixes.length > 0) {
    lines.push("  Fix:");
    for (const f of summary.fixes.slice(0, 5)) lines.push(`    - ${f}`);
  }
  return lines.join("\n");
}

export function rollupToPayload(summary: RollupSummary): Record<string, unknown> {
  return {
    kind: "daily_rollup.summarized",
    decisionCount: summary.decisionCount,
    debriefCounts: summary.debriefCounts,
    frictionUsdTotal: Number(summary.frictionUsdTotal.toFixed(2)),
    toxicAlphaWarning: summary.toxicAlphaWarning,
    reinforcementCount: summary.reinforcements.length,
    fixCount: summary.fixes.length,
  };
}
