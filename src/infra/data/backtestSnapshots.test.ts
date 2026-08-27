import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  recordBacktestRun,
  getBacktestRun,
  listBacktestRuns,
  pruneRunsBefore,
  computeInputsHash,
  extractComparableMetrics,
  detectDrift,
  _resetBacktestSnapshotsForTests,
} from "./backtestSnapshots.ts";
import { setDatabasePathForTesting, closeDatabase } from "../storage/database.ts";
import { unlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let counter = 0;
let currentDbPath = "";
const cleanupPaths = new Set<string>();

function safeUnlink(path: string): void {
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    /* Windows-busy */
  }
}

beforeEach(() => {
  counter++;
  currentDbPath = join(tmpdir(), `gordon-backtest-snapshots-${process.pid}-${counter}.db`);
  cleanupPaths.add(currentDbPath);
  setDatabasePathForTesting(currentDbPath);
  _resetBacktestSnapshotsForTests();
});

afterEach(() => {
  closeDatabase();
  setDatabasePathForTesting(null);
});

afterAll(() => {
  for (const path of cleanupPaths) {
    safeUnlink(path);
    safeUnlink(`${path}-wal`);
    safeUnlink(`${path}-shm`);
  }
});

describe("computeInputsHash", () => {
  test("identical inputs produce identical hash", () => {
    const a = computeInputsHash("support_bounce", "BTC/USDT", "1h", 1_000, 2_000, { rsi: 14 });
    const b = computeInputsHash("support_bounce", "BTC/USDT", "1h", 1_000, 2_000, { rsi: 14 });
    expect(a).toBe(b);
  });

  test("param order doesn't change hash", () => {
    const a = computeInputsHash("x", "BTC", "1h", 0, 1, { a: 1, b: 2 });
    const b = computeInputsHash("x", "BTC", "1h", 0, 1, { b: 2, a: 1 });
    expect(a).toBe(b);
  });

  test("different params produce different hashes", () => {
    const a = computeInputsHash("x", "BTC", "1h", 0, 1, { rsi: 14 });
    const b = computeInputsHash("x", "BTC", "1h", 0, 1, { rsi: 21 });
    expect(a).not.toBe(b);
  });

  test("symbol case is normalized", () => {
    const a = computeInputsHash("x", "btc/usdt", "1h", 0, 1, {});
    const b = computeInputsHash("x", "BTC/USDT", "1h", 0, 1, {});
    expect(a).toBe(b);
  });
});

describe("recordBacktestRun + getBacktestRun", () => {
  test("records and reads back a snapshot", () => {
    const snap = recordBacktestRun({
      strategyId: "support_bounce",
      symbol: "BTC/USDT",
      timeframe: "1h",
      fromTs: 1_000,
      toTs: 2_000,
      params: { rsi: 14, commission: 0.001 },
      result: { sharpe: 1.5, winRate: 0.55, tradeCount: 42 },
    });
    expect(snap.runId).toMatch(/^bt_/);
    const retrieved = getBacktestRun(snap.runId);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.strategyId).toBe("support_bounce");
    expect(retrieved?.symbol).toBe("BTC/USDT");
    expect(retrieved?.params).toEqual({ rsi: 14, commission: 0.001 });
    expect(retrieved?.inputsHash).toBe(snap.inputsHash);
  });

  test("returns null for unknown runId", () => {
    expect(getBacktestRun("bt_nonexistent")).toBeNull();
  });

  test("two records with identical inputs are allowed (each is its own audit row)", () => {
    const a = recordBacktestRun({
      strategyId: "x",
      symbol: "BTC",
      timeframe: "1h",
      fromTs: 0,
      toTs: 1,
      params: {},
      result: { sharpe: 1.0 },
    });
    const b = recordBacktestRun({
      strategyId: "x",
      symbol: "BTC",
      timeframe: "1h",
      fromTs: 0,
      toTs: 1,
      params: {},
      result: { sharpe: 1.5 },
    });
    expect(a.runId).not.toBe(b.runId);
    expect(a.inputsHash).toBe(b.inputsHash);
  });
});

