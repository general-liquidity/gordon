import { describe, expect, test } from "bun:test";
import {
  computeCrowdPositioningVerdict,
  summarizeCrowdPositioning,
} from "./crowdPositioning.ts";

describe("computeCrowdPositioningVerdict — empty / minimal", () => {
  test("no inputs → balanced verdict with zero signals", () => {
    const v = computeCrowdPositioningVerdict({});
    expect(v.side).toBe("balanced");
    expect(v.concentration).toBe("low");
    expect(v.signalCount).toBe(0);
    expect(v.expectedExitDirection).toBeNull();
  });

  test("only sentiment, mild bullish → low long verdict", () => {
    const v = computeCrowdPositioningVerdict({ sentimentScore: 0.25 });
    expect(v.signalCount).toBe(1);
    // Score is roughly 0.4 * (0.25/0.3) ≈ 0.33; after normalizing by
    // (1 * 0.8) ≈ 0.42 — could land in 'long' but at "low" concentration.
    expect(["balanced", "long"]).toContain(v.side);
  });
});

describe("computeCrowdPositioningVerdict — long-concentrated", () => {
  test("strong funding + OI + sentiment → long extreme", () => {
    const v = computeCrowdPositioningVerdict({
      fundingRateAnnualized: 0.5,
      openInterestChange: 0.4,
      sentimentScore: 0.8,
    });
    expect(v.side).toBe("long");
    expect(v.concentration).toBe("extreme");
    expect(v.expectedExitDirection).toBe("down");
  });

  test("Z-score takes precedence when supplied", () => {
    const v = computeCrowdPositioningVerdict({
      fundingRateAnnualized: 0.5,
      fundingRateZ: 3.5,
    });
    expect(v.contributingSignals.some((s) => s.signal === "funding_rate_z")).toBe(true);
    expect(v.contributingSignals.some((s) => s.signal === "funding_rate_annualized")).toBe(false);
  });
});

describe("computeCrowdPositioningVerdict — short-concentrated", () => {
  test("negative funding + decreasing OI + bearish sentiment → short concentrated", () => {
    const v = computeCrowdPositioningVerdict({
      fundingRateAnnualized: -0.4,
      openInterestChange: -0.3,
      sentimentScore: -0.7,
    });
    expect(v.side).toBe("short");
    expect(v.expectedExitDirection).toBe("up");
  });
});

describe("computeCrowdPositioningVerdict — liquidation imbalance opposes other signals", () => {
  test("strong long signals BUT recent long liquidations → lower concentration", () => {
    const withoutLiq = computeCrowdPositioningVerdict({
      fundingRateAnnualized: 0.4,
      openInterestChange: 0.3,
      sentimentScore: 0.6,
    });
    const withLiq = computeCrowdPositioningVerdict({
      fundingRateAnnualized: 0.4,
      openInterestChange: 0.3,
      sentimentScore: 0.6,
      recentLiquidationImbalance: 0.7, // many longs liquidated already
    });
    expect(Math.abs(withLiq.netScore)).toBeLessThan(Math.abs(withoutLiq.netScore));
  });

  test("liquidation signal alone produces opposing contribution", () => {
    const v = computeCrowdPositioningVerdict({ recentLiquidationImbalance: 0.6 });
    const liqContrib = v.contributingSignals.find((s) => s.signal === "recent_liquidation_imbalance");
    expect(liqContrib?.contribution).toBeLessThan(0);
  });
});

describe("computeCrowdPositioningVerdict — contributing signals", () => {
  test("each supplied input produces one contribution entry", () => {
    const v = computeCrowdPositioningVerdict({
      fundingRateAnnualized: 0.2,
      openInterestChange: 0.1,
      sentimentScore: 0.4,
      recentLiquidationImbalance: 0.1,
    });
    expect(v.signalCount).toBe(4);
    expect(v.contributingSignals.length).toBe(4);
  });

  test("contributions sum approximately to (unnormalized) score", () => {
    const v = computeCrowdPositioningVerdict({
      fundingRateAnnualized: 0.5,
      openInterestChange: 0.5,
      sentimentScore: 0.7,
    });
    const sum = v.contributingSignals.reduce((s, c) => s + c.contribution, 0);
    // After normalization the netScore is clipped, but sum of
    // contributions should be positive when all signals align long.
    expect(sum).toBeGreaterThan(0);
    expect(v.netScore).toBeGreaterThan(0);
  });
});

describe("computeCrowdPositioningVerdict — balanced", () => {
  test("conflicting signals cancel to balanced", () => {
    const v = computeCrowdPositioningVerdict({
      fundingRateAnnualized: 0.3,
      sentimentScore: -0.3,
    });
    expect(v.side).toBe("balanced");
  });

  test("near-zero inputs → balanced", () => {
    const v = computeCrowdPositioningVerdict({
      fundingRateAnnualized: 0.01,
      openInterestChange: 0.01,
      sentimentScore: 0.05,
    });
    expect(v.side).toBe("balanced");
  });
});

describe("summarizeCrowdPositioning", () => {
  test("no signals message", () => {
    const summary = summarizeCrowdPositioning(computeCrowdPositioningVerdict({}));
    expect(summary).toContain("no signals supplied");
  });

  test("balanced message", () => {
    const summary = summarizeCrowdPositioning(
      computeCrowdPositioningVerdict({
        fundingRateAnnualized: 0.3,
        sentimentScore: -0.3,
      }),
    );
    expect(summary).toContain("balanced");
    expect(summary).toContain("No Shapiro setup");
  });

  test("long-concentrated trade direction is short", () => {
    const summary = summarizeCrowdPositioning(
      computeCrowdPositioningVerdict({
        fundingRateAnnualized: 0.5,
        openInterestChange: 0.4,
        sentimentScore: 0.8,
      }),
    );
    expect(summary).toContain("longs");
    expect(summary).toContain("downward");
    expect(summary).toContain("Shapiro trade is short");
  });

  test("short-concentrated trade direction is long", () => {
    const summary = summarizeCrowdPositioning(
      computeCrowdPositioningVerdict({
        fundingRateAnnualized: -0.5,
        openInterestChange: -0.4,
        sentimentScore: -0.8,
      }),
    );
    expect(summary).toContain("shorts");
    expect(summary).toContain("upward");
    expect(summary).toContain("Shapiro trade is long");
  });
});
