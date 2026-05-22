import { describe, it, expect } from "bun:test";
import {
  checkTooGoodToBeTrue,
  formatTooGoodCheck,
} from "./too-good-check.ts";

describe("checkTooGoodToBeTrue — verdict cascade", () => {
  it("returns plausible when no inputs are supplied", () => {
    const result = checkTooGoodToBeTrue({});
    expect(result.verdict).toBe("plausible");
    expect(result.trippedChecks).toEqual([]);
  });

  it("returns plausible when all inputs are within normal bounds", () => {
    const result = checkTooGoodToBeTrue({
      sharpe: 1.2,
      ic: 0.08,
      winRate: 0.55,
      maxDrawdown: 0.12,
      observationPeriods: 250,
    });
    expect(result.verdict).toBe("plausible");
  });

  it("returns suspicious when one suspicious check trips", () => {
    const result = checkTooGoodToBeTrue({ sharpe: 3.5 });
    expect(result.verdict).toBe("suspicious");
    expect(result.trippedChecks.length).toBe(1);
    expect(result.trippedChecks[0]!.severity).toBe("suspicious");
  });

  it("returns too_good_to_be_true when one catastrophic check trips", () => {
    const result = checkTooGoodToBeTrue({ sharpe: 6 });
    expect(result.verdict).toBe("too_good_to_be_true");
  });

  it("worst severity wins when multiple checks trip", () => {
    const result = checkTooGoodToBeTrue({
      sharpe: 3.5, // suspicious
      ic: 0.4, // catastrophic
    });
    expect(result.verdict).toBe("too_good_to_be_true");
    expect(result.trippedChecks.length).toBe(2);
  });
});

describe("checkTooGoodToBeTrue — individual checks", () => {
  it("Sharpe ≥ catastrophic threshold trips catastrophic", () => {
    const result = checkTooGoodToBeTrue({ sharpe: 5.5 });
    const trip = result.trippedChecks[0]!;
    expect(trip.check).toBe("sharpe");
    expect(trip.severity).toBe("catastrophic");
    expect(trip.reason).toContain("data leak");
  });

  it("Sharpe between suspicious and catastrophic trips suspicious", () => {
    const result = checkTooGoodToBeTrue({ sharpe: 3.5 });
    expect(result.trippedChecks[0]!.severity).toBe("suspicious");
  });

  it("|IC| trips on absolute value (handles negative IC)", () => {
    const positive = checkTooGoodToBeTrue({ ic: 0.35 });
    const negative = checkTooGoodToBeTrue({ ic: -0.35 });
    expect(positive.verdict).toBe("too_good_to_be_true");
    expect(negative.verdict).toBe("too_good_to_be_true");
  });

  it("IR trips at institutional threshold", () => {
    const result = checkTooGoodToBeTrue({ ir: 3.5 });
    expect(result.trippedChecks[0]!.severity).toBe("catastrophic");
    expect(result.trippedChecks[0]!.reason).toContain("institutional");
  });

  it("win rate ≥ 0.95 trips catastrophic", () => {
    const result = checkTooGoodToBeTrue({ winRate: 0.97 });
    expect(result.trippedChecks[0]!.severity).toBe("catastrophic");
    expect(result.trippedChecks[0]!.reason).toContain("survivorship");
  });

  it("annualized return ≥ 300% trips catastrophic", () => {
    const result = checkTooGoodToBeTrue({ annualizedReturn: 4 });
    expect(result.trippedChecks[0]!.severity).toBe("catastrophic");
    expect(result.trippedChecks[0]!.reason).toContain("compounding");
  });
});