describe("listBacktestRuns", () => {
  test("filters by strategyId + symbol, sorted by recordedAt desc", async () => {
    recordBacktestRun({
      strategyId: "x",
      symbol: "BTC",
      timeframe: "1h",
      fromTs: 0,
      toTs: 1,
      params: {},
      result: {},
    });
    await new Promise((r) => setTimeout(r, 2));
    recordBacktestRun({
      strategyId: "x",
      symbol: "ETH",
      timeframe: "1h",
      fromTs: 0,
      toTs: 1,
      params: {},
      result: {},
    });
    await new Promise((r) => setTimeout(r, 2));
    recordBacktestRun({
      strategyId: "y",
      symbol: "BTC",
      timeframe: "1h",
      fromTs: 0,
      toTs: 1,
      params: {},
      result: {},
    });

    const x = listBacktestRuns({ strategyId: "x" });
    expect(x).toHaveLength(2);
    const btc = listBacktestRuns({ symbol: "BTC" });
    expect(btc).toHaveLength(2);
    // Most recent first.
    expect(btc[0]!.strategyId).toBe("y");
  });

  test("respects limit", () => {
    for (let i = 0; i < 5; i++) {
      recordBacktestRun({
        strategyId: "x",
        symbol: "BTC",
        timeframe: "1h",
        fromTs: i,
        toTs: i + 1,
        params: {},
        result: {},
      });
    }
    expect(listBacktestRuns({ limit: 3 })).toHaveLength(3);
  });
});

describe("pruneRunsBefore", () => {
  test("drops snapshots recorded before the threshold", async () => {
    const a = recordBacktestRun({
      strategyId: "x",
      symbol: "BTC",
      timeframe: "1h",
      fromTs: 0,
      toTs: 1,
      params: {},
      result: {},
    });
    await new Promise((r) => setTimeout(r, 5));
    const cutoff = Date.now();
    await new Promise((r) => setTimeout(r, 5));
    const b = recordBacktestRun({
      strategyId: "x",
      symbol: "BTC",
      timeframe: "1h",
      fromTs: 0,
      toTs: 1,
      params: {},
      result: {},
    });

    const removed = pruneRunsBefore(cutoff);
    expect(removed).toBe(1);
    expect(getBacktestRun(a.runId)).toBeNull();
    expect(getBacktestRun(b.runId)).not.toBeNull();
  });
});

describe("extractComparableMetrics", () => {
  test("pulls top-level metric names", () => {
    const m = extractComparableMetrics({ sharpe: 1.2, winRate: 0.6, tradeCount: 30 });
    expect(m.sharpe).toBe(1.2);
    expect(m.winRate).toBe(0.6);
    expect(m.tradeCount).toBe(30);
  });

  test("probes nested .metrics and .result", () => {
    const m = extractComparableMetrics({ metrics: { sharpe: 0.8 }, result: { winRate: 0.5 } });
    expect(m.sharpe).toBe(0.8);
    expect(m.winRate).toBe(0.5);
  });

  test("accepts snake_case aliases", () => {
    const m = extractComparableMetrics({ max_drawdown: 0.15, win_rate: 0.55, total_return: 0.4 });
    expect(m.maxDrawdown).toBe(0.15);
    expect(m.winRate).toBe(0.55);
    expect(m.totalReturn).toBe(0.4);
  });

  test("returns null for missing or non-numeric metrics", () => {
    const m = extractComparableMetrics({ sharpe: "high" });
    expect(m.sharpe).toBeNull();
  });
});

describe("detectDrift", () => {
  test("no drift when identical results", () => {
    const r = detectDrift(
      { sharpe: 1.0, winRate: 0.5, tradeCount: 10 },
      { sharpe: 1.0, winRate: 0.5, tradeCount: 10 },
    );
    expect(r.hasDrift).toBe(false);
    expect(r.interpretation).toContain("No drift");
  });

  test("absorbs fp noise within tolerance", () => {
    const r = detectDrift({ sharpe: 1.0 }, { sharpe: 1.0 + 1e-6 });
    expect(r.hasDrift).toBe(false);
  });

  test("flags numeric divergence past tolerance", () => {
    const r = detectDrift({ sharpe: 1.0 }, { sharpe: 1.2 });
    expect(r.hasDrift).toBe(true);
    expect(r.deltas.sharpe).toBeCloseTo(0.2, 5);
  });

  test("trade count compared exactly (no tolerance)", () => {
    const r = detectDrift({ tradeCount: 42 }, { tradeCount: 41 });
    expect(r.hasDrift).toBe(true);
  });

  test("missing-on-one-side yields null delta, no drift flag", () => {
    const r = detectDrift({ sharpe: 1.0 }, { winRate: 0.5 });
    expect(r.deltas.sharpe).toBeNull();
    expect(r.deltas.winRate).toBeNull();
    expect(r.hasDrift).toBe(false);
  });
});
