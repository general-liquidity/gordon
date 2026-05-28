import { describe, expect, test } from "bun:test";
import { interpretRiskRatioTriple } from "./risk-ratio-triple.ts";

describe("interpretRiskRatioTriple — skew classification via √2 rule", () => {
  test("Sortino well above √2×Sharpe → positive skew, underrated", () => {
    // sharpe 3 → expected sortino 4.24; sortino 5.5 → ratio 1.30
    const r = interpretRiskRatioTriple({ sharpe: 3.0, sortino: 5.5 });
    expect(r.skew).toBe("positive");
    expect(r.underratedBySharpe).toBe(true);
    expect(r.tailRiskUnpriced).toBe(false);
    expect(r.divergenceRatio).toBeGreaterThan(1.1);
  });

  test("Sortino ≈ √2×Sharpe → symmetric", () => {
    const r = interpretRiskRatioTriple({ sharpe: 3.0, sortino: Math.SQRT2 * 3.0 });
    expect(r.skew).toBe("symmetric");
    expect(r.underratedBySharpe).toBe(false);
    expect(r.tailRiskUnpriced).toBe(false);
    expect(r.divergenceRatio).toBeCloseTo(1.0, 5);
  });

  test("Sortino well below √2×Sharpe → negative skew, tail risk unpriced", () => {
    // vol-selling: great Sharpe 3.0, punishing Sortino 3.0 → ratio 0.71
    const r = interpretRiskRatioTriple({ sharpe: 3.0, sortino: 3.0 });
    expect(r.skew).toBe("negative");
    expect(r.tailRiskUnpriced).toBe(true);
    expect(r.underratedBySharpe).toBe(false);
    expect(r.interpretation).toContain("TAIL RISK");
  });
});

describe("interpretRiskRatioTriple — math honesty", () => {
  test("the article's own case study (4.12 / 5.70) lands as symmetric under the FORMAL √2 rule", () => {
    // √2 × 4.12 = 5.826; 5.70 / 5.826 = 0.978 → within ±10% → symmetric.
    // The article's prose calls this "positive skew" but its own formal
    // playbook says Sortino > √2×Sharpe for positive — 5.70 < 5.826. We
    // implement the formal rule, not the loose prose claim.
    const r = interpretRiskRatioTriple({ sharpe: 4.12, sortino: 5.7 });
    expect(r.skew).toBe("symmetric");
    expect(r.divergenceRatio).toBeCloseTo(0.978, 2);
  });

  test("expectedSortino is exactly √2 × Sharpe", () => {
    const r = interpretRiskRatioTriple({ sharpe: 2.0, sortino: 2.0 });
    expect(r.expectedSortino).toBeCloseTo(2.0 * Math.SQRT2, 9);
  });

  test("tolerance band is configurable", () => {
    // ratio 1.08 → symmetric at default ±10%, positive at ±5%
    const sharpe = 3.0;
    const sortino = 1.08 * Math.SQRT2 * sharpe;
    expect(interpretRiskRatioTriple({ sharpe, sortino }).skew).toBe("symmetric");
    expect(interpretRiskRatioTriple({ sharpe, sortino, symmetricTolerance: 0.05 }).skew).toBe("positive");
  });
});

describe("interpretRiskRatioTriple — allocator floors", () => {
  test("Calmar + Sortino floor checks", () => {
    const r = interpretRiskRatioTriple({ sharpe: 1.0, sortino: 2.5, calmar: 1.4 });
    expect(r.sortinoPassesFloor).toBe(true); // 2.5 ≥ 2.0
    expect(r.calmarPassesFloor).toBe(true); // 1.4 ≥ 1.0
  });

  test("floors fail when below thresholds", () => {
    const r = interpretRiskRatioTriple({ sharpe: 1.0, sortino: 1.5, calmar: 0.6 });
    expect(r.sortinoPassesFloor).toBe(false);
    expect(r.calmarPassesFloor).toBe(false);
  });

  test("calmar floor is null when calmar omitted", () => {
    const r = interpretRiskRatioTriple({ sharpe: 1.0, sortino: 2.5 });
    expect(r.calmar).toBeNull();
    expect(r.calmarPassesFloor).toBeNull();
    expect(r.interpretation).toContain("Calmar n/a");
  });

  test("custom floors respected", () => {
    const r = interpretRiskRatioTriple({
      sharpe: 1.0,
      sortino: 2.5,
      calmar: 1.4,
      sortinoFloor: 3.0,
      calmarFloor: 2.0,
    });
    expect(r.sortinoPassesFloor).toBe(false); // 2.5 < 3.0
    expect(r.calmarPassesFloor).toBe(false); // 1.4 < 2.0
  });
});

describe("interpretRiskRatioTriple — edge cases", () => {
  test("non-positive Sharpe → indeterminate skew", () => {
    expect(interpretRiskRatioTriple({ sharpe: 0, sortino: 1 }).skew).toBe("indeterminate");
    expect(interpretRiskRatioTriple({ sharpe: -1.5, sortino: -0.5 }).skew).toBe("indeterminate");
    expect(interpretRiskRatioTriple({ sharpe: 0, sortino: 1 }).divergenceRatio).toBeNull();
  });

  test("infinite Sortino (no downside) → positive skew, unbounded", () => {
    const r = interpretRiskRatioTriple({ sharpe: 2.0, sortino: Infinity });
    expect(r.skew).toBe("positive");
    expect(r.underratedBySharpe).toBe(true);
    expect(r.divergenceRatio).toBeNull();
    expect(r.sortinoPassesFloor).toBe(true);
    expect(r.interpretation).toContain("∞");
  });

  test("non-finite Sharpe → indeterminate", () => {
    expect(interpretRiskRatioTriple({ sharpe: NaN, sortino: 2 }).skew).toBe("indeterminate");
    expect(interpretRiskRatioTriple({ sharpe: Infinity, sortino: 2 }).skew).toBe("indeterminate");
  });
});
