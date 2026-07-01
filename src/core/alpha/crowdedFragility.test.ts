import { describe, expect, test } from "bun:test";
import {
  computeCrowdedFragility,
  crowdedFragilityFromVerdict,
  formatCrowdedFragility,
  type CrowdedFragilityInputs,
} from "./crowdedFragility.ts";

const base: CrowdedFragilityInputs = {
  crowdNetScore: 0.9,
  crowdedNotional: 100,
  exitLiquidity: 100,
  sharedFactorExposure: 0.9,
};

describe("computeCrowdedFragility", () => {
  test("high concentration + thin exit + shared factor => critical", () => {
    // Notional 500 into ADV 100 at 20% participation => 25 days to exit.
    const r = computeCrowdedFragility({
      crowdNetScore: 0.95,
      crowdedNotional: 500,
      exitLiquidity: 100,
      sharedFactorExposure: 0.95,
    });
    expect(r.severity).toBe("critical");
    expect(r.fragilityScore).toBeGreaterThan(0.4);
    expect(r.exitIlliquidity).toBeGreaterThan(0.9);
    expect(r.expectedFlushDirection).toBe("down");
  });

  test("product semantics: any zero component zeroes fragility", () => {
    // Independent bets (sharedFactor 0) => no synchronized flush.
    const r = computeCrowdedFragility({ ...base, sharedFactorExposure: 0 });
    expect(r.fragilityScore).toBe(0);
    expect(r.severity).toBe("stable");
    // But the pairwise first-mover advantage still exists.
    expect(r.firstMoverAdvantage).toBeGreaterThan(0);
  });

  test("no crowded notional => no illiquidity => stable", () => {
    const r = computeCrowdedFragility({ ...base, crowdedNotional: 0 });
    expect(r.exitIlliquidity).toBe(0);
    expect(r.estimatedDaysToExit).toBe(0);
    expect(r.fragilityScore).toBe(0);
    expect(r.severity).toBe("stable");
  });

  test("zero exit liquidity => fully illiquid door", () => {
    const r = computeCrowdedFragility({ ...base, exitLiquidity: 0 });
    expect(r.exitIlliquidity).toBe(1);
    expect(r.estimatedDaysToExit).toBe(Number.POSITIVE_INFINITY);
  });

  test("short-crowded => flush up", () => {
    const r = computeCrowdedFragility({ ...base, crowdNetScore: -0.9 });
    expect(r.expectedFlushDirection).toBe("up");
    // Magnitude drives fragility; sign only sets direction.
    const long = computeCrowdedFragility({ ...base, crowdNetScore: 0.9 });
    expect(r.fragilityScore).toBeCloseTo(long.fragilityScore, 12);
  });

  test("near-flat concentration => no directional flush", () => {
    const r = computeCrowdedFragility({ ...base, crowdNetScore: 0.02 });
    expect(r.expectedFlushDirection).toBeNull();
  });

  test("concentration and shared factor are clamped to [0,1]", () => {
    const r = computeCrowdedFragility({
      crowdNetScore: 5,
      crowdedNotional: 100,
      exitLiquidity: 100,
      sharedFactorExposure: 9,
    });
    expect(r.concentration).toBe(1);
    expect(r.sharedFactorExposure).toBe(1);
    expect(r.fragilityScore).toBeLessThanOrEqual(1);
  });

  test("firstMoverAdvantage excludes the shared factor", () => {
    const r = computeCrowdedFragility(base);
    expect(r.firstMoverAdvantage).toBeCloseTo(r.concentration * r.exitIlliquidity, 12);
    expect(r.fragilityScore).toBeCloseTo(r.firstMoverAdvantage * r.sharedFactorExposure, 12);
  });

  test("default shared factor is 0.5 when omitted", () => {
    const r = computeCrowdedFragility({
      crowdNetScore: 0.9,
      crowdedNotional: 100,
      exitLiquidity: 100,
    });
    expect(r.sharedFactorExposure).toBe(0.5);
  });

  test("tunable severity thresholds", () => {
    const inputs = { ...base };
    const strict = computeCrowdedFragility(inputs, {
      fragileThreshold: 0.01,
      criticalThreshold: 0.02,
    });
    expect(strict.severity).toBe("critical");
  });
});

describe("crowdedFragilityFromVerdict", () => {
  test("pulls netScore from a crowdPositioning verdict", () => {
    const r = crowdedFragilityFromVerdict(
      { netScore: 0.9 },
      { crowdedNotional: 500, exitLiquidity: 100, sharedFactorExposure: 0.95 },
    );
    expect(r.concentration).toBeCloseTo(0.9, 12);
    expect(r.expectedFlushDirection).toBe("down");
  });
});

describe("formatCrowdedFragility", () => {
  test("summary reflects severity", () => {
    const r = computeCrowdedFragility(base);
    const s = formatCrowdedFragility(r);
    expect(s).toContain(r.severity.toUpperCase());
  });
});
