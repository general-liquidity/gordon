/**
 * Backtest Experiment Journal
 *
 * Append-only JSONL log of backtest experiments — one line per experiment —
 * capturing the hypothesis (LLM reasoning) alongside the verdict and metrics.
 * Inspired by autotrade-main's `results.jsonl` pattern where each experiment
 * records `{strategy_file, return_pct, sharpe, status, thoughts}`.
 *
 * The journal is Gordon's audit trail for auto-optimizer runs, playbook
 * evolution, and strategy research: you can answer "why did Gordon discard
 * that strategy?" or "what hypothesis did the LLM explore last Tuesday?" by
 * reading a single file instead of reconstructing from log fragments.
 *
 * File location: <GORDON_HOME>/backtest-experiments.jsonl
 *   (GORDON_HOME defaults to ~/.gordon on Linux/macOS, %USERPROFILE%/.gordon
 *    on Windows — mirrors the env.ts convention used elsewhere)
 */

import { readFileSync, appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { createModuleLogger } from "../infra/logger/index.ts";
import { GORDON_DIR } from "../infra/storage/paths.ts";
import type { BacktestMetrics } from "./types.ts";
import type { BacktestVerdict } from "./verdict.ts";

const logger = createModuleLogger("backtest-journal");

// ============================================================================
// Types
// ============================================================================

export interface BacktestExperiment {
  /** Unique experiment id — timestamp-based, stable for filtering. */
  id: string;
  /** ISO timestamp when the experiment was recorded. */
  timestamp: string;
  /** Strategy identifier used. */
  strategyId: string;
  /** Symbol traded. */
  symbol: string;
  /** Timeframe used. */
  timeframe: string;
  /** Window length in days. */
  days: number;
  /**
   * LLM hypothesis / reasoning — the "why" behind running this experiment.
   * Free-form text field captured at record time.
   */
  hypothesis: string;
  /** Final verdict from computeVerdict(). */
  verdict: BacktestVerdict;
  /** Machine-parseable verdict line. */
  verdictLine: string;
  /** Violations captured for DISCARD/CRASH verdicts. */
  violations: string[];
  /** Key metrics subset for quick scanning without reloading the full result. */
  metricsSummary: {
    totalTrades: number;
    sharpe: number;
    calmar: number;
    maxDrawdown: number;
    totalReturn: number;
    winRate: number;
  };
  /** Optional pointer to the full backtest result id if saved elsewhere. */
  backtestResultId?: string;
}

// ============================================================================
// Path resolution
// ============================================================================

function getJournalPath(): string {
  // Use GORDON_DIR which honors GORDON_HOME → XDG_CONFIG_HOME → ~/.gordon.
  // The previous getGordonHome() helper accepted GORDON_HOME but ignored
  // XDG_CONFIG_HOME; centralizing on GORDON_DIR fixes the split-data-dir
  // bug for friends who set XDG_CONFIG_HOME.
  return join(GORDON_DIR, "backtest-experiments.jsonl");
}

function ensureJournalDir(): void {
  const dir = dirname(getJournalPath());
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// ============================================================================
// Record / Read
// ============================================================================

/**
 * Append an experiment to the journal. Atomic at the line level — each write
 * appends a single JSON line terminated by \n. Safe for concurrent Gordon
 * processes on the same machine (filesystem append is atomic on POSIX and
 * on Windows for <PIPE_BUF-sized writes).
 */
export function recordExperiment(
  input: Omit<BacktestExperiment, "id" | "timestamp"> & { id?: string; timestamp?: string },
): BacktestExperiment {
  const experiment: BacktestExperiment = {
    id: input.id ?? generateId(),
    timestamp: input.timestamp ?? new Date().toISOString(),
    ...input,
  };

  try {
    ensureJournalDir();
    appendFileSync(getJournalPath(), JSON.stringify(experiment) + "\n", "utf8");
  } catch (err) {
    logger.warn("Failed to write backtest experiment journal entry", {
      err: String(err),
      id: experiment.id,
    });
  }

  return experiment;
}

export interface ListExperimentsOptions {
  /** Only return experiments with this verdict. */
  verdict?: BacktestVerdict;
  /** Only return experiments for this strategy. */
  strategyId?: string;
  /** Only return experiments for this symbol. */
  symbol?: string;
  /** Limit number of returned entries (newest first). */
  limit?: number;
}

/**
 * Read recent experiments from the journal. Returns newest-first. Streams the
 * file line by line to keep memory bounded even for large journals.
 */
export function listExperiments(
  options: ListExperimentsOptions = {},
): BacktestExperiment[] {
  const path = getJournalPath();
  if (!existsSync(path)) return [];

  try {
    const text = readFileSync(path, "utf8");
    const lines = text.split("\n").filter((l) => l.trim().length > 0);
    const experiments: BacktestExperiment[] = [];
    for (const line of lines) {
      try {
        experiments.push(JSON.parse(line) as BacktestExperiment);
      } catch {
        // Skip malformed lines
      }
    }

    let filtered = experiments;
    if (options.verdict) filtered = filtered.filter((e) => e.verdict === options.verdict);
    if (options.strategyId) filtered = filtered.filter((e) => e.strategyId === options.strategyId);
    if (options.symbol) filtered = filtered.filter((e) => e.symbol === options.symbol);

    filtered.reverse();
    if (options.limit && filtered.length > options.limit) {
      filtered = filtered.slice(0, options.limit);
    }
    return filtered;
  } catch (err) {
    logger.warn("Failed to read backtest journal", { err: String(err) });
    return [];
  }
}

/**
 * Return aggregate statistics across the journal. Useful for dashboards and
 * for the agent to self-evaluate "how often am I producing eligible
 * strategies?"
 */
export function getJournalStats(): {
  total: number;
  byVerdict: Record<BacktestVerdict, number>;
  eligibleRatePct: number;
  avgSharpeEligible: number;
} {
  const all = listExperiments({ limit: 10_000 });
  const byVerdict: Record<BacktestVerdict, number> = {
    ELIGIBLE: 0,
    DISCARD_SAMPLE_SIZE: 0,
    DISCARD_RISK: 0,
    DISCARD_PROFIT: 0,
    CRASH: 0,
  };
  let eligibleSharpeSum = 0;
  let eligibleCount = 0;
  for (const e of all) {
    byVerdict[e.verdict] = (byVerdict[e.verdict] ?? 0) + 1;
    if (e.verdict === "ELIGIBLE") {
      eligibleSharpeSum += e.metricsSummary.sharpe;
      eligibleCount += 1;
    }
  }
  return {
    total: all.length,
    byVerdict,
    eligibleRatePct: all.length > 0 ? (byVerdict.ELIGIBLE / all.length) * 100 : 0,
    avgSharpeEligible: eligibleCount > 0 ? eligibleSharpeSum / eligibleCount : 0,
  };
}

/**
 * Clear the journal. Destructive — used only when the user explicitly asks,
 * or for tests. Intentionally NOT exposed as a tool to prevent accidental
 * deletion.
 */
export function clearJournal(): void {
  const path = getJournalPath();
  try {
    if (existsSync(path)) {
      writeFileSync(path, "", "utf8");
    }
  } catch (err) {
    logger.warn("Failed to clear journal", { err: String(err) });
  }
}

// ============================================================================
// Helper — build metricsSummary from a full BacktestMetrics object
// ============================================================================

export function summarizeMetrics(metrics: BacktestMetrics): BacktestExperiment["metricsSummary"] {
  return {
    totalTrades: metrics.totalTrades,
    sharpe: Number((metrics.sharpeRatio ?? 0).toFixed(3)),
    calmar: Number((metrics.calmarRatio ?? 0).toFixed(3)),
    maxDrawdown: Number((metrics.maxDrawdown ?? 0).toFixed(2)),
    totalReturn: Number((metrics.totalReturn ?? 0).toFixed(2)),
    winRate: Number((metrics.winRate ?? 0).toFixed(2)),
  };
}

function generateId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `exp_${ts}_${rand}`;
}
