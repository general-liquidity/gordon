import { describe, it, expect } from "bun:test";

import {
  isConfluenceScorerEnabled,
  scoreConfluences,
  sizeForTier,
  applyAdversarialDowngrade,
  formatScore,
  scoreToPayload,
  DEFAULT_RISK_MULTIPLIERS,
  CONFLUENCE_SCORER_FLAG_ENV,
  type ConfluenceObservation,
} from "./confluenceScorer.ts";

describe("isConfluenceScorerEnabled", () => {
  it("respects the flag", () => {
    expect(isConfluenceScorerEnabled({})).toBe(false);
    expect(isConfluenceScorerEnabled({ [CONFLUENCE_SCORER_FLAG_ENV]: "1" })).toBe(true);
    expect(isConfluenceScorerEnabled({ [CONFLUENCE_SCORER_FLAG_ENV]: "true" })).toBe(true);
  });
});

describe("scoreConfluences — tier mapping", () => {
  const allPresent = (kinds: string[]): ConfluenceObservation[] =>
    kinds.map((k) => ({ kind: k, present: true }));
  const partial = (kinds: string[], presentCount: number): ConfluenceObservation[] =>
    kinds.map((k, i) => ({ kind: k, present: i < presentCount }));

  it("all confluences present → A*", () => {
    const r = scoreConfluences({
      observations: allPresent(["divergence", "ema_alignment", "regime_fit", "key_level_proximity"]),
    });
    expect(r.tier).toBe("A*");
    expect(r.ratio).toBe(1);
  });

  it("zero confluences present → C", () => {
    const r = scoreConfluences({
      observations: partial(
        ["divergence", "ema_alignment", "regime_fit", "key_level_proximity"],
        0,
      ),
    });
    expect(r.tier).toBe("C");
  });

  it("70% present → A", () => {
    const obs: ConfluenceObservation[] = [];
    for (let i = 0; i < 10; i++) obs.push({ kind: `k${i}`, present: i < 7 });
    expect(scoreConfluences({ observations: obs }).tier).toBe("A");
  });

  it("50% present → B", () => {
    const obs: ConfluenceObservation[] = [];
    for (let i = 0; i < 10; i++) obs.push({ kind: `k${i}`, present: i < 5 });
    expect(scoreConfluences({ observations: obs }).tier).toBe("B");
  });

  it("respects custom thresholds", () => {
    const obs: ConfluenceObservation[] = [];
    for (let i = 0; i < 10; i++) obs.push({ kind: `k${i}`, present: i < 5 });
    const r = scoreConfluences({
      observations: obs,
      thresholds: { aStar: 0.5, a: 0.3, b: 0.1 },
    });
    expect(r.tier).toBe("A*"); // 50% now meets the lower aStar threshold
  });

  it("empty observations → C tier (ratio 0)", () => {
    const r = scoreConfluences({ observations: [] });
    expect(r.tier).toBe("C");
    expect(r.ratio).toBe(0);
  });
});

describe("scoreConfluences — weighting", () => {
  it("weighted observations contribute proportionally", () => {
    const r = scoreConfluences({
      observations: [
        { kind: "strong", present: true, weight: 3 },
        { kind: "weak", present: false, weight: 1 },
      ],
    });
    expect(r.score).toBe(3);
    expect(r.total).toBe(4);
    expect(r.ratio).toBe(0.75);
    expect(r.tier).toBe("A");
  });

  it("weight defaults to 1", () => {
    const r = scoreConfluences({
      observations: [
        { kind: "a", present: true },
        { kind: "b", present: true },
      ],
    });
    expect(r.score).toBe(2);
    expect(r.total).toBe(2);
  });
});

describe("scoreConfluences — present / missing kinds", () => {
  it("captures present and missing into separate arrays", () => {
    const r = scoreConfluences({
      observations: [
        { kind: "divergence", present: true },
        { kind: "ema_alignment", present: false },
        { kind: "regime_fit", present: true },
      ],
    });
    expect(r.presentKinds).toEqual(["divergence", "regime_fit"]);
    expect(r.missingKinds).toEqual(["ema_alignment"]);
  });
});

