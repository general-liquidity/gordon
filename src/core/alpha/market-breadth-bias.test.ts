import { describe, expect, it } from "bun:test";
import { classifyMarketBreadth, type SymbolSnapshot } from "./market-breadth-bias.ts";

const universe = (n: number, ret: number, clean: number): SymbolSnapshot[] =>
  Array.from({ length: n }, (_, i) => ({ symbol: `S${i}`, return: ret, trendCleanliness: clean }));

describe("classifyMarketBreadth", () => {
  it("clean broad uptrend → strong long + strong momentum → momentum_long", () => {
    const r = classifyMarketBreadth({ symbols: universe(25, 0.08, 0.85) })!;
    expect(r.direction).toBe("strong_long");
    expect(r.strategy).toBe("strong_momentum");
    expect(r.favored).toEqual(["momentum_long"]);
    expect(r.breadthScore).toBeCloseTo(0.8, 6);
    expect(r.conviction).toBeGreaterThan(0.5);
  });

  it("clean broad downtrend → strong short + momentum → momentum_short", () => {
    const r = classifyMarketBreadth({ symbols: universe(25, -0.08, 0.85) })!;
    expect(r.direction).toBe("strong_short");
    expect(r.favored).toEqual(["momentum_short"]);
  });

  it("small mixed returns + choppy structure → neutral direction + mean-reversion both sides", () => {
    const syms = Array.from({ length: 25 }, (_, i) => ({ symbol: `S${i}`, return: i % 2 ? 0.01 : -0.01, trendCleanliness: 0.2 }));
    const r = classifyMarketBreadth({ symbols: syms })!;
    expect(r.direction).toBe("neutral");
    expect(r.strategy).toBe("strong_mean_reversion");
    expect(r.favored).toEqual(["mean_reversion_long", "mean_reversion_short"]);
    expect(r.summary).toContain("mean_reversion");
  });

  it("mixed direction but clean significant movers → neutral direction, momentum both sides", () => {
    const syms = Array.from({ length: 24 }, (_, i) => ({ symbol: `S${i}`, return: i < 12 ? 0.08 : -0.08, trendCleanliness: 0.85 }));
    const r = classifyMarketBreadth({ symbols: syms })!;
    expect(r.breadthScore).toBeCloseTo(0, 6);
    expect(r.direction).toBe("neutral");
    expect(r.strategy).toBe("strong_momentum");
    expect(r.favored).toEqual(["momentum_long", "momentum_short"]);
  });

  it("activity modifier tips the strategy axis (elevated → momentum, depressed → mean-reversion)", () => {
    expect(classifyMarketBreadth({ symbols: universe(25, 0.08, 0.5) })!.strategy).toBe("neutral");
    expect(classifyMarketBreadth({ symbols: universe(25, 0.08, 0.5), activityRatio: 1.3 })!.strategy).toBe("mild_momentum");
    expect(classifyMarketBreadth({ symbols: universe(25, 0.08, 0.5), activityRatio: 0.7 })!.strategy).toBe("mild_mean_reversion");
  });

  it("conviction scales with universe size (more breadth = more conviction)", () => {
    const small = classifyMarketBreadth({ symbols: universe(4, 0.08, 0.85) })!;
    const big = classifyMarketBreadth({ symbols: universe(40, 0.08, 0.85) })!;
    expect(small.conviction).toBeLessThan(big.conviction);
  });

  it("fully neutral market → no favored strategy, sit out", () => {
    const r = classifyMarketBreadth({ symbols: universe(25, 0.0, 0.5) })!;
    expect(r.favored).toEqual([]);
    expect(r.summary).toContain("sit out");
  });

  it("returns null for an empty universe", () => {
    expect(classifyMarketBreadth({ symbols: [] })).toBeNull();
  });
});
