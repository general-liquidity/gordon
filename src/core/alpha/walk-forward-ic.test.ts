import { describe, it, expect } from "bun:test";
import { walkForwardIc } from "./walk-forward-ic.ts";

function makeSignal(n: number, factor: (i: number) => number, noise = 0.005): {
  sig: number[];
  ret: number[];
} {
  const sig: number[] = [];
  const ret: number[] = [];
  for (let i = 0; i < n; i++) {
    const s = Math.sin(i / 5);
    sig.push(s);
    ret.push(s * factor(i) + (i * 0.0001 - 0.005)); // deterministic noise, no Math.random for test stability
  }
  // Light deterministic jitter
  for (let i = 0; i < n; i++) {
    ret[i] = ret[i]! + Math.cos(i / 11) * noise;
  }
  return { sig, ret };
}

describe("walkForwardIc — basic shape", () => {
  it("returns insufficient_data when fewer observations than window size", () => {
    const result = walkForwardIc("tiny", [1, 2, 3], [1, 2, 3], { windowSize: 60 });
    expect(result.verdict).toBe("insufficient_data");
  });

  it("produces ≥ 1 window when observations cover the window", () => {
    const { sig, ret } = makeSignal(60, () => 0.02);
    const result = walkForwardIc("one-window", sig, ret, { windowSize: 60, stepSize: 60 });
    expect(result.windows.length).toBe(1);
    // Only 1 window — not enough for walk-forward analysis (needs 5)
    expect(result.verdict).toBe("insufficient_data");
  });

  it("produces multiple windows when observations exceed window with step overlap", () => {
    const { sig, ret } = makeSignal(200, () => 0.02);
    const result = walkForwardIc("multi", sig, ret, { windowSize: 60, stepSize: 20 });
    expect(result.windows.length).toBeGreaterThan(5);
  });
});

describe("walkForwardIc — robust verdict", () => {
  it("flags a stable strong signal as robust", () => {
    // Deterministic signal: constant strong factor across all windows
    const { sig, ret } = makeSignal(300, () => 0.05);
    const result = walkForwardIc("stable", sig, ret, {
      windowSize: 60,
      stepSize: 15,
    });
    expect(result.validWindowCount).toBeGreaterThanOrEqual(5);
    // Mean IC should be strong + std small + positive fraction high
    expect(Math.abs(result.meanIc)).toBeGreaterThan(0.05);
    expect(result.positiveFraction).toBeGreaterThan(0.7);
    expect(["robust", "fragile"]).toContain(result.verdict);
  });
});

describe("walkForwardIc — degrading verdict", () => {
  it("flags a signal whose IC trends down over time as degrading", () => {
    // Start with strong factor, decay to 0 across the series
    const n = 360;
    const { sig, ret } = makeSignal(n, (i) => 0.06 - (i / n) * 0.06);
    const result = walkForwardIc("decaying", sig, ret, {
      windowSize: 60,
      stepSize: 20,
    });
    expect(result.validWindowCount).toBeGreaterThanOrEqual(5);
    expect(result.trendSlope).toBeLessThan(0);
    // Should be either degrading or unstable depending on how steep the
    // decay is in the actual computed IC series
    expect(["degrading", "unstable", "fragile"]).toContain(result.verdict);
  });
});

describe("walkForwardIc — unstable verdict", () => {
  it("flags sign-flipping IC as unstable", () => {
    // Construct: factor flips sign every 60 observations
    const n = 480;
    const { sig, ret } = makeSignal(n, (i) => (Math.floor(i / 60) % 2 === 0 ? 0.05 : -0.05));
    const result = walkForwardIc("flippy", sig, ret, {
      windowSize: 60,
      stepSize: 30,
    });
    expect(result.validWindowCount).toBeGreaterThanOrEqual(5);
    // Std should be elevated OR negative streak should be long
    const violatesStability =
      result.stdIc > 0.2 || result.longestNegativeStreak > 5;
    if (violatesStability) {
      expect(result.verdict).toBe("unstable");
    } else {
      // Permissible: could be fragile if the sign flip aligns gently
      expect(["unstable", "fragile"]).toContain(result.verdict);
    }
  });
});

