/**
 * Backtest run snapshots — durable record of every backtest invocation
 * so re-runs can be audited for data + strategy drift.
 *
 * Pattern adapted from ArcticDB's versioned-write model (Man Group, BSL).
 * Gordon's variant is narrower: the implementation-module backtest path
 * fetches its own candles, so we cannot guarantee identical-inputs replay
 * without restructuring that fetch layer. What we CAN guarantee:
 *
 *   - Every run gets a hash of (strategy, symbol, timeframe, window,
 *     params). Re-running with replayRunId pins those inputs and
 *     compares the new result against the stored result. Divergence
 *     surfaces both data restatement (venue corrections) and strategy
 *     code regressions (refactors that silently change behavior).
 *
 *   - The stored result is the canonical record of what a given input
 *     produced at recordedAt. Reviewing old plans, eval-harness
 *     comparisons, and "is this drift real?" investigations all key
 *     off this.
 *
 * Storage: same gordon.db file. Pruning is manual (pruneRunsBefore).
 */

import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import { getDatabase, executeWithLogging } from "../storage/database.ts";

let tableInitialized = false;

export interface BacktestSnapshotInput {
  strategyId: string;
  symbol: string;
  timeframe: string;
  /** Bar open-time of the first candle in the run, ms epoch. */
  fromTs: number;
  /** Bar open-time of the last candle in the run, ms epoch. */
  toTs: number;
  /** Strategy params + commission + initialCapital etc — anything that
   *  affects the result. Must serialize to deterministic JSON. */
  params: Record<string, unknown>;
  /** Result returned by the backtest implementation tool. Opaque blob; the
   *  consumer is responsible for normalizing if downstream comparison
   *  is needed. */
  result: unknown;
}

export interface BacktestSnapshot extends BacktestSnapshotInput {
  runId: string;
  recordedAt: number;
  inputsHash: string;
}

function ensureTable(): void {
  if (tableInitialized) return;
  const db = getDatabase();
  executeWithLogging(
    () =>
      db.run(`
        CREATE TABLE IF NOT EXISTS backtest_runs (
          run_id       TEXT PRIMARY KEY,
          recorded_at  INTEGER NOT NULL,
          strategy_id  TEXT NOT NULL,
          symbol       TEXT NOT NULL,
          timeframe    TEXT NOT NULL,
          from_ts      INTEGER NOT NULL,
          to_ts        INTEGER NOT NULL,
          params_json  TEXT NOT NULL,
          result_json  TEXT NOT NULL,
          inputs_hash  TEXT NOT NULL
        )
      `),
    "CREATE TABLE backtest_runs",
  );
  executeWithLogging(
    () =>
      db.run(
        "CREATE INDEX IF NOT EXISTS idx_backtest_runs_inputs_hash ON backtest_runs(inputs_hash)",
      ),
    "CREATE INDEX idx_backtest_runs_inputs_hash",
  );
  executeWithLogging(
    () =>
      db.run(
        "CREATE INDEX IF NOT EXISTS idx_backtest_runs_recorded_at ON backtest_runs(recorded_at)",
      ),
    "CREATE INDEX idx_backtest_runs_recorded_at",
  );
  tableInitialized = true;
}

export function _resetBacktestSnapshotsForTests(): void {
  tableInitialized = false;
  try {
    const db = getDatabase();
    db.run("DROP TABLE IF EXISTS backtest_runs");
  } catch {
    // Table didn't exist — nothing to drop.
  }
}

/** Stable hash over the inputs that determine a backtest result.
 *  Excludes recorded_at and run_id by construction. */
export function computeInputsHash(
  strategyId: string,
  symbol: string,
  timeframe: string,
  fromTs: number,
  toTs: number,
  params: Record<string, unknown>,
): string {
  // Sort param keys for deterministic serialization. Nested objects
  // are serialized as JSON.stringify default ordering — acceptable
  // for hash purposes because identical input objects produce
  // identical JSON.
  const sortedParams: Record<string, unknown> = {};
  for (const key of Object.keys(params).sort()) sortedParams[key] = params[key];
  const payload = JSON.stringify({
    strategyId,
    symbol: symbol.toUpperCase(),
    timeframe,
    fromTs,
    toTs,
    params: sortedParams,
  });
  return createHash("sha256").update(payload).digest("hex").slice(0, 24);
}