describe("checkTooGoodToBeTrue — max drawdown sample-size gate", () => {
  it("max DD check is SKIPPED when observation count below threshold", () => {
    const result = checkTooGoodToBeTrue({
      maxDrawdown: 0.001, // very low DD
      observationPeriods: 50, // below default 100 minimum
    });
    // Small sample → DD check ignored, no trip
    expect(result.trippedChecks.find((t) => t.check === "maxDrawdown")).toBeUndefined();
  });

  it("max DD check trips when observation count is sufficient", () => {
    const result = checkTooGoodToBeTrue({
      maxDrawdown: 0.001, // tiny DD
      observationPeriods: 500, // well above minimum
    });
    const trip = result.trippedChecks.find((t) => t.check === "maxDrawdown")!;
    expect(trip).toBeDefined();
    expect(trip.severity).toBe("catastrophic");
  });

  it("max DD check runs by default when observationPeriods is omitted", () => {
    const result = checkTooGoodToBeTrue({ maxDrawdown: 0.001 });
    expect(result.trippedChecks.find((t) => t.check === "maxDrawdown")).toBeDefined();
  });
});

describe("checkTooGoodToBeTrue — non-finite inputs", () => {
  it("ignores NaN", () => {
    const result = checkTooGoodToBeTrue({ sharpe: NaN, ic: NaN });
    expect(result.verdict).toBe("plausible");
  });

  it("ignores Infinity", () => {
    const result = checkTooGoodToBeTrue({ sharpe: Infinity });
    expect(result.verdict).toBe("plausible");
  });

  it("ignores undefined (skip path)", () => {
    const result = checkTooGoodToBeTrue({});
    expect(result.verdict).toBe("plausible");
  });
});

describe("checkTooGoodToBeTrue — custom thresholds", () => {
  it("respects custom Sharpe thresholds", () => {
    const strict = checkTooGoodToBeTrue(
      { sharpe: 1.5 },
      { suspiciousSharpe: 1.0, catastrophicSharpe: 2.0 },
    );
    expect(strict.verdict).toBe("suspicious");

    const lax = checkTooGoodToBeTrue(
      { sharpe: 4 },
      { suspiciousSharpe: 10, catastrophicSharpe: 20 },
    );
    expect(lax.verdict).toBe("plausible");
  });

  it("respects custom IC thresholds", () => {
    const result = checkTooGoodToBeTrue(
      { ic: 0.08 },
      { suspiciousIc: 0.05, catastrophicIc: 0.10 },
    );
    expect(result.verdict).toBe("suspicious");
  });

  it("respects custom maxDrawdown thresholds", () => {
    const result = checkTooGoodToBeTrue(
      { maxDrawdown: 0.05, observationPeriods: 500 },
      { suspiciousMaxDD: 0.10, catastrophicMaxDD: 0.07 },
    );
    expect(result.verdict).toBe("too_good_to_be_true");
  });
});

describe("checkTooGoodToBeTrue — summary text", () => {
  it("plausible summary mentions all checks pass", () => {
    const result = checkTooGoodToBeTrue({ sharpe: 1.0 });
    expect(result.summary).toContain("all diagnostic checks pass");
  });

  it("suspicious summary lists tripped checks", () => {
    const result = checkTooGoodToBeTrue({ sharpe: 3.5, ic: 0.22 });
    expect(result.summary).toContain("SUSPICIOUS");
    expect(result.summary).toContain("sharpe");
    expect(result.summary).toContain("ic");
  });

  it("catastrophic summary calls out the verdict", () => {
    const result = checkTooGoodToBeTrue({ sharpe: 6 });
    expect(result.summary).toContain("TOO_GOOD_TO_BE_TRUE");
  });
});

describe("formatTooGoodCheck", () => {
  it("renders PLAUSIBLE status with no tripped checks", () => {
    const text = formatTooGoodCheck(checkTooGoodToBeTrue({ sharpe: 1 }));
    expect(text).toContain("PLAUSIBLE");
    expect(text).toContain("All checks within plausible bounds");
  });

  it("renders SUSPICIOUS with reason text", () => {
    const text = formatTooGoodCheck(checkTooGoodToBeTrue({ sharpe: 3.5 }));
    expect(text).toContain("SUSPICIOUS");
    expect(text).toContain("sharpe");
  });

  it("renders TOO GOOD TO BE TRUE with multiple checks", () => {
    const text = formatTooGoodCheck(
      checkTooGoodToBeTrue({ sharpe: 6, ic: 0.4, winRate: 0.99 }),
    );
    expect(text).toContain("TOO GOOD TO BE TRUE");
    expect(text).toContain("CATASTROPHIC");
  });
});
