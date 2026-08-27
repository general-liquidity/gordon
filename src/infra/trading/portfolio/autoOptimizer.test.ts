import { describe, expect, test } from "bun:test";
import {
  runAutoOptimization,
  PRESET_DIRECTIVES,
  type BacktestScore,
  type StrategyParameters,
} from "./autoOptimizer.ts";

function mockScore(objectiveValue: number): BacktestScore {
  return {
    objectiveValue,
    metrics: {
      sharpe: objectiveValue,
      sortino: objectiveValue,
      totalReturn: objectiveValue * 0.1,
      maxDrawdownPct: 5,
      winRate: 0.55,
      tradeCount: 30,
      calmar: objectiveValue,
    },
    credible: true,
    psr: 0.96,
  };
}

describe("autoOptimizer", () => {
  test("exports runAutoOptimization and preset directives", () => {
    expect(typeof runAutoOptimization).toBe("function");
    expect(PRESET_DIRECTIVES["maximize-sharpe"]?.objective).toBe("sharpe");
  });

  test("runAutoOptimization smoke — returns result with baseline metrics", async () => {
    const initial: StrategyParameters = { rsiPeriod: 14, emaPeriod: 20 };
    let calls = 0;

    const result = await runAutoOptimization(
      {
        description: "smoke test",
        symbols: ["BTCUSDT"],
        strategyType: "momentum",
        objective: "sharpe",
        maxIterations: 1,
        mutationsPerIteration: 1,
        maxTimeMinutes: 1,
      },
      initial,
      async () => {
        calls += 1;
        return mockScore(1 + calls * 0.01);
      },
    );

    expect(result.originalParameters).toEqual(initial);
    expect(result.bestParameters).toBeDefined();
    expect(result.totalBacktests).toBeGreaterThan(0);
    expect(result.summary).toContain("Auto-Optimization");
    expect(result.stopReason).toBeDefined();
  });
});
