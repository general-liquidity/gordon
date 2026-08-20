import { describe, expect, test } from "bun:test";
import { GridSearchOptimizer } from "./grid-search.ts";
import type {
  BacktestEngine,
  BacktestResult,
  ParameterSet,
} from "./grid-search.ts";
import { RandomSearchOptimizer } from "./random-search.ts";
import type { OHLC } from "../types.ts";
import type { Strategy } from "../../strategies/types.ts";

const SAMPLE_SIZE = 40;

/** Small, steady gains every bar: whatever order the bars arrive in, the path survives. */
const ROBUST_SERIES: readonly number[] = Array.from(
  { length: SAMPLE_SIZE },
  () => 0.006
);

/**
 * Higher observed return, but only because history dealt its losing bars LAST, after thirty
 * winners had built a cushion. Reorder the path and it is stopped out.
 */
const LUCKY_SERIES: readonly number[] = Array.from(
  { length: SAMPLE_SIZE },
  (_, i) => (i < 30 ? 0.027 : -0.05)
);

const SERIES_BY_LOOKBACK: Record<number, readonly number[]> = {
  10: ROBUST_SERIES,
  20: LUCKY_SERIES,
};

const ROBUST_PARAMS: ParameterSet = { lookback: 10 };
const LUCKY_PARAMS: ParameterSet = { lookback: 20 };

/** A run that breaches the ruin barrier stops trading and keeps its loss. */
const RUIN_BARRIER = 0.93;

function barrieredReturn(returns: readonly number[]): number {
  let equity = 1;
  for (const r of returns) {
    equity *= 1 + r;
    if (equity < RUIN_BARRIER) return equity - 1;
  }
  return equity - 1;
}

function equityCurveOf(returns: readonly number[]): Array<{ equity: number }> {
  const curve = [{ equity: 1 }];
  let equity = 1;
  for (const r of returns) {
    equity *= 1 + r;
    curve.push({ equity });
  }
  return curve;
}

/** Deterministic engine: the parameter set selects a pre-baked path. */
function makeEngine(options: { withEquityCurve: boolean }): BacktestEngine {
  return {
    run(
      _strategy: Strategy,
      _data: OHLC[],
      params?: ParameterSet
    ): BacktestResult {
      const lookback = params?.lookback ?? 10;
      const series = SERIES_BY_LOOKBACK[lookback] ?? ROBUST_SERIES;
      const totalReturn = barrieredReturn(series) * 100;

      return {
        strategyName: "stub",
        metrics: {
          initialValue: 1,
          finalValue: 1 + totalReturn / 100,
          totalReturn,
          sharpeRatio: totalReturn / 10,
          maxDrawdown: 0,
          numTrades: series.length,
          winRate: 50,
        },
        params,
        executionTimeMs: 0,
        ...(options.withEquityCurve
          ? { equityCurve: equityCurveOf(series) }
          : {}),
      };
    },
  };
}

const STRATEGY = { name: "stub" } as unknown as Strategy;
const DATA: OHLC[] = [];

function gridOptimizer(withEquityCurve = true): GridSearchOptimizer {
  return new GridSearchOptimizer(
    makeEngine({ withEquityCurve }),
    STRATEGY,
    DATA
  );
}

const ROBUST_OPTIONS = {
  enabled: true,
  resamples: 400,
  seed: 7,
  utility: barrieredReturn,
} as const;

const RANGES = { lookback: [10, 20] };