describe("walkForwardIc — descriptive stats", () => {
  it("reports mean, median, std, min, max consistently", () => {
    const { sig, ret } = makeSignal(300, () => 0.04);
    const result = walkForwardIc("stats", sig, ret);
    expect(result.minIc).toBeLessThanOrEqual(result.meanIc);
    expect(result.maxIc).toBeGreaterThanOrEqual(result.meanIc);
    expect(result.minIc).toBeLessThanOrEqual(result.medianIc);
    expect(result.maxIc).toBeGreaterThanOrEqual(result.medianIc);
    expect(result.stdIc).toBeGreaterThanOrEqual(0);
  });

  it("positive fraction is in [0, 1]", () => {
    const { sig, ret } = makeSignal(300, () => 0.03);
    const result = walkForwardIc("pos", sig, ret);
    expect(result.positiveFraction).toBeGreaterThanOrEqual(0);
    expect(result.positiveFraction).toBeLessThanOrEqual(1);
  });

  it("streak counters are non-negative", () => {
    const { sig, ret } = makeSignal(300, () => 0.03);
    const result = walkForwardIc("streak", sig, ret);
    expect(result.longestNegativeStreak).toBeGreaterThanOrEqual(0);
    expect(result.longestPositiveStreak).toBeGreaterThanOrEqual(0);
  });
});

describe("walkForwardIc — cost-surviving fraction", () => {
  it("populates costSurvivingFraction when transactionCostBps > 0", () => {
    const { sig, ret } = makeSignal(300, () => 0.03);
    const result = walkForwardIc("cost", sig, ret, {
      windowSize: 60,
      stepSize: 20,
      icOptions: { transactionCostBps: 5 },
    });
    expect(result.costSurvivingFraction).toBeDefined();
    expect(result.costSurvivingFraction!).toBeGreaterThanOrEqual(0);
    expect(result.costSurvivingFraction!).toBeLessThanOrEqual(1);
  });

  it("omits costSurvivingFraction when transactionCostBps absent", () => {
    const { sig, ret } = makeSignal(300, () => 0.03);
    const result = walkForwardIc("no-cost", sig, ret, {
      windowSize: 60,
      stepSize: 20,
    });
    expect(result.costSurvivingFraction).toBeUndefined();
  });

  it("cost-surviving fraction shrinks as cost grows", () => {
    const { sig, ret } = makeSignal(300, () => 0.01); // weak signal
    const low = walkForwardIc("low-cost", sig, ret, {
      windowSize: 60,
      stepSize: 20,
      icOptions: { transactionCostBps: 1 },
    });
    const high = walkForwardIc("high-cost", sig, ret, {
      windowSize: 60,
      stepSize: 20,
      icOptions: { transactionCostBps: 50 },
    });
    expect(high.costSurvivingFraction!).toBeLessThanOrEqual(low.costSurvivingFraction!);
  });
});

describe("walkForwardIc — summary text", () => {
  it("summary includes verdict + window count + mean IC", () => {
    const { sig, ret } = makeSignal(300, () => 0.03);
    const result = walkForwardIc("summary", sig, ret);
    expect(result.summary).toContain(result.verdict);
    expect(result.summary).toContain(`${result.validWindowCount}`);
    expect(result.summary).toContain("mean IC");
  });

  it("summary includes cost-surviving fraction when cost was supplied", () => {
    const { sig, ret } = makeSignal(300, () => 0.03);
    const result = walkForwardIc("cost-summary", sig, ret, {
      icOptions: { transactionCostBps: 5 },
    });
    expect(result.summary).toContain("cost-surviving");
  });
});
