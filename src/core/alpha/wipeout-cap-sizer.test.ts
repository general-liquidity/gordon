import { describe, expect, test } from "bun:test";
import { sizeWithWipeoutCap, formatWipeoutCap } from "./wipeout-cap-sizer.ts";

describe("sizeWithWipeoutCap", () => {
  test("100% wipeout probability → position = maxBookLoss", () => {
    const r = sizeWithWipeoutCap({
      expectedYield: 0.50,
      wipeoutProbability: 1.0,
    });
    expect(r.verdict).toBe("sized");
    expect(r.positionFraction).toBeCloseTo(0.01, 5); // default maxBookLoss
    expect(r.worstCaseBookLoss).toBeCloseTo(0.01, 5);
  });

  test("10% wipeout probability → position = 10x maxBookLoss = 10% of book", () => {
    const r = sizeWithWipeoutCap({
      expectedYield: 0.30,
      wipeoutProbability: 0.10,
    });
    expect(r.positionFraction).toBeCloseTo(0.10, 5);
  });

  test("very low wipeout probability → clamped by maxPositionFraction", () => {
    const r = sizeWithWipeoutCap({
      expectedYield: 0.10,
      wipeoutProbability: 0.001,
      maxPositionFraction: 0.20,
    });
    expect(r.positionFraction).toBe(0.20);
  });

  test("custom maxBookLoss respected", () => {
    const r = sizeWithWipeoutCap({
      expectedYield: 0.20,
      wipeoutProbability: 0.50,
      maxBookLossFraction: 0.02,
    });
    expect(r.positionFraction).toBeCloseTo(0.04, 5);
  });

  test("invalid wipeout probability → invalid_inputs", () => {
    const r = sizeWithWipeoutCap({
      expectedYield: 0.20,
      wipeoutProbability: 1.5,
    });
    expect(r.verdict).toBe("invalid_inputs");
  });

  test("invalid maxBookLoss → invalid_inputs", () => {
    const r = sizeWithWipeoutCap({
      expectedYield: 0.20,
      wipeoutProbability: 0.10,
      maxBookLossFraction: 0,
    });
    expect(r.verdict).toBe("invalid_inputs");
  });

  test("expected book return computed correctly", () => {
    const r = sizeWithWipeoutCap({
      expectedYield: 0.20,
      wipeoutProbability: 0.10,
    });
    // position = 0.10, expected yield on position = 0.9 * 0.20 - 0.10 * 1 = 0.08
    // expected book return = 0.10 * 0.08 = 0.008
    expect(r.expectedYieldOnPosition).toBeCloseTo(0.08, 5);
    expect(r.expectedBookReturn).toBeCloseTo(0.008, 5);
  });

  test("negative EV detected (high wipeout prob + low yield)", () => {
    const r = sizeWithWipeoutCap({
      expectedYield: 0.05,
      wipeoutProbability: 0.50,
    });
    // position = 0.02 (cap), expected yield on pos = 0.5 * 0.05 - 0.5 * 1 = -0.475
    // book return = 0.02 * -0.475 = -0.0095
    expect(r.netEv).toBeLessThan(0);
  });

  test("below_minimum verdict when computed size < minPositionFraction", () => {
    const r = sizeWithWipeoutCap({
      expectedYield: 0.10,
      wipeoutProbability: 1.0, // forces position = 1%
      minPositionFraction: 0.05,
    });
    expect(r.verdict).toBe("below_minimum");
    expect(r.positionFraction).toBe(0);
  });

  test("Drogan example: 100% APR longtail bet at 100% wipeout → 1% position", () => {
    // The article example: "theoretically that's a 1% position. We could
    // lose the whole thing. But that yield is probably going to be north
    // of 80-100% APR."
    const r = sizeWithWipeoutCap({
      expectedYield: 1.0,
      wipeoutProbability: 1.0,
    });
    expect(r.positionFraction).toBeCloseTo(0.01, 5);
  });

  test("Drogan example: morpho-vault safe play → near-max position", () => {
    // "Would we be willing to put 100% of our capital into a very basic
    // morpho vault? Yes, we would. The probability that that thing is
    // gonna go to zero is infintesimally small."
    const r = sizeWithWipeoutCap({
      expectedYield: 0.05,
      wipeoutProbability: 0.0001,
    });
    expect(r.positionFraction).toBe(1.0); // hits maxPositionFraction
  });

  test("position size scales inversely with wipeout probability", () => {
    const halfRisk = sizeWithWipeoutCap({
      expectedYield: 0.20,
      wipeoutProbability: 0.20,
    });
    const tenthRisk = sizeWithWipeoutCap({
      expectedYield: 0.20,
      wipeoutProbability: 0.02,
    });
    expect(tenthRisk.positionFraction).toBeGreaterThan(halfRisk.positionFraction);
  });
});

describe("formatWipeoutCap", () => {
  test("renders summary and warning on negative EV", () => {
    const r = sizeWithWipeoutCap({
      expectedYield: 0.05,
      wipeoutProbability: 0.80,
    });
    const text = formatWipeoutCap(r);
    expect(text).toContain("Wipeout-Cap Sizer");
    if (r.netEv < 0) {
      expect(text).toContain("Net EV is negative");
    }
  });

  test("clean output on standard case", () => {
    const r = sizeWithWipeoutCap({
      expectedYield: 0.30,
      wipeoutProbability: 0.10,
    });
    const text = formatWipeoutCap(r);
    expect(text).toContain("SIZED");
    expect(text).toContain("10.00%");
  });
});
