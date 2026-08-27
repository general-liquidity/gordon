import { describe, it, expect } from "bun:test";
import {
  computeTimeBasedExit,
  timeBasedExitToPayload,
  isTimeBasedExitEnabled,
  TIME_BASED_EXIT_FLAG_ENV,
} from "./timeBasedExit.ts";

describe("isTimeBasedExitEnabled", () => {
  it("respects the flag", () => {
    expect(isTimeBasedExitEnabled({})).toBe(false);
    expect(isTimeBasedExitEnabled({ [TIME_BASED_EXIT_FLAG_ENV]: "1" })).toBe(true);
  });
});

describe("computeTimeBasedExit — validation", () => {
  it("rejects negative time-in-trade", () => {
    expect(() => computeTimeBasedExit({ timeInTrade: -1, avgWinningDuration: 60 })).toThrow();
  });

  it("rejects non-positive avg-winning-duration", () => {
    expect(() => computeTimeBasedExit({ timeInTrade: 60, avgWinningDuration: 0 })).toThrow();
  });

  it("rejects thresholdMultiplier ≤ 1", () => {
    expect(() =>
      computeTimeBasedExit({
        timeInTrade: 60,
        avgWinningDuration: 60,
        thresholdMultiplier: 1,
      }),
    ).toThrow();
    expect(() =>
      computeTimeBasedExit({
        timeInTrade: 60,
        avgWinningDuration: 60,
        thresholdMultiplier: 0.5,
      }),
    ).toThrow();
  });
});

describe("computeTimeBasedExit — verdict logic", () => {
  it("ratio < threshold → hold", () => {
    const r = computeTimeBasedExit({
      timeInTrade: 60,
      avgWinningDuration: 60,
      thresholdMultiplier: 5,
    });
    expect(r.durationRatio).toBe(1);
    expect(r.verdict).toBe("hold");
    expect(r.thresholdCrossed).toBe(false);
  });

  it("ratio = threshold exactly → cut", () => {
    const r = computeTimeBasedExit({
      timeInTrade: 300,
      avgWinningDuration: 60,
      thresholdMultiplier: 5,
    });
    expect(r.durationRatio).toBe(5);
    expect(r.thresholdCrossed).toBe(true);
    expect(r.verdict).toBe("cut");
  });

  it("ratio > threshold → cut", () => {
    const r = computeTimeBasedExit({
      timeInTrade: 600,
      avgWinningDuration: 60,
      thresholdMultiplier: 5,
    });
    expect(r.durationRatio).toBe(10);
    expect(r.thresholdCrossed).toBe(true);
    expect(r.verdict).toBe("cut");
  });

  it("ratio slightly below threshold → hold", () => {
    const r = computeTimeBasedExit({
      timeInTrade: 299,
      avgWinningDuration: 60,
      thresholdMultiplier: 5,
    });
    expect(r.durationRatio).toBeLessThan(5);
    expect(r.verdict).toBe("hold");
  });
});

describe("computeTimeBasedExit — defaults", () => {
  it("uses thresholdMultiplier = 5 by default", () => {
    const r = computeTimeBasedExit({
      timeInTrade: 300,
      avgWinningDuration: 60,
    });
    expect(r.thresholdMultiplier).toBe(5);
    expect(r.verdict).toBe("cut");
  });
});

describe("computeTimeBasedExit — unit-agnostic", () => {
  it("works with seconds, minutes, or ms — only the ratio matters", () => {
    // seconds
    const r1 = computeTimeBasedExit({
      timeInTrade: 600,
      avgWinningDuration: 100,
    });
    // minutes (same ratio)
    const r2 = computeTimeBasedExit({
      timeInTrade: 10,
      avgWinningDuration: 100 / 60,
    });
    expect(r1.durationRatio).toBeCloseTo(r2.durationRatio, 4);
    expect(r1.verdict).toBe(r2.verdict);
  });
});

describe("timeBasedExitToPayload", () => {
  it("emits stable shape", () => {
    const r = computeTimeBasedExit({
      timeInTrade: 300,
      avgWinningDuration: 60,
    });
    const p = timeBasedExitToPayload(r) as {
      kind: string;
      durationRatio: number;
      verdict: string;
    };
    expect(p.kind).toBe("time_based_exit.computed");
    expect(p.verdict).toBe("cut");
  });
});
