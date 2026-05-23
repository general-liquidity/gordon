import { describe, expect, test } from "bun:test";
import {
  computeRegimeDetectionLag,
  formatRegimeLag,
  type RegimeTransition,
} from "./regime-detection-lag.ts";

describe("computeRegimeDetectionLag", () => {
  test("empty ground truth → insufficient_data", () => {
    const r = computeRegimeDetectionLag([], [{ barIndex: 5, regime: "trending" }]);
    expect(r.verdict).toBe("insufficient_data");
    expect(r.spuriousDetections.length).toBe(1);
  });

  test("perfect detection (zero lag) → responsive", () => {
    const gt: RegimeTransition[] = [
      { barIndex: 10, regime: "trending" },
      { barIndex: 50, regime: "ranging" },
      { barIndex: 100, regime: "trending" },
    ];
    const det: RegimeTransition[] = [
      { barIndex: 10, regime: "trending" },
      { barIndex: 50, regime: "ranging" },
      { barIndex: 100, regime: "trending" },
    ];
    const r = computeRegimeDetectionLag(gt, det);
    expect(r.matchedPairs.length).toBe(3);
    expect(r.medianLagBars).toBe(0);
    expect(r.detectionRate).toBe(1);
    expect(r.verdict).toBe("responsive");
  });

  test("small consistent lag (2 bars) → responsive", () => {
    const gt: RegimeTransition[] = [
      { barIndex: 10, regime: "trending" },
      { barIndex: 50, regime: "ranging" },
      { barIndex: 100, regime: "trending" },
    ];
    const det: RegimeTransition[] = [
      { barIndex: 12, regime: "trending" },
      { barIndex: 52, regime: "ranging" },
      { barIndex: 102, regime: "trending" },
    ];
    const r = computeRegimeDetectionLag(gt, det);
    expect(r.matchedPairs.length).toBe(3);
    expect(r.medianLagBars).toBe(2);
    expect(r.verdict).toBe("responsive");
  });

  test("moderate lag (~8 bars) → acceptable", () => {
    const gt: RegimeTransition[] = [
      { barIndex: 10, regime: "trending" },
      { barIndex: 50, regime: "ranging" },
      { barIndex: 100, regime: "trending" },
      { barIndex: 150, regime: "ranging" },
    ];
    const det: RegimeTransition[] = [
      { barIndex: 18, regime: "trending" },
      { barIndex: 58, regime: "ranging" },
      { barIndex: 108, regime: "trending" },
      { barIndex: 158, regime: "ranging" },
    ];
    const r = computeRegimeDetectionLag(gt, det);
    expect(r.medianLagBars).toBe(8);
    expect(r.detectionRate).toBe(1);
    expect(r.verdict).toBe("acceptable");
  });

  test("large lag (~20 bars) → sluggish", () => {
    const gt: RegimeTransition[] = [
      { barIndex: 10, regime: "trending" },
      { barIndex: 50, regime: "ranging" },
      { barIndex: 100, regime: "trending" },
    ];
    const det: RegimeTransition[] = [
      { barIndex: 30, regime: "trending" },
      { barIndex: 70, regime: "ranging" },
      { barIndex: 120, regime: "trending" },
    ];
    const r = computeRegimeDetectionLag(gt, det);
    expect(r.medianLagBars).toBe(20);
    expect(r.verdict).toBe("sluggish");
  });

  test("misses majority of transitions → broken", () => {
    const gt: RegimeTransition[] = [
      { barIndex: 10, regime: "trending" },
      { barIndex: 50, regime: "ranging" },
      { barIndex: 100, regime: "trending" },
      { barIndex: 150, regime: "ranging" },
    ];
    // Only 1 detected — within window
    const det: RegimeTransition[] = [{ barIndex: 13, regime: "trending" }];
    const r = computeRegimeDetectionLag(gt, det);
    expect(r.matchedPairs.length).toBe(1);
    expect(r.missedTransitions.length).toBe(3);
    expect(r.verdict).toBe("broken");
  });

  test("transitions detected outside maxLag count as missed", () => {
    const gt: RegimeTransition[] = [
      { barIndex: 10, regime: "trending" },
      { barIndex: 50, regime: "ranging" },
      { barIndex: 100, regime: "trending" },
    ];
    // Each detected transition lags its corresponding GT by 200 bars
    // (well above default maxLagBars=50).
    const det: RegimeTransition[] = [
      { barIndex: 210, regime: "trending" },
      { barIndex: 250, regime: "ranging" },
      { barIndex: 300, regime: "trending" },
    ];
    const r = computeRegimeDetectionLag(gt, det);
    expect(r.matchedPairs.length).toBe(0);
    expect(r.missedTransitions.length).toBe(3);
    expect(r.spuriousDetections.length).toBe(3);
  });

  test("spurious detections counted as false positives", () => {
    const gt: RegimeTransition[] = [{ barIndex: 10, regime: "trending" }];
    const det: RegimeTransition[] = [
      { barIndex: 10, regime: "trending" }, // matches
      { barIndex: 30, regime: "ranging" }, // spurious
      { barIndex: 60, regime: "ranging" }, // spurious
    ];
    const r = computeRegimeDetectionLag(gt, det);
    expect(r.matchedPairs.length).toBe(1);
    expect(r.spuriousDetections.length).toBe(2);
    expect(r.falsePositiveRate).toBeCloseTo(2 / 3, 3);
  });

  test("detection BEFORE ground truth doesn't count as a match", () => {
    const gt: RegimeTransition[] = [{ barIndex: 50, regime: "trending" }];
    const det: RegimeTransition[] = [{ barIndex: 30, regime: "trending" }];
    const r = computeRegimeDetectionLag(gt, det);
    expect(r.matchedPairs.length).toBe(0);
    expect(r.missedTransitions.length).toBe(1);
    expect(r.spuriousDetections.length).toBe(1);
  });

  test("matching prefers earliest in-window detection (greedy)", () => {
    const gt: RegimeTransition[] = [
      { barIndex: 10, regime: "trending" },
      { barIndex: 30, regime: "trending" },
    ];
    const det: RegimeTransition[] = [
      { barIndex: 15, regime: "trending" },
      { barIndex: 35, regime: "trending" },
    ];
    const r = computeRegimeDetectionLag(gt, det);
    expect(r.matchedPairs.length).toBe(2);
    expect(r.matchedPairs[0]!.lagBars).toBe(5);
    expect(r.matchedPairs[1]!.lagBars).toBe(5);
  });

  test("regime label mismatch prevents a match", () => {
    const gt: RegimeTransition[] = [{ barIndex: 10, regime: "trending" }];
    const det: RegimeTransition[] = [{ barIndex: 11, regime: "ranging" }];
    const r = computeRegimeDetectionLag(gt, det);
    expect(r.matchedPairs.length).toBe(0);
    expect(r.missedTransitions.length).toBe(1);
  });
});

describe("formatRegimeLag", () => {
  test("renders summary header", () => {
    const gt: RegimeTransition[] = [{ barIndex: 10, regime: "trending" }];
    const det: RegimeTransition[] = [{ barIndex: 10, regime: "trending" }];
    const r = computeRegimeDetectionLag(gt, det);
    const text = formatRegimeLag(r);
    expect(text).toContain("Regime-Detection Lag");
    expect(text).toContain("RESPONSIVE");
  });
});