describe("robust parameter selection", () => {
  test("a search with the feature absent picks the same winner as one with it disabled", () => {
    const withoutOption = gridOptimizer().optimize(RANGES, "totalReturn");
    const disabled = gridOptimizer().optimize(RANGES, "totalReturn", {
      robustSelection: { ...ROBUST_OPTIONS, enabled: false },
    });

    expect(disabled.bestParams).toEqual(withoutOption.bestParams);
    expect(disabled.bestMetrics).toEqual(withoutOption.bestMetrics);
    expect(disabled.allResults).toEqual(withoutOption.allResults);
    expect(disabled.totalCombinations).toBe(withoutOption.totalCombinations);
  });

  test("a disabled search carries no selection report at all", () => {
    const withoutOption = gridOptimizer().optimize(RANGES, "totalReturn");
    const disabled = gridOptimizer().optimize(RANGES, "totalReturn", {
      robustSelection: { ...ROBUST_OPTIONS, enabled: false },
    });

    expect("robustSelection" in withoutOption).toBe(false);
    expect("robustSelection" in disabled).toBe(false);
  });

  test("enabling the report leaves the returned winner as the observed best", () => {
    const plain = gridOptimizer().optimize(RANGES, "totalReturn");
    const enabled = gridOptimizer().optimize(RANGES, "totalReturn", {
      robustSelection: ROBUST_OPTIONS,
    });

    expect(enabled.bestParams).toEqual(plain.bestParams);
    expect(enabled.bestParams).toEqual(LUCKY_PARAMS);
    expect(enabled.robustSelection?.argmaxWinner).toEqual(LUCKY_PARAMS);
  });

  test("a candidate that wins on the observed path loses on the bootstrap percentile", () => {
    const result = gridOptimizer().optimize(RANGES, "totalReturn", {
      robustSelection: ROBUST_OPTIONS,
    });
    const report = result.robustSelection;

    expect(report?.available).toBe(true);
    expect(report?.argmaxWinner).toEqual(LUCKY_PARAMS);
    expect(report?.percentileWinner).toEqual(ROBUST_PARAMS);
  });

  test("the two winners differing is reported as a disagreement", () => {
    const result = gridOptimizer().optimize(RANGES, "totalReturn", {
      robustSelection: ROBUST_OPTIONS,
    });

    expect(result.robustSelection?.disagree).toBe(true);
  });

  test("the two winners agreeing is not reported as a disagreement", () => {
    const result = gridOptimizer().optimize({ lookback: [10] }, "totalReturn", {
      robustSelection: ROBUST_OPTIONS,
    });

    expect(result.robustSelection?.disagree).toBe(false);
    expect(result.robustSelection?.percentileWinner).toEqual(ROBUST_PARAMS);
  });

  test("the lucky candidate has the wider gap between observed and percentile utility", () => {
    const result = gridOptimizer().optimize(RANGES, "totalReturn", {
      robustSelection: ROBUST_OPTIONS,
    });
    const candidates = result.robustSelection?.candidates ?? [];
    const lucky = candidates.find((c) => c.params.lookback === 20);
    const robust = candidates.find((c) => c.params.lookback === 10);

    expect(lucky).toBeDefined();
    expect(robust).toBeDefined();
    expect(lucky?.overfitGap ?? 0).toBeGreaterThan(robust?.overfitGap ?? 0);
    expect(result.robustSelection?.argmaxWinnerOverfitGap).toBe(
      lucky?.overfitGap ?? 0
    );
    expect(result.robustSelection?.percentileWinnerOverfitGap).toBe(
      robust?.overfitGap ?? 0
    );
  });

  test("the same seed yields the same percentile utilities", () => {
    const first = gridOptimizer().optimize(RANGES, "totalReturn", {
      robustSelection: ROBUST_OPTIONS,
    });
    const second = gridOptimizer().optimize(RANGES, "totalReturn", {
      robustSelection: ROBUST_OPTIONS,
    });

    expect(second.robustSelection?.candidates).toEqual(
      first.robustSelection?.candidates ?? []
    );
  });

  test("a result without a per-period series is reported unavailable, not scored", () => {
    const result = gridOptimizer(false).optimize(RANGES, "totalReturn", {
      robustSelection: ROBUST_OPTIONS,
    });

    expect(result.robustSelection?.available).toBe(false);
    expect(result.robustSelection?.unavailableReason).toContain(
      "per-period return series"
    );
    expect(result.robustSelection?.percentileWinner).toBeNull();
    expect(result.bestParams).toEqual(LUCKY_PARAMS);
  });

  test("searching a metric no return series can rebuild warns instead of scoring it silently", () => {
    const result = gridOptimizer().optimize(RANGES, "winRate", {
      robustSelection: { enabled: true, resamples: 50, seed: 7 },
    });

    expect(result.robustSelection?.utilityMetric).toBe("sharpeRatio");
    expect(result.robustSelection?.warnings.join(" ")).toContain("winRate");
  });

  test("random search reports the same disagreement as grid search", () => {
    const optimizer = new RandomSearchOptimizer(
      makeEngine({ withEquityCurve: true }),
      STRATEGY,
      DATA
    );
    const result = optimizer.optimize({ lookback: [10, 20] }, 12, "totalReturn", {
      seed: 3,
      robustSelection: ROBUST_OPTIONS,
    });

    expect(result.bestParams).toEqual(LUCKY_PARAMS);
    expect(result.robustSelection?.percentileWinner).toEqual(ROBUST_PARAMS);
    expect(result.robustSelection?.disagree).toBe(true);
  });

  test("random search with the feature disabled matches a search without it", () => {
    const plain = new RandomSearchOptimizer(
      makeEngine({ withEquityCurve: true }),
      STRATEGY,
      DATA
    ).optimize({ lookback: [10, 20] }, 12, "totalReturn", { seed: 3 });

    const disabled = new RandomSearchOptimizer(
      makeEngine({ withEquityCurve: true }),
      STRATEGY,
      DATA
    ).optimize({ lookback: [10, 20] }, 12, "totalReturn", {
      seed: 3,
      robustSelection: { ...ROBUST_OPTIONS, enabled: false },
    });

    expect(disabled.bestParams).toEqual(plain.bestParams);
    expect(disabled.allResults).toEqual(plain.allResults);
    expect("robustSelection" in plain).toBe(false);
    expect("robustSelection" in disabled).toBe(false);
  });
});
