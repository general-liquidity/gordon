import { describe, it, expect } from "bun:test";
import {
  computeHotStreakSizing,
  hotStreakSizerToPayload,
  isHotStreakSizerEnabled,
  HOT_STREAK_SIZER_FLAG_ENV,
} from "./hotStreakSizer.ts";

describe("isHotStreakSizerEnabled", () => {
  it("respects the flag", () => {
    expect(isHotStreakSizerEnabled({})).toBe(false);
    expect(isHotStreakSizerEnabled({ [HOT_STREAK_SIZER_FLAG_ENV]: "1" })).toBe(true);
  });
});

describe("computeHotStreakSizing — validation", () => {
  it("rejects non-finite P&L", () => {
    expect(() =>
      computeHotStreakSizing({ recentRealizedPnLPct: NaN }),
    ).toThrow();
    expect(() =>
      computeHotStreakSizing({ recentRealizedPnLPct: Infinity }),
    ).toThrow();
  });

  it("rejects non-positive hotThresholdPct", () => {
    expect(() =>
      computeHotStreakSizing({ recentRealizedPnLPct: 0.1, hotThresholdPct: 0 }),
    ).toThrow();
  });

  it("rejects non-negative coolThresholdPct", () => {
    expect(() =>
      computeHotStreakSizing({ recentRealizedPnLPct: 0.1, coolThresholdPct: 0 }),
    ).toThrow();
  });

  it("rejects maxMultiplier < 1", () => {
    expect(() =>
      computeHotStreakSizing({ recentRealizedPnLPct: 0.1, maxMultiplier: 0.5 }),
    ).toThrow();
  });

  it("rejects negative coldMultiplier", () => {
    expect(() =>
      computeHotStreakSizing({ recentRealizedPnLPct: 0.1, coldMultiplier: -0.1 }),
    ).toThrow();
  });
});

describe("computeHotStreakSizing — classification", () => {
  it("hot at +25% (above default 0.20 threshold)", () => {
    const r = computeHotStreakSizing({ recentRealizedPnLPct: 0.25 });
    expect(r.classification).toBe("hot");
  });

  it("neutral_positive at +5% (below hot threshold, above 0)", () => {
    const r = computeHotStreakSizing({ recentRealizedPnLPct: 0.05 });
    expect(r.classification).toBe("neutral_positive");
  });

  it("neutral_negative at -3% (between cool threshold and 0)", () => {
    const r = computeHotStreakSizing({ recentRealizedPnLPct: -0.03 });
    expect(r.classification).toBe("neutral_negative");
  });

  it("cold at -10% (below default -0.05 threshold)", () => {
    const r = computeHotStreakSizing({ recentRealizedPnLPct: -0.10 });
    expect(r.classification).toBe("cold");
  });

  it("classification is hot exactly at hotThreshold", () => {
    const r = computeHotStreakSizing({ recentRealizedPnLPct: 0.20 });
    expect(r.classification).toBe("hot");
  });
});

describe("computeHotStreakSizing — suggested multiplier", () => {
  it("hot at exactly hotThreshold → 1.0 baseline", () => {
    const r = computeHotStreakSizing({ recentRealizedPnLPct: 0.20 });
    expect(r.suggestedMultiplier).toBeCloseTo(1.0, 4);
  });

  it("hot at 2× hotThreshold → maxMultiplier", () => {
    const r = computeHotStreakSizing({ recentRealizedPnLPct: 0.40 });
    expect(r.suggestedMultiplier).toBeCloseTo(1.5, 4);
  });

  it("hot at 3× hotThreshold → still capped at maxMultiplier", () => {
    const r = computeHotStreakSizing({ recentRealizedPnLPct: 0.60 });
    expect(r.suggestedMultiplier).toBeCloseTo(1.5, 4);
  });

  it("hot at 1.5× hotThreshold → linear interp midpoint", () => {
    const r = computeHotStreakSizing({ recentRealizedPnLPct: 0.30 });
    expect(r.suggestedMultiplier).toBeCloseTo(1.25, 4);
  });

  it("neutral → 1.0", () => {
    expect(computeHotStreakSizing({ recentRealizedPnLPct: 0.05 }).suggestedMultiplier).toBe(1.0);
    expect(computeHotStreakSizing({ recentRealizedPnLPct: -0.02 }).suggestedMultiplier).toBe(1.0);
  });

  it("cold → coldMultiplier (default 0.5)", () => {
    const r = computeHotStreakSizing({ recentRealizedPnLPct: -0.20 });
    expect(r.suggestedMultiplier).toBe(0.5);
  });

  it("respects custom coldMultiplier=0 (refuse)", () => {
    const r = computeHotStreakSizing({ recentRealizedPnLPct: -0.20, coldMultiplier: 0 });
    expect(r.suggestedMultiplier).toBe(0);
    expect(r.recommendedAction).toBe("refuse");
  });
});

describe("computeHotStreakSizing — informational vs active mode", () => {
  it("informational mode (default): effectiveMultiplier = 1.0 even when hot", () => {
    const r = computeHotStreakSizing({ recentRealizedPnLPct: 0.40 });
    expect(r.mode).toBe("informational");
    expect(r.suggestedMultiplier).toBeCloseTo(1.5, 4);
    expect(r.effectiveMultiplier).toBe(1.0);
    expect(r.recommendedAction).toBe("size_up_suggested_informational");
  });

  it("active mode: effectiveMultiplier = suggestedMultiplier when hot", () => {
    const r = computeHotStreakSizing({
      recentRealizedPnLPct: 0.40,
      mode: "active",
    });
    expect(r.effectiveMultiplier).toBeCloseTo(1.5, 4);
    expect(r.recommendedAction).toBe("size_up_unlocked");
  });

  it("informational mode when cold: suggested = 0.5, effective = 1.0", () => {
    const r = computeHotStreakSizing({ recentRealizedPnLPct: -0.20 });
    expect(r.suggestedMultiplier).toBe(0.5);
    expect(r.effectiveMultiplier).toBe(1.0);
    expect(r.recommendedAction).toBe("size_down_suggested_informational");
  });

  it("active mode when cold: minimum_probe_only", () => {
    const r = computeHotStreakSizing({
      recentRealizedPnLPct: -0.20,
      mode: "active",
    });
    expect(r.effectiveMultiplier).toBe(0.5);
    expect(r.recommendedAction).toBe("minimum_probe_only");
  });
});

describe("hotStreakSizerToPayload", () => {
  it("emits stable shape", () => {
    const r = computeHotStreakSizing({ recentRealizedPnLPct: 0.25 });
    const p = hotStreakSizerToPayload(r) as {
      kind: string;
      classification: string;
      suggestedMultiplier: number;
      effectiveMultiplier: number;
      mode: string;
    };
    expect(p.kind).toBe("hot_streak_sizer.computed");
    expect(p.classification).toBe("hot");
    expect(p.effectiveMultiplier).toBe(1.0); // informational by default
    expect(p.suggestedMultiplier).toBeGreaterThan(1.0);
  });
});