describe("sizeForTier", () => {
  it("A* multiplies base by 1.5", () => {
    expect(sizeForTier(1.0, "A*")).toBe(1.5);
  });
  it("A multiplies by 1.0", () => {
    expect(sizeForTier(1.0, "A")).toBe(1.0);
  });
  it("B multiplies by 0.5", () => {
    expect(sizeForTier(1.0, "B")).toBe(0.5);
  });
  it("C multiplies by 0.25", () => {
    expect(sizeForTier(1.0, "C")).toBe(0.25);
  });
  it("respects custom multipliers", () => {
    expect(sizeForTier(1.0, "A*", { "A*": 3, A: 1, B: 0.5, C: 0.1 })).toBe(3);
  });
  it("0 base risk yields 0 for every tier", () => {
    expect(sizeForTier(0, "A*")).toBe(0);
  });
});

describe("applyAdversarialDowngrade", () => {
  it("no findings → no change", () => {
    const r = applyAdversarialDowngrade("A*", { highSeverityFindings: 0, criticalFindings: 0 });
    expect(r.tier).toBe("A*");
    expect(r.downgradedBy).toBe(0);
    expect(r.reason).toBeNull();
  });

  it("one high-severity finding → drop one tier", () => {
    const r = applyAdversarialDowngrade("A*", { highSeverityFindings: 1, criticalFindings: 0 });
    expect(r.tier).toBe("A");
    expect(r.downgradedBy).toBe(1);
    expect(r.reason).toContain("1 high-severity");
  });

  it("one critical finding → drop two tiers", () => {
    const r = applyAdversarialDowngrade("A*", { highSeverityFindings: 0, criticalFindings: 1 });
    expect(r.tier).toBe("B");
    expect(r.downgradedBy).toBe(2);
    expect(r.reason).toContain("1 critical");
  });

  it("clamps at lowest tier (C)", () => {
    const r = applyAdversarialDowngrade("B", { highSeverityFindings: 0, criticalFindings: 5 });
    expect(r.tier).toBe("C");
  });

  it("aggregates multiple severities", () => {
    const r = applyAdversarialDowngrade("A*", { highSeverityFindings: 2, criticalFindings: 1 });
    // 1 critical (= 2 shift) + 2 high (= 2 shift) = 4 shifts → clamps to C
    expect(r.tier).toBe("C");
    expect(r.reason).toContain("critical");
    expect(r.reason).toContain("high-severity");
  });
});

describe("formatScore", () => {
  it("includes tier + present/missing", () => {
    const r = scoreConfluences({
      observations: [
        { kind: "divergence", present: true },
        { kind: "ema_alignment", present: false },
      ],
    });
    const out = formatScore(r);
    expect(out).toContain("Confluence");
    expect(out).toContain("divergence");
    expect(out).toContain("ema_alignment");
  });
});

describe("scoreToPayload", () => {
  it("emits stable shape", () => {
    const r = scoreConfluences({
      observations: [{ kind: "divergence", present: true }],
    });
    const p = scoreToPayload(r);
    expect(p.kind).toBe("confluence.score_recorded");
    expect(p.tier).toBe("A*");
  });
});

describe("TraderMorin scenario — A* downgraded to B by adversarial review", () => {
  it("end-to-end: 8/10 confluences (A*) + 2 high-severity findings → B-tier sizing", () => {
    const obs: ConfluenceObservation[] = [];
    for (let i = 0; i < 10; i++) obs.push({ kind: `k${i}`, present: i < 9 });
    const initial = scoreConfluences({ observations: obs });
    expect(initial.tier).toBe("A*");

    const downgraded = applyAdversarialDowngrade(initial.tier, {
      highSeverityFindings: 2,
      criticalFindings: 0,
    });
    expect(downgraded.tier).toBe("B");

    const baseRisk = 1.0;
    const adjustedRisk = sizeForTier(baseRisk, downgraded.tier);
    expect(adjustedRisk).toBe(0.5); // B-tier multiplier 0.5
    expect(adjustedRisk).toBeLessThan(sizeForTier(baseRisk, initial.tier));
  });
});

describe("DEFAULT_RISK_MULTIPLIERS — invariants", () => {
  it("monotonically decreases A* → C", () => {
    expect(DEFAULT_RISK_MULTIPLIERS["A*"]).toBeGreaterThan(DEFAULT_RISK_MULTIPLIERS.A);
    expect(DEFAULT_RISK_MULTIPLIERS.A).toBeGreaterThan(DEFAULT_RISK_MULTIPLIERS.B);
    expect(DEFAULT_RISK_MULTIPLIERS.B).toBeGreaterThan(DEFAULT_RISK_MULTIPLIERS.C);
  });
  it("C-tier still positive (you can take a C if you must)", () => {
    expect(DEFAULT_RISK_MULTIPLIERS.C).toBeGreaterThan(0);
  });
});
