import { describe, expect, test } from "bun:test";
import { generateSyntheticFutures } from "./syntheticFutures.ts";

describe("synthetic futures regime conditioning", () => {
  test("a downtrend does not invert an already-bearish scenario", () => {
    const result = generateSyntheticFutures(
      [
        {
          symbol: "BTC",
          currentPrice: 100,
          annualDrift: 0.365,
          annualVol: 0,
        },
      ],
      [],
      {
        horizonDays: 1,
        pathsPerScenario: 1,
        scenarios: ["bear"],
        tradingDaysPerYear: 365,
        regime: "trending_down",
      },
    );
    expect(result.scenarios.bear[0]!.prices[0]![1]).toBeLessThan(100);
  });

  test("range conditioning dampens base drift", () => {
    const common = {
      horizonDays: 1,
      pathsPerScenario: 1,
      scenarios: ["base"] as const,
      tradingDaysPerYear: 365,
    };
    const assets = [
      {
        symbol: "BTC",
        currentPrice: 100,
        annualDrift: 0.365,
        annualVol: 0,
      },
    ];
    const base = generateSyntheticFutures(assets, [], {
      ...common,
      scenarios: [...common.scenarios],
    });
    const range = generateSyntheticFutures(assets, [], {
      ...common,
      scenarios: [...common.scenarios],
      regime: "range",
    });
    expect(range.scenarios.base[0]!.prices[0]![1]).toBeLessThan(
      base.scenarios.base[0]!.prices[0]![1]!,
    );
  });
});
