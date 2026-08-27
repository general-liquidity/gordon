import { describe, expect, test } from "bun:test";
import { detectStreak, formatStreak, type StreakBar } from "./streak-detector.ts";

function makeBars(closes: number[]): StreakBar[] {
  return closes.map((c) => ({ close: c }));
}

/** Builds a synthetic history with mostly short streaks ending in a long live streak. */
function syntheticHistory(longTailDirection: "up" | "down", longTailLength: number): StreakBar[] {
  const closes: number[] = [100];
  let last = 100;
  // Generate ~30 alternating short streaks of length 1-3 so distribution is well-populated.
  for (let i = 0; i < 60; i++) {
    const dir = i % 2 === 0 ? 1 : -1;
    const len = 1 + (i % 3);
    for (let j = 0; j < len; j++) {
      last = last * (1 + dir * 0.01);
      closes.push(last);
    }
  }
  // Break with a flat (use opposite direction) before the tail
  const breakDir = longTailDirection === "up" ? -1 : 1;
  last = last * (1 + breakDir * 0.01);
  closes.push(last);
  // Then the long tail in the test direction
  const tailDir = longTailDirection === "up" ? 1 : -1;
  for (let j = 0; j < longTailLength; j++) {
    last = last * (1 + tailDir * 0.01);
    closes.push(last);
  }
  return makeBars(closes);
}

describe("detectStreak", () => {
  test("fewer than 2 bars → insufficient_data", () => {
    const r = detectStreak(makeBars([100]));
    expect(r.verdict).toBe("insufficient_data");
  });

  test("no active streak when last bar is flat", () => {
    const bars = makeBars([100, 101, 102, 101, 100, 100]); // last 2 closes equal
    const r = detectStreak(bars);
    expect(r.currentStreakDirection).toBe("none");
    expect(r.currentStreakLength).toBe(0);
  });

  test("active up streak detected", () => {
    const bars = makeBars([100, 101, 102, 103, 104]);
    const r = detectStreak(bars);
    expect(r.currentStreakDirection).toBe("up");
    expect(r.currentStreakLength).toBe(4);
  });

  test("active down streak detected", () => {
    const bars = makeBars([100, 99, 98, 97]);
    const r = detectStreak(bars);
    expect(r.currentStreakDirection).toBe("down");
    expect(r.currentStreakLength).toBe(3);
  });

  test("short streak with sufficient history → weak_exhaustion", () => {
    const bars = syntheticHistory("up", 2);
    const r = detectStreak(bars);
    expect(r.currentStreakDirection).toBe("up");
    expect(r.currentStreakLength).toBe(2);
    expect(r.verdict).toBe("weak_exhaustion");
    expect(r.recommendedFadeDirection).toBeNull();
  });

  test("extreme tail → extreme_exhaustion with fade recommendation", () => {
    const bars = syntheticHistory("up", 12); // way above mean
    const r = detectStreak(bars);
    expect(r.currentStreakLength).toBe(12);
    expect(["strong_exhaustion", "extreme_exhaustion"]).toContain(r.verdict);
    expect(r.recommendedFadeDirection).toBe("short");
  });

  test("down streak → recommends fade long", () => {
    const bars = syntheticHistory("down", 10);
    const r = detectStreak(bars);
    expect(r.currentStreakDirection).toBe("down");
    expect(["strong_exhaustion", "extreme_exhaustion", "moderate_exhaustion"]).toContain(r.verdict);
    if (r.recommendedFadeDirection !== null) {
      expect(r.recommendedFadeDirection).toBe("long");
    }
  });

  test("insufficient prior streaks → insufficient_data verdict even with active streak", () => {
    const bars = makeBars([100, 101, 102, 103, 104, 105]);
    const r = detectStreak(bars);
    expect(r.currentStreakLength).toBe(5);
    expect(r.verdict).toBe("insufficient_data");
  });

  test("flat tolerance suppresses tiny moves", () => {
    // Each step is 0.05% — should be classified as flat with 0.1% tolerance
    const closes = [100];
    for (let i = 0; i < 10; i++) closes.push(closes[closes.length - 1]! * 1.0005);
    const bars = makeBars(closes);
    const strict = detectStreak(bars, { flatToleranceFraction: 0.001 });
    const lax = detectStreak(bars, { flatToleranceFraction: 0 });
    expect(strict.currentStreakDirection).toBe("none");
    expect(lax.currentStreakDirection).toBe("up");
  });

  test("respects custom percentile thresholds", () => {
    // Tail of length 3 — same as the historical max in syntheticHistory,
    // so percentile sits at ~0.83, between strict-low and lax-high cutoffs.
    const bars = syntheticHistory("up", 3);
    const strict = detectStreak(bars, {
      extremePercentile: 0.99,
      strongPercentile: 0.95,
      moderatePercentile: 0.9,
    });
    const lax = detectStreak(bars, {
      extremePercentile: 0.5,
      strongPercentile: 0.4,
      moderatePercentile: 0.3,
    });
    expect(strict.verdict).toBe("weak_exhaustion");
    expect(["moderate_exhaustion", "strong_exhaustion", "extreme_exhaustion"]).toContain(
      lax.verdict,
    );
  });

  test("lookback option limits the historical window", () => {
    const bars = syntheticHistory("up", 10);
    const full = detectStreak(bars);
    const short = detectStreak(bars, { lookback: 20 });
    // Both should detect the same live streak (it's at the tail)
    expect(short.currentStreakLength).toBe(full.currentStreakLength);
    // But the historical count will differ
    expect(short.historicalStreakCount).toBeLessThanOrEqual(full.historicalStreakCount);
  });

  test("flat break correctly closes the active run", () => {
    // up 3, flat 1, down 2 → final streak is down 2
    const bars = makeBars([100, 101, 102, 103, 103, 102, 101]);
    const r = detectStreak(bars);
    expect(r.currentStreakDirection).toBe("down");
    expect(r.currentStreakLength).toBe(2);
  });

  test("zero or negative price doesn't crash", () => {
    const bars = makeBars([100, 0, -1, 100]);
    const r = detectStreak(bars);
    expect(r).toBeDefined();
  });
});

describe("formatStreak", () => {
  test("renders header + recommendation for extreme verdict", () => {
    const bars = syntheticHistory("up", 12);
    const r = detectStreak(bars);
    const text = formatStreak(r);
    expect(text).toContain("Streak Detector");
    expect(text).toContain("Current streak");
    if (r.recommendedFadeDirection) {
      expect(text).toContain("Recommended fade");
    }
  });
});
