import { describe, expect, test } from "bun:test";
import { validateScenarioRealism } from "./scenarioRealism.ts";

describe("scenario realism", () => {
  test("rejects insufficient samples", () => {
    expect(validateScenarioRealism([0.1]).realistic).toBe(false);
  });

  test("reports finite stylized-fact diagnostics", () => {
    const returns = [0.01, 0.012, -0.008, -0.09, -0.04, 0.03, 0.025, -0.01, 0.005];
    const result = validateScenarioRealism(returns);
    expect(Number.isFinite(result.excessKurtosis)).toBe(true);
    expect(Number.isFinite(result.absoluteReturnAutocorrelation)).toBe(true);
  });

  test("requires all three stylized facts for acceptance", () => {
    const withoutLeverage = [0.01, 0.012, 0.011, 0.1, 0.09, 0.08, -0.01, -0.012];
    const result = validateScenarioRealism(withoutLeverage);
    expect(result.realistic).toBe(
      result.fatTails && result.volatilityClustering && result.leverageEffect,
    );
  });
});
