import { describe, expect, test } from "bun:test";
import {
  computeTradeConsistency,
  formatTradeConsistency,
  type TradeExecution,
} from "./trade-consistency.ts";

function makeTrade(
  strategy: string,
  trigger: string,
  stop: number,
  target: number,
): TradeExecution {
  return {
    strategyId: strategy,
    entryTriggerId: trigger,
    stopDistance: stop,
    targetDistance: target,
  };
}

describe("computeTradeConsistency", () => {
  test("insufficient_data with too few trades", () => {
    const trades = Array(5)
      .fill(0)
      .map(() => makeTrade("A", "X", 1, 2));
    const r = computeTradeConsistency(trades);
    expect(r.verdict).toBe("insufficient_data");
  });

  test("identical trades → highly_consistent (composite = 1)", () => {
    const trades = Array(20)
      .fill(0)
      .map(() => makeTrade("A", "X", 1, 2));
    const r = computeTradeConsistency(trades);
    expect(r.compositeScore).toBeCloseTo(1, 3);
    expect(r.verdict).toBe("highly_consistent");
    expect(r.strategyShare).toBe(1);
    expect(r.stopCv).toBe(0);
  });

  test("varied strategies → strategy subscore drops", () => {
    const trades: TradeExecution[] = [];
    for (let i = 0; i < 20; i++) {
      trades.push(makeTrade(i % 2 === 0 ? "A" : "B", "X", 1, 2));
    }
    const r = computeTradeConsistency(trades);
    expect(r.strategyShare).toBeCloseTo(0.5, 1);
    expect(r.subscores.strategy).toBeCloseTo(0.5, 1);
  });

  test("varied entry trigger → entry subscore drops", () => {
    const trades: TradeExecution[] = [];
    for (let i = 0; i < 20; i++) {
      trades.push(makeTrade("A", `T${i % 4}`, 1, 2));
    }
    const r = computeTradeConsistency(trades);
    expect(r.entryTriggerShare).toBeCloseTo(0.25, 1);
    expect(r.subscores.entryTrigger).toBeLessThan(0.5);
  });

  test("stop CV high → stop subscore drops", () => {
    const trades: TradeExecution[] = [];
    for (let i = 0; i < 20; i++) {
      trades.push(makeTrade("A", "X", 0.5 + (i % 5), 2));
    }
    const r = computeTradeConsistency(trades);
    expect(r.stopCv).toBeGreaterThan(0.3);
    expect(r.subscores.stopDistance).toBeLessThan(0.8);
  });

  test("highly mixed execution → highly_inconsistent", () => {
    const trades: TradeExecution[] = [];
    for (let i = 0; i < 20; i++) {
      trades.push({
        strategyId: `S${i % 5}`,
        entryTriggerId: `T${i % 5}`,
        stopDistance: 0.5 + (i % 10) * 0.5,
        targetDistance: 1 + (i % 10) * 0.5,
      });
    }
    const r = computeTradeConsistency(trades);
    expect(r.compositeScore).toBeLessThan(0.4);
    expect(r.verdict).toBe("highly_inconsistent");
  });

  test("moderate consistency band", () => {
    const trades: TradeExecution[] = [];
    for (let i = 0; i < 20; i++) {
      trades.push({
        strategyId: i % 5 === 0 ? "B" : "A", // 80% A
        entryTriggerId: i % 4 === 0 ? "Y" : "X", // 75% X
        stopDistance: 1 + (i % 3) * 0.2, // CV ~0.13
        targetDistance: 2 + (i % 3) * 0.2,
      });
    }
    const r = computeTradeConsistency(trades);
    expect(["moderately_consistent", "highly_consistent"]).toContain(r.verdict);
  });

  test("weights respected", () => {
    const trades = Array(20)
      .fill(0)
      .map(() => makeTrade("A", "X", 1, 2));
    // Even when weights are all set differently, identical trades should
    // still produce composite ~1.
    const r = computeTradeConsistency(trades, {
      strategyWeight: 0.5,
      entryTriggerWeight: 0.1,
      stopWeight: 0.2,
      targetWeight: 0.2,
    });
    expect(r.compositeScore).toBeCloseTo(1, 3);
  });

  test("respects custom minTrades", () => {
    const trades = Array(8)
      .fill(0)
      .map(() => makeTrade("A", "X", 1, 2));
    const strict = computeTradeConsistency(trades, { minTrades: 10 });
    const lax = computeTradeConsistency(trades, { minTrades: 5 });
    expect(strict.verdict).toBe("insufficient_data");
    expect(lax.verdict).not.toBe("insufficient_data");
  });

  test("zero-mean stop distances handle gracefully", () => {
    const trades = Array(15)
      .fill(0)
      .map(() => makeTrade("A", "X", 0, 2));
    const r = computeTradeConsistency(trades);
    expect(r.stopCv).toBe(0);
    expect(r.subscores.stopDistance).toBe(1);
  });
});

describe("formatTradeConsistency", () => {
  test("renders header + subscores", () => {
    const trades = Array(20)
      .fill(0)
      .map(() => makeTrade("A", "X", 1, 2));
    const r = computeTradeConsistency(trades);
    const text = formatTradeConsistency(r);
    expect(text).toContain("Trade Consistency");
    expect(text).toContain("HIGHLY_CONSISTENT");
    expect(text).toContain("Composite");
  });
});