/** Record a backtest run snapshot. Returns the new run_id. Idempotent
 *  on `inputs_hash` is INTENTIONALLY NOT done — same inputs can
 *  produce different results over time (data restatement); each run
 *  is its own audit record. */
export function recordBacktestRun(input: BacktestSnapshotInput): BacktestSnapshot {
  ensureTable();
  const runId = `bt_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const recordedAt = Date.now();
  const inputsHash = computeInputsHash(
    input.strategyId,
    input.symbol,
    input.timeframe,
    input.fromTs,
    input.toTs,
    input.params,
  );
  const db = getDatabase();
  db.run(
    "INSERT INTO backtest_runs (run_id, recorded_at, strategy_id, symbol, timeframe, from_ts, to_ts, params_json, result_json, inputs_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      runId,
      recordedAt,
      input.strategyId,
      input.symbol.toUpperCase(),
      input.timeframe,
      input.fromTs,
      input.toTs,
      JSON.stringify(input.params),
      JSON.stringify(input.result),
      inputsHash,
    ],
  );
  return {
    runId,
    recordedAt,
    inputsHash,
    ...input,
    symbol: input.symbol.toUpperCase(),
  };
}

export function getBacktestRun(runId: string): BacktestSnapshot | null {
  ensureTable();
  const db = getDatabase();
  const row = db
    .query<
      {
        run_id: string;
        recorded_at: number;
        strategy_id: string;
        symbol: string;
        timeframe: string;
        from_ts: number;
        to_ts: number;
        params_json: string;
        result_json: string;
        inputs_hash: string;
      },
      [string]
    >("SELECT * FROM backtest_runs WHERE run_id = ?")
    .get(runId);
  if (!row) return null;
  return {
    runId: row.run_id,
    recordedAt: row.recorded_at,
    strategyId: row.strategy_id,
    symbol: row.symbol,
    timeframe: row.timeframe,
    fromTs: row.from_ts,
    toTs: row.to_ts,
    params: JSON.parse(row.params_json) as Record<string, unknown>,
    result: JSON.parse(row.result_json) as unknown,
    inputsHash: row.inputs_hash,
  };
}

export interface ListBacktestRunsOptions {
  strategyId?: string;
  symbol?: string;
  /** Filter by recordedAt >= sinceMs (ms epoch). */
  sinceMs?: number;
  limit?: number;
}

export function listBacktestRuns(opts: ListBacktestRunsOptions = {}): BacktestSnapshot[] {
  ensureTable();
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (opts.strategyId) {
    where.push("strategy_id = ?");
    params.push(opts.strategyId);
  }
  if (opts.symbol) {
    where.push("symbol = ?");
    params.push(opts.symbol.toUpperCase());
  }
  if (Number.isFinite(opts.sinceMs)) {
    where.push("recorded_at >= ?");
    params.push(opts.sinceMs!);
  }
  let sql = "SELECT * FROM backtest_runs";
  if (where.length > 0) sql += ` WHERE ${where.join(" AND ")}`;
  sql += " ORDER BY recorded_at DESC";
  if (Number.isFinite(opts.limit)) {
    sql += " LIMIT ?";
    params.push(opts.limit!);
  }
  const db = getDatabase();
  const rows = db
    .query<
      {
        run_id: string;
        recorded_at: number;
        strategy_id: string;
        symbol: string;
        timeframe: string;
        from_ts: number;
        to_ts: number;
        params_json: string;
        result_json: string;
        inputs_hash: string;
      },
      Array<string | number>
    >(sql)
    .all(...params);
  return rows.map((row) => ({
    runId: row.run_id,
    recordedAt: row.recorded_at,
    strategyId: row.strategy_id,
    symbol: row.symbol,
    timeframe: row.timeframe,
    fromTs: row.from_ts,
    toTs: row.to_ts,
    params: JSON.parse(row.params_json) as Record<string, unknown>,
    result: JSON.parse(row.result_json) as unknown,
    inputsHash: row.inputs_hash,
  }));
}

/** Admin helper — drop snapshots older than thresholdMs. */
export function pruneRunsBefore(thresholdMs: number): number {
  ensureTable();
  const db = getDatabase();
  const result = db.run("DELETE FROM backtest_runs WHERE recorded_at < ?", [thresholdMs]);
  return (result as { changes?: number }).changes ?? 0;
}

/** Numeric fields worth comparing across runs of the same inputs.
 *  Anything missing/non-finite is reported as null. Caller uses these
 *  to detect drift between stored and replayed results. */
export interface ComparableMetrics {
  sharpe: number | null;
  sortino: number | null;
  maxDrawdown: number | null;
  winRate: number | null;
  totalReturn: number | null;
  tradeCount: number | null;
}

function pickNumber(obj: unknown, key: string): number | null {
  if (!obj || typeof obj !== "object") return null;
  const v = (obj as Record<string, unknown>)[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Extract a normalized metric tuple from the opaque backtest result.
 *  Tolerant of missing fields — the stored result shape varies. */
export function extractComparableMetrics(result: unknown): ComparableMetrics {
  // Most backtest implementations wrap metrics one level deep. Probe both top
  // level + .metrics / .result for compatibility.
  const candidates = [result];
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (r.metrics) candidates.push(r.metrics);
    if (r.result) candidates.push(r.result);
  }
  const findNumber = (key: string): number | null => {
    for (const c of candidates) {
      const v = pickNumber(c, key);
      if (v !== null) return v;
    }
    return null;
  };
  return {
    sharpe: findNumber("sharpe") ?? findNumber("sharpeRatio"),
    sortino: findNumber("sortino") ?? findNumber("sortinoRatio"),
    maxDrawdown: findNumber("maxDrawdown") ?? findNumber("max_drawdown"),
    winRate: findNumber("winRate") ?? findNumber("win_rate"),
    totalReturn: findNumber("totalReturn") ?? findNumber("total_return"),
    tradeCount: findNumber("tradeCount") ?? findNumber("trades") ?? findNumber("numTrades"),
  };
}

export interface DriftReport {
  hasDrift: boolean;
  /** Per-metric absolute delta. Null when either side is missing. */
  deltas: Partial<Record<keyof ComparableMetrics, number | null>>;
  /** Stored vs current metric tuples, surfaced for the operator. */
  stored: ComparableMetrics;
  current: ComparableMetrics;
  /** One-line summary. */
  interpretation: string;
}

/** Compare a stored result against a freshly-computed one. Default
 *  tolerance is 1e-4 absolute on each numeric metric — tight enough to
 *  catch a logic regression, loose enough to absorb fp noise. Counts
 *  (tradeCount) compare exactly. */
export function detectDrift(
  storedResult: unknown,
  currentResult: unknown,
  tolerance = 1e-4,
): DriftReport {
  const stored = extractComparableMetrics(storedResult);
  const current = extractComparableMetrics(currentResult);
  const deltas: Partial<Record<keyof ComparableMetrics, number | null>> = {};
  let hasDrift = false;

  const compare = (key: keyof ComparableMetrics, exact: boolean): void => {
    const s = stored[key];
    const c = current[key];
    if (s === null || c === null) {
      deltas[key] = null;
      return;
    }
    const delta = Math.abs(s - c);
    deltas[key] = delta;
    if (exact ? delta > 0 : delta > tolerance) hasDrift = true;
  };

  compare("sharpe", false);
  compare("sortino", false);
  compare("maxDrawdown", false);
  compare("winRate", false);
  compare("totalReturn", false);
  compare("tradeCount", true);

  const interpretation = hasDrift
    ? "Drift detected — replayed result diverges from stored snapshot. Investigate venue restatement or strategy-code change."
    : "No drift — replayed result matches the stored snapshot within tolerance.";

  return { hasDrift, deltas, stored, current, interpretation };
}
