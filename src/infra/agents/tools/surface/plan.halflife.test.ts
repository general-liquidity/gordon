import { describe, expect, test } from "bun:test";

import { assessBacktestWindowDecay, assessPlanDecay, resolveVerifyVerdict } from "./plan.ts";
import {
  computeSignalHalfLife,
  PAPER_CALIBRATION_2026,
} from "../../../../core/alpha/signal-half-life.ts";

const DEFAULT_HALF_LIFE = computeSignalHalfLife(PAPER_CALIBRATION_2026).halfLifeMonths;

describe("backtest window against the edge's own half-life", () => {
  test("a window longer than the half-life is reported as a validity error with an overstatement factor", () => {
    const report = assessBacktestWindowDecay({ backtestWindowMonths: DEFAULT_HALF_LIFE * 4 });

    expect(report.measuresDecayedAverage).toBe(true);
    expect(report.halfLivesInWindow).toBeGreaterThan(1);
    expect(report.overstatementFactor).toBeGreaterThan(1);
    expect(report.headline).not.toBeNull();
    expect(report.headline as string).toContain("DECAY_VALIDITY");
    expect(report.warnings.length).toBeGreaterThan(0);
  });

  test("a window shorter than the half-life is not flagged", () => {
    const report = assessBacktestWindowDecay({ backtestWindowMonths: DEFAULT_HALF_LIFE / 6 });

    expect(report.measuresDecayedAverage).toBe(false);
    expect(report.headline).toBeNull();
    expect(report.warnings.length).toBe(0);
  });

  test("the default half-life is never presented as a measurement", () => {
    expect(assessBacktestWindowDecay({ backtestWindowMonths: 3 }).calibration).toContain(
      "not measured",
    );
    expect(assessPlanDecay({}).calibration).toContain("not measured");
  });

  test("an operator-supplied half-life replaces the model calibration", () => {
    const report = assessBacktestWindowDecay({ backtestWindowMonths: 6 });
    expect(report.halfLifeMonths).toBeCloseTo(DEFAULT_HALF_LIFE, 9);

    const overridden = assessBacktestWindowDecay({ backtestWindowMonths: 6, halfLifeMonths: 2 });
    expect(overridden.halfLifeMonths).toBe(2);
    expect(overridden.measuresDecayedAverage).toBe(true);
    expect(overridden.calibration).toContain("operator");
  });

  test("the same window always yields the same report", () => {
    const first = assessBacktestWindowDecay({ backtestWindowMonths: 40, liveHorizonMonths: 12 });
    const second = assessBacktestWindowDecay({ backtestWindowMonths: 40, liveHorizonMonths: 12 });
    expect(second).toEqual(first);
  });
});

