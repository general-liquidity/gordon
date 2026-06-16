import { describe, it, expect } from "bun:test";
import {
  normalCdf,
  estimatePercentile,
  percentileFromBoard,
  assessStanding,
  formatStanding,
  DEFAULT_FIELD,
  type FieldModel,
} from "./rankTracker.ts";

const FIELD: FieldModel = { mean: 0, std: 0.4, n: 500 };

describe("normalCdf (Φ)", () => {
  it("Φ(0) = 0.5", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
  });
  it("is symmetric: Φ(z) + Φ(−z) = 1", () => {
    expect(normalCdf(1.5) + normalCdf(-1.5)).toBeCloseTo(1, 5);
  });
  it("matches known quantiles", () => {
    expect(normalCdf(1)).toBeCloseTo(0.8413, 3);
    expect(normalCdf(-1)).toBeCloseTo(0.1587, 3);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
  });
  it("saturates at the tails", () => {
    expect(normalCdf(10)).toBeCloseTo(1, 6);
    expect(normalCdf(-10)).toBeCloseTo(0, 6);
  });
});

describe("estimatePercentile", () => {
  // (1) high ourReturn → high percentile → (later) low rank
  it("high return → high percentile", () => {
    const p = estimatePercentile(0.6, FIELD); // +1.5σ above mean
    expect(p).toBeGreaterThan(0.9);
  });
  it("low return → low percentile", () => {
    const p = estimatePercentile(-0.6, FIELD);
    expect(p).toBeLessThan(0.1);
  });
  it("at the mean → 0.5", () => {
    expect(estimatePercentile(0, FIELD)).toBeCloseTo(0.5, 6);
  });
  it("monotone in return", () => {
    expect(estimatePercentile(0.2, FIELD)).toBeGreaterThan(estimatePercentile(0.1, FIELD));
  });
  it("degenerate std collapses to a step at the mean", () => {
    const f: FieldModel = { mean: 0.05, std: 0, n: 10 };
    expect(estimatePercentile(0.1, f)).toBe(1);
    expect(estimatePercentile(0.0, f)).toBe(0);
    expect(estimatePercentile(0.05, f)).toBe(0.5);
  });
});

describe("percentileFromBoard (empirical)", () => {
  // (6) empirical rank matches a hand-sorted array
  it("matches a hand-computed mid-rank", () => {
    const board = [-0.1, 0.0, 0.05, 0.2, 0.5]; // 5 entrants
    // ourReturn 0.1 beats {-0.1, 0.0, 0.05} = 3, ties 0, of 5 → 0.6
    expect(percentileFromBoard(0.1, board)).toBeCloseTo(0.6, 9);
  });
  it("uses mid-rank for ties", () => {
    const board = [0.0, 0.1, 0.1, 0.1, 0.5];
    // ourReturn 0.1: below {0.0} = 1, ties {0.1,0.1,0.1} = 3 → (1 + 3/2)/5 = 0.5
    expect(percentileFromBoard(0.1, board)).toBeCloseTo(0.5, 9);
  });
  it("top of the board → ~1", () => {
    expect(percentileFromBoard(1.0, [0.1, 0.2, 0.3])).toBeCloseTo(1, 9);
  });
  it("bottom of the board → ~0", () => {
    expect(percentileFromBoard(-1.0, [0.1, 0.2, 0.3])).toBeCloseTo(0, 9);
  });
  it("empty board → 0.5", () => {
    expect(percentileFromBoard(0.1, [])).toBe(0.5);
  });
});

describe("assessStanding — rank", () => {
  // (1) high ourReturn → high percentile → low rank
  it("high return → low (good) rank, low return → high (bad) rank", () => {
    const top = assessStanding({ ourReturn: 0.8, field: FIELD, phase: "post_cut" });
    const bot = assessStanding({ ourReturn: -0.8, field: FIELD, phase: "post_cut" });
    expect(top.estimatedRank).toBeLessThan(bot.estimatedRank);
    expect(top.estimatedRank).toBeGreaterThanOrEqual(1);
    expect(bot.estimatedRank).toBeLessThanOrEqual(FIELD.n);
  });
});

