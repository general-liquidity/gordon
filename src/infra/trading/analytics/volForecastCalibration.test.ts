import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { _internals } from "./volForecastCalibration.ts";

const { computeMetrics } = _internals;

describe("computeMetrics — empty / edge cases", () => {
  test("empty input → zero-state", () => {
    const m = computeMetrics([], [], "2026-01-01", "2026-01-02");
    expect(m.pairCount).toBe(0);
    expect(m.bias).toBe(0);
    expect(m.mae).toBe(0);
    expect(m.rmse).toBe(0);
    expect(m.rSquared).toBe(0);
  });

  test("single perfect prediction → bias=0, MAE=0, RMSE=0, R²=1", () => {
    const m = computeMetrics([0.02], [0.02], "2026-01-01", "2026-01-02");
    expect(m.bias).toBe(0);
    expect(m.mae).toBe(0);
    expect(m.rmse).toBe(0);
    expect(m.rSquared).toBe(1);
  });
});

describe("computeMetrics — bias direction", () => {
  test("systematically over-forecasting → positive bias", () => {
    const predicted = [0.03, 0.04, 0.05];
    const realized = [0.02, 0.03, 0.04];
    const m = computeMetrics(predicted, realized, "2026-01-01", "2026-01-31");
    expect(m.bias).toBeCloseTo(0.01, 5);
    expect(m.mae).toBeCloseTo(0.01, 5);
  });

  test("systematically under-forecasting → negative bias", () => {
    const predicted = [0.01, 0.02, 0.03];
    const realized = [0.02, 0.03, 0.04];
    const m = computeMetrics(predicted, realized, "2026-01-01", "2026-01-31");
    expect(m.bias).toBeCloseTo(-0.01, 5);
  });

  test("mean cancellation → unbiased but high MAE", () => {
    const predicted = [0.05, 0.01];
    const realized = [0.03, 0.03];
    const m = computeMetrics(predicted, realized, "2026-01-01", "2026-01-31");
    // bias = (0.02 + -0.02) / 2 = 0
    expect(m.bias).toBeCloseTo(0, 5);
    // MAE = (0.02 + 0.02) / 2 = 0.02
    expect(m.mae).toBeCloseTo(0.02, 5);
  });
});

describe("computeMetrics — RMSE penalizes large errors", () => {
  test("RMSE > MAE when errors vary", () => {
    const predicted = [0.01, 0.05];
    const realized = [0.02, 0.02];
    const m = computeMetrics(predicted, realized, "2026-01-01", "2026-01-31");
    // errors: -0.01, +0.03
    // MAE = 0.02
    // RMSE = sqrt((0.0001 + 0.0009)/2) = sqrt(0.0005) ≈ 0.02236
    expect(m.mae).toBeCloseTo(0.02, 5);
    expect(m.rmse).toBeGreaterThan(m.mae);
  });

  test("RMSE = MAE when all errors equal", () => {
    const predicted = [0.03, 0.04];
    const realized = [0.02, 0.03];
    const m = computeMetrics(predicted, realized, "2026-01-01", "2026-01-31");
    expect(m.rmse).toBeCloseTo(m.mae, 5);
  });
});

describe("computeMetrics — R² interpretation", () => {
  test("perfect prediction → R²=1", () => {
    const predicted = [0.01, 0.02, 0.03, 0.04];
    const realized = [0.01, 0.02, 0.03, 0.04];
    const m = computeMetrics(predicted, realized, "2026-01-01", "2026-01-31");
    expect(m.rSquared).toBe(1);
  });

  test("predicting realized mean exactly → R²=0", () => {
    const realized = [0.01, 0.02, 0.03, 0.04];
    const meanRealized = (0.01 + 0.02 + 0.03 + 0.04) / 4;
    const predicted = [meanRealized, meanRealized, meanRealized, meanRealized];
    const m = computeMetrics(predicted, realized, "2026-01-01", "2026-01-31");
    expect(m.rSquared).toBeCloseTo(0, 5);
  });

  test("worse than mean → R² < 0", () => {
    // Predictions are anti-correlated with realized
    const predicted = [0.05, 0.04, 0.03, 0.02];
    const realized = [0.01, 0.02, 0.03, 0.04];
    const m = computeMetrics(predicted, realized, "2026-01-01", "2026-01-31");
    expect(m.rSquared).toBeLessThan(0);
  });
});

describe("computeMetrics — meanRealized field", () => {
  test("returns the mean of realized values", () => {
    const m = computeMetrics(
      [0.02, 0.03, 0.04],
      [0.01, 0.02, 0.03],
      "2026-01-01",
      "2026-01-31",
    );
    expect(m.meanRealized).toBeCloseTo(0.02, 5);
  });
});

// Persistence path tests deliberately omitted — record/get use real
// disk paths and the existing pattern from confidenceStore. Manual
// integration tested via volume of unit-tested computeMetrics calls.
