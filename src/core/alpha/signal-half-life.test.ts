import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  adoptionSensitivity,
  assessBacktestValidity,
  computeSignalHalfLife,
  criticalAdoptionShare,
  fragilityEfficiencyTradeoff,
  monthsUntilBelowCostFloor,
  monthsUntilEdgeBelow,
  PAPER_CALIBRATION_2026,
  projectExtinctionCascade,
  remainingEdgeFraction,
  type SignalHalfLifeConfig,
} from "./signal-half-life.ts";

const uncrowded: SignalHalfLifeConfig = { ...PAPER_CALIBRATION_2026, adoptionShare: 0 };

describe("signal half-life under crowding", () => {
  test("the published calibration reproduces the paper's eighteen-month crowded half-life", () => {
    const assessment = computeSignalHalfLife(PAPER_CALIBRATION_2026);
    expect(assessment.regime).toBe("finite");
    expect(assessment.halfLifeMonths).toBeCloseTo(18, 6);
    expect(assessment.naturalHalfLifeMonths).toBeCloseTo(72, 6);
  });

  test("half-life shortens with adoption and shortens faster the more crowded the trade gets", () => {
    const sensitivity = adoptionSensitivity(PAPER_CALIBRATION_2026);
    expect(sensitivity.convexDecreasing).toBe(true);

    const lives = sensitivity.points.map((point) => point.halfLifeMonths);
    for (let index = 1; index < lives.length; index += 1) {
      const previous = lives[index - 1];
      const current = lives[index];
      expect(previous).toBeDefined();
      expect(current).toBeDefined();
      expect(current as number).toBeLessThan(previous as number);
    }

    for (let index = 1; index + 1 < lives.length; index += 1) {
      const left = lives[index - 1] as number;
      const middle = lives[index] as number;
      const right = lives[index + 1] as number;
      expect(left - 2 * middle + right).toBeGreaterThan(0);
    }
  });

  test("with no adoption the model reduces to the signal's own mean reversion", () => {
    const assessment = computeSignalHalfLife(uncrowded);
    expect(assessment.adoptionDecayRate).toBe(0);
    expect(assessment.halfLifeMonths).toBeCloseTo(Math.LN2 / uncrowded.naturalDecayRate, 10);
    expect(assessment.halfLifeMonths).toBeCloseTo(assessment.naturalHalfLifeMonths, 10);
  });

  test("monoculture is reported as net-alpha-zero rather than as a very short half-life", () => {
    const assessment = computeSignalHalfLife({
      ...PAPER_CALIBRATION_2026,
      adoptionShare: 1,
      strategyCorrelation: 1,
    });
    expect(assessment.regime).toBe("monoculture");
    expect(assessment.netAlphaIsZero).toBe(true);
    expect(assessment.halfLifeMonths).toBe(0);
    expect(assessment.note).toContain("Red Queen");

    const nearMonoculture = computeSignalHalfLife({
      ...PAPER_CALIBRATION_2026,
      adoptionShare: 1,
      strategyCorrelation: 0.99,
    });
    expect(nearMonoculture.regime).toBe("finite");
    expect(nearMonoculture.netAlphaIsZero).toBe(false);
  });

  test("edge decays exponentially and exactly half remains after one half-life", () => {
    const halfLife = computeSignalHalfLife(PAPER_CALIBRATION_2026).halfLifeMonths;
    expect(remainingEdgeFraction(halfLife, 0)).toBe(1);
    expect(remainingEdgeFraction(halfLife, halfLife)).toBeCloseTo(0.5, 12);
    expect(remainingEdgeFraction(halfLife, 2 * halfLife)).toBeCloseTo(0.25, 12);
    expect(remainingEdgeFraction(halfLife, 3 * halfLife)).toBeCloseTo(0.125, 12);

    expect(monthsUntilEdgeBelow(halfLife, 0.5)).toBeCloseTo(halfLife, 10);
    expect(monthsUntilEdgeBelow(halfLife, 0.25)).toBeCloseTo(2 * halfLife, 10);
  });

  test("a backtest window longer than the half-life is flagged as measuring a decayed average", () => {
    const halfLife = 18;
    const flagged = assessBacktestValidity({
      backtestWindowMonths: 60,
      liveHorizonMonths: 12,
      halfLifeMonths: halfLife,
    });
    expect(flagged.measuresDecayedAverage).toBe(true);
    expect(flagged.halfLivesInWindow).toBeCloseTo(60 / 18, 10);
    expect(flagged.overstatementFactor).toBeGreaterThan(1);
    expect(flagged.warnings.length).toBeGreaterThan(0);
    expect(flagged.edgeAtHorizonEnd).toBeLessThan(flagged.edgeAtWindowEnd);

    const clean = assessBacktestValidity({
      backtestWindowMonths: 6,
      liveHorizonMonths: 3,
      halfLifeMonths: halfLife,
    });
    expect(clean.measuresDecayedAverage).toBe(false);
    expect(clean.liveHorizonExceedsHalfLife).toBe(false);
    expect(clean.warnings).toHaveLength(0);
  });

  test("correlated adopters crowd the signal out faster, independent ones do not crowd at all", () => {
    const correlated = computeSignalHalfLife({
      ...PAPER_CALIBRATION_2026,
      strategyCorrelation: 0.9,
    });
    const lessCorrelated = computeSignalHalfLife({
      ...PAPER_CALIBRATION_2026,
      strategyCorrelation: 0.3,
    });
    expect(correlated.halfLifeMonths).toBeLessThan(lessCorrelated.halfLifeMonths);

    const independent = computeSignalHalfLife({
      ...PAPER_CALIBRATION_2026,
      strategyCorrelation: 0,
    });
    expect(independent.adoptionDecayRate).toBe(0);
    expect(independent.halfLifeMonths).toBeCloseTo(independent.naturalHalfLifeMonths, 10);
  });

  test("deeper markets absorb crowding and keep the edge alive longer", () => {
    const shallow = computeSignalHalfLife({ ...PAPER_CALIBRATION_2026, baseMarketDepth: 500 });
    const deep = computeSignalHalfLife({ ...PAPER_CALIBRATION_2026, baseMarketDepth: 5000 });
    expect(deep.halfLifeMonths).toBeGreaterThan(shallow.halfLifeMonths);
    expect(deep.effectiveDepth).toBeGreaterThan(shallow.effectiveDepth);
  });

  test("results depend only on caller-supplied inputs, never on the wall clock", () => {
    const first = computeSignalHalfLife(PAPER_CALIBRATION_2026);
    const second = computeSignalHalfLife(PAPER_CALIBRATION_2026);
    expect(second).toEqual(first);
    expect(adoptionSensitivity(PAPER_CALIBRATION_2026)).toEqual(
      adoptionSensitivity(PAPER_CALIBRATION_2026),
    );

    const source = readFileSync(new URL("./signal-half-life.ts", import.meta.url), "utf8");
    expect(source).not.toContain("Date.now");
    expect(source).not.toContain("Math.random");
    expect(source).not.toContain("new Date");
  });

  test("zero decay and negative parameters resolve at the boundary instead of producing NaN", () => {
    const persistent = computeSignalHalfLife({ ...uncrowded, naturalDecayRate: 0 });
    expect(persistent.regime).toBe("persistent");
    expect(persistent.halfLifeMonths).toBe(Number.POSITIVE_INFINITY);
    expect(remainingEdgeFraction(persistent.halfLifeMonths, 240)).toBe(1);
    expect(monthsUntilEdgeBelow(persistent.halfLifeMonths, 0.5)).toBe(Number.POSITIVE_INFINITY);

    const validity = assessBacktestValidity({
      backtestWindowMonths: 120,
      liveHorizonMonths: 24,
      halfLifeMonths: Number.POSITIVE_INFINITY,
    });
    expect(validity.measuresDecayedAverage).toBe(false);
    expect(validity.windowAverageEdgeFraction).toBe(1);
    expect(Number.isNaN(validity.overstatementFactor)).toBe(false);

    expect(() =>
      computeSignalHalfLife({ ...PAPER_CALIBRATION_2026, naturalDecayRate: -0.1 }),
    ).toThrow(RangeError);
    expect(() => computeSignalHalfLife({ ...PAPER_CALIBRATION_2026, adoptionShare: -0.2 })).toThrow(
      RangeError,
    );
    expect(() => computeSignalHalfLife({ ...PAPER_CALIBRATION_2026, adoptionShare: 1.5 })).toThrow(
      RangeError,
    );
    expect(() => computeSignalHalfLife({ ...PAPER_CALIBRATION_2026, baseMarketDepth: 0 })).toThrow(
      RangeError,
    );
    expect(() => remainingEdgeFraction(18, -1)).toThrow(RangeError);
    expect(() => monthsUntilEdgeBelow(18, 0)).toThrow(RangeError);
  });

  test("cost-floor horizon says when a backtested edge stops paying for its own execution", () => {
    const halfLife = computeSignalHalfLife(PAPER_CALIBRATION_2026).halfLifeMonths;
    const horizon = monthsUntilBelowCostFloor({
      backtestedEdge: 1.8,
      costFloorEdge: 0.9,
      halfLifeMonths: halfLife,
    });
    expect(horizon.alreadyBelowFloor).toBe(false);
    expect(horizon.monthsUntilBelowFloor).toBeCloseTo(halfLife, 10);

    const dead = monthsUntilBelowCostFloor({
      backtestedEdge: 0.4,
      costFloorEdge: 0.5,
      halfLifeMonths: halfLife,
    });
    expect(dead.alreadyBelowFloor).toBe(true);
    expect(dead.monthsUntilBelowFloor).toBe(0);
  });

  test("a critical adoption share is located once the half-life falls under the operator's floor", () => {
    const critical = criticalAdoptionShare(PAPER_CALIBRATION_2026, 24);
    expect(critical).not.toBeNull();
    const share = critical as number;
    expect(share).toBeGreaterThan(0);
    expect(share).toBeLessThan(PAPER_CALIBRATION_2026.adoptionShare);
    expect(
      computeSignalHalfLife({ ...PAPER_CALIBRATION_2026, adoptionShare: share }).halfLifeMonths,
    ).toBeCloseTo(24, 6);

    expect(criticalAdoptionShare(PAPER_CALIBRATION_2026, 200)).toBe(0);
    expect(criticalAdoptionShare(PAPER_CALIBRATION_2026, 1)).toBeNull();
  });

  test("extinction of one signal class shortens the life of the classes left behind", () => {
    const cascade = projectExtinctionCascade(
      [
        { name: "crowded-momentum", config: { ...PAPER_CALIBRATION_2026, adoptionShare: 0.9 } },
        { name: "value-residual", config: { ...PAPER_CALIBRATION_2026, adoptionShare: 0.2 } },
      ],
      { halfLifeFloorMonths: 20 },
    );

    expect(cascade.cascaded).toBe(true);
    const firstEvent = cascade.events[0];
    expect(firstEvent).toBeDefined();
    expect((firstEvent as { name: string }).name).toBe("crowded-momentum");

    // The freed adoption lands on the remaining class, which then dies far earlier than
    // its own uncontested half-life would suggest.
    const secondEvent = cascade.events[1];
    expect(secondEvent).toBeDefined();
    const secondLife = (secondEvent as { halfLifeMonthsAtExtinction: number })
      .halfLifeMonthsAtExtinction;
    const untouched = computeSignalHalfLife({
      ...PAPER_CALIBRATION_2026,
      adoptionShare: 0.2,
    }).halfLifeMonths;
    expect(secondLife).toBeLessThan(untouched);
    expect(cascade.survivors).toHaveLength(0);
  });

  test("the adoption level that maximises price discovery sits above the one that minimises fragility", () => {
    const tradeoff = fragilityEfficiencyTradeoff(PAPER_CALIBRATION_2026);
    expect(tradeoff.efficientExceedsSafe).toBe(true);
    expect(tradeoff.gap).toBeGreaterThan(0);
    expect(tradeoff.discoveryMaximisingAdoption).toBeGreaterThan(
      tradeoff.fragilityMinimisingAdoption,
    );
    expect(tradeoff.caveat).toContain("illustrative");
  });
});