describe("assessStanding — pre_cut bang-bang", () => {
  // (2) below-cut pre_cut → max_variance
  it("below the cut → max_variance", () => {
    const s = assessStanding({ ourReturn: 0, field: FIELD, cutPercentile: 0.8, phase: "pre_cut" });
    expect(s.clearsCut).toBe(false);
    expect(s.stance).toBe("max_variance");
  });

  // (3) safely-above-cut pre_cut → not max_variance (lock_in here)
  it("comfortably above the cut → lock_in (not max_variance)", () => {
    // +2σ → p ≈ 0.977, well above cut 0.8 + margin
    const s = assessStanding({ ourReturn: 0.8, field: FIELD, cutPercentile: 0.8, phase: "pre_cut" });
    expect(s.clearsCut).toBe(true);
    expect(s.stance).not.toBe("max_variance");
    expect(s.stance).toBe("lock_in");
  });

  it("just above the cut → neutral (narrow band)", () => {
    // Pick a return whose percentile sits between cut (0.8) and cut+margin (0.9).
    // p=0.85 → z = Φ⁻¹(0.85) ≈ 1.0364 → ourReturn = 1.0364·0.4 ≈ 0.4146
    const s = assessStanding({ ourReturn: 0.4146, field: FIELD, cutPercentile: 0.8, phase: "pre_cut" });
    expect(s.clearsCut).toBe(true);
    expect(s.percentile).toBeGreaterThan(0.8);
    expect(s.percentile).toBeLessThan(0.9);
    expect(s.stance).toBe("neutral");
  });
});

describe("assessStanding — post_cut bang-bang", () => {
  // (4) top post_cut → lock_in
  it("top of the field → lock_in", () => {
    const s = assessStanding({ ourReturn: 1.0, field: FIELD, phase: "post_cut" }); // +2.5σ
    expect(s.percentile).toBeGreaterThan(0.9);
    expect(s.stance).toBe("lock_in");
  });

  // (5) mid post_cut → max_variance
  it("mid of the field → max_variance (lottery sleeve)", () => {
    const s = assessStanding({ ourReturn: 0.1, field: FIELD, phase: "post_cut" }); // p ≈ 0.6
    expect(s.percentile).toBeGreaterThan(0.4);
    expect(s.percentile).toBeLessThan(0.9);
    expect(s.stance).toBe("max_variance");
  });
});

describe("assessStanding — clearsCut boundary", () => {
  // (7) clearsCut boundary correct: percentile ≥ cutPercentile clears.
  it("exactly at the cut percentile clears the cut", () => {
    // At the mean, percentile is exactly 0.5; set the cut there.
    const s = assessStanding({ ourReturn: 0, field: FIELD, cutPercentile: 0.5, phase: "pre_cut" });
    expect(s.percentile).toBeCloseTo(0.5, 6);
    expect(s.clearsCut).toBe(true);
  });
  it("a hair below the cut does not clear", () => {
    const s = assessStanding({ ourReturn: -0.001, field: FIELD, cutPercentile: 0.5, phase: "pre_cut" });
    expect(s.percentile).toBeLessThan(0.5);
    expect(s.clearsCut).toBe(false);
    expect(s.stance).toBe("max_variance");
  });
});

describe("formatStanding + worked example", () => {
  it("formats a standing block", () => {
    const s = assessStanding({ ourReturn: 0.15, field: { mean: 0, std: 0.4, n: 500 }, cutPercentile: 0.8, phase: "pre_cut" });
    const out = formatStanding(s, FIELD);
    expect(out).toContain("Standing");
    expect(out).toContain("Stance:");
    expect(out).toContain("of 500");
  });

  it("worked example: +15% return, field N(0, 40%), pre_cut, Top-100/500", () => {
    // z = 0.15/0.40 = 0.375 → p ≈ 0.646 → below cut 0.8 → max_variance.
    const s = assessStanding({ ourReturn: 0.15, field: FIELD, cutPercentile: 0.8, phase: "pre_cut" });
    expect(s.percentile).toBeCloseTo(normalCdf(0.375), 6);
    expect(s.clearsCut).toBe(false);
    expect(s.stance).toBe("max_variance");
    // rank ≈ (1 − 0.646)·499 + 1 ≈ 178
    expect(s.estimatedRank).toBeGreaterThan(150);
    expect(s.estimatedRank).toBeLessThan(210);
  });
});

describe("DEFAULT_FIELD", () => {
  it("is a wide ~500-entrant model", () => {
    expect(DEFAULT_FIELD.n).toBe(500);
    expect(DEFAULT_FIELD.std).toBeGreaterThan(0.2);
  });
});
