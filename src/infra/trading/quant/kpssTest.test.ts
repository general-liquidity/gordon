import { test, expect, describe } from "bun:test";
import { runKpssTest } from "./kpssTest.ts";

function seededRand(seed: number): () => number {
  let s = seed;
  return () => {
    s = (1103515245 * s + 12345) % 2147483648;
    return s / 2147483648 - 0.5;
  };
}

describe("KPSS test", () => {
  test("MATH-ANCHOR: level critical values are KPSS (1992) Table 1", () => {
    const r = runKpssTest({
      series: Array.from({ length: 50 }, (_, i) => Math.sin(i)),
      regression: "c",
    });
    expect(r.criticalValues[0.1]).toBe(0.347);
    expect(r.criticalValues[0.05]).toBe(0.463);
    expect(r.criticalValues[0.025]).toBe(0.574);
    expect(r.criticalValues[0.01]).toBe(0.739);
  });

  test("trend critical values differ from level", () => {
    const r = runKpssTest({
      series: Array.from({ length: 50 }, (_, i) => i + Math.sin(i)),
      regression: "ct",
    });
    expect(r.criticalValues[0.05]).toBe(0.146);
  });

  test("stationary (white-noise) series: fail to reject H0 stationarity", () => {
    const rand = seededRand(7);
    const series = Array.from({ length: 300 }, () => rand());
    const r = runKpssTest({ series, regression: "c" });
    expect(r.verdict).toBe("stationary");
    expect(r.testStatistic).toBeLessThan(r.criticalValue);
  });

  test("random-walk series: reject H0 → non-stationary", () => {
    const rand = seededRand(13);
    const rw: number[] = [0];
    for (let i = 1; i < 300; i++) rw.push(rw[i - 1]! + rand());
    const r = runKpssTest({ series: rw, regression: "c" });
    expect(r.verdict).toBe("non_stationary");
    expect(r.testStatistic).toBeGreaterThan(r.criticalValue);
  });

  test("trend variant: a clean linear trend is trend-stationary", () => {
    const rand = seededRand(21);
    // Deterministic trend + small stationary noise → trend-stationary.
    const series = Array.from({ length: 300 }, (_, i) => 0.5 * i + rand());
    const r = runKpssTest({ series, regression: "ct" });
    expect(r.verdict).toBe("stationary");
  });

  test("trend variant flags a pure trend as non-stationary under level spec", () => {
    const rand = seededRand(21);
    const series = Array.from({ length: 300 }, (_, i) => 0.5 * i + rand());
    // Under the LEVEL spec the same trending series should reject stationarity.
    const r = runKpssTest({ series, regression: "c" });
    expect(r.verdict).toBe("non_stationary");
  });

  test("default Schwert lag truncation is applied", () => {
    const series = Array.from({ length: 100 }, (_, i) => Math.sin(i / 3));
    const r = runKpssTest({ series });
    // floor(4*(100/100)^0.25) = 4.
    expect(r.lags).toBe(4);
  });

  test("null-on-missing: short series → insufficient_data", () => {
    const r = runKpssTest({ series: [1, 2, 3] });
    expect(r.verdict).toBe("insufficient_data");
    expect(Number.isNaN(r.testStatistic)).toBe(true);
  });
});