describe("plan edge against its cost floor", () => {
  test("an edge already under its cost floor is surfaced as a reason", () => {
    const decay = assessPlanDecay({ backtestedEdge: 0.4, costFloorEdge: 0.5, horizonMonths: 6 });

    expect(decay.ran).toBe(true);
    expect(decay.alreadyBelowCostFloor).toBe(true);
    expect(decay.warnings.length).toBe(1);
    expect(decay.warnings[0] as string).toContain("EDGE_BELOW_COST_FLOOR");
  });

  test("an edge that decays under its cost floor before the horizon closes is surfaced as a reason", () => {
    const decay = assessPlanDecay({
      backtestedEdge: 1.0,
      costFloorEdge: 0.5,
      horizonMonths: DEFAULT_HALF_LIFE * 2,
    });

    expect(decay.belowFloorWithinHorizon).toBe(true);
    expect(decay.monthsUntilBelowCostFloor).toBeCloseTo(DEFAULT_HALF_LIFE, 6);
    expect(decay.warnings[0] as string).toContain("EDGE_DECAY");
  });

  test("an edge that survives the whole horizon raises no reason", () => {
    const decay = assessPlanDecay({
      backtestedEdge: 2.0,
      costFloorEdge: 0.5,
      horizonMonths: DEFAULT_HALF_LIFE / 4,
    });

    expect(decay.ran).toBe(true);
    expect(decay.belowFloorWithinHorizon).toBe(false);
    expect(decay.warnings.length).toBe(0);
  });

  test("a plan lacking the needed inputs is annotated and never penalised", () => {
    for (const input of [
      {},
      { backtestedEdge: 1.5 },
      { costFloorEdge: 0.5, horizonMonths: 6 },
      { backtestedEdge: 1.5, costFloorEdge: 0.5 },
      { backtestedEdge: 0, costFloorEdge: 0.5, horizonMonths: 6 },
    ]) {
      const decay = assessPlanDecay(input);
      expect(decay.ran).toBe(false);
      expect(decay.warnings.length).toBe(0);
      expect(decay.missingInputs.length).toBeGreaterThan(0);
      expect(decay.note).toContain("did not run");
    }
  });

  test("the annotation names the input that was missing", () => {
    expect(assessPlanDecay({ costFloorEdge: 0.5, horizonMonths: 6 }).missingInputs).toEqual([
      "backtestedEdge",
    ]);
    expect(assessPlanDecay({ backtestedEdge: 1.5, costFloorEdge: 0.5 }).missingInputs).toEqual([
      "horizonMonths",
    ]);
    expect(assessPlanDecay({ backtestedEdge: 1.5, horizonMonths: 6 }).missingInputs).toEqual([
      "costFloorEdge",
    ]);
  });

  test("a zero cost floor is never crossed by decay alone", () => {
    const decay = assessPlanDecay({ backtestedEdge: 1.5, costFloorEdge: 0, horizonMonths: 120 });

    expect(decay.ran).toBe(true);
    expect(decay.monthsUntilBelowCostFloor).toBeNull();
    expect(decay.warnings.length).toBe(0);
  });

  test("the same plan inputs always yield the same assessment", () => {
    const args = { backtestedEdge: 1.2, costFloorEdge: 0.4, horizonMonths: 24 };
    expect(assessPlanDecay(args)).toEqual(assessPlanDecay(args));
  });
});

describe("adding a decay reason can only make a verdict worse", () => {
  const RANK = { approve: 0, conditional: 1, reject: 2 } as const;
  const TIER_RANK = { low: 0, medium: 1, high: 2, critical: 3 } as const;

  test("no combination of inputs improves a verdict when reasons are added", () => {
    for (const hasError of [true, false]) {
      for (const approved of [true, false]) {
        for (let reasonCount = 0; reasonCount < 4; reasonCount += 1) {
          const before = resolveVerifyVerdict({ hasError, approved, reasonCount });
          const after = resolveVerifyVerdict({ hasError, approved, reasonCount: reasonCount + 1 });

          expect(RANK[after.verdict]).toBeGreaterThanOrEqual(RANK[before.verdict]);
          expect(TIER_RANK[after.riskTier]).toBeGreaterThanOrEqual(TIER_RANK[before.riskTier]);
        }
      }
    }
  });

  test("a rejected plan stays rejected however many decay reasons are added", () => {
    expect(resolveVerifyVerdict({ hasError: false, approved: false, reasonCount: 0 }).verdict).toBe(
      "reject",
    );
    expect(resolveVerifyVerdict({ hasError: false, approved: false, reasonCount: 5 }).verdict).toBe(
      "reject",
    );
    expect(resolveVerifyVerdict({ hasError: true, approved: true, reasonCount: 5 }).verdict).toBe(
      "reject",
    );
  });

  test("a missing decay input leaves the verdict exactly as it was", () => {
    const decay = assessPlanDecay({ horizonMonths: 6 });
    const before = resolveVerifyVerdict({ hasError: false, approved: true, reasonCount: 0 });
    const after = resolveVerifyVerdict({
      hasError: false,
      approved: true,
      reasonCount: decay.warnings.length,
    });

    expect(after).toEqual(before);
    expect(after.verdict).toBe("approve");
  });

  test("a decay reason downgrades an otherwise clean plan to conditional, not to reject", () => {
    const decay = assessPlanDecay({ backtestedEdge: 0.4, costFloorEdge: 0.5, horizonMonths: 6 });
    const after = resolveVerifyVerdict({
      hasError: false,
      approved: true,
      reasonCount: decay.warnings.length,
    });

    expect(after.verdict).toBe("conditional");
    expect(after.riskTier).toBe("medium");
  });
});
