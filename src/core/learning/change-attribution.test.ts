import { describe, expect, it } from "bun:test";
import {
  analyzeChangeAttribution,
  type ChangeType,
  type StrategyChange,
} from "./change-attribution.ts";

/**
 * Build `n` changes of one type whose held-out delta is `mean ± noise`
 * (alternating), so the one-sample t-test has spread to work with.
 */
function changes(type: ChangeType, n: number, meanDelta: number, noise: number): StrategyChange[] {
  const out: StrategyChange[] = [];
  for (let i = 0; i < n; i++) {
    const delta = meanDelta + (i % 2 === 0 ? noise : -noise);
    out.push({
      changeId: `${type}-${i}`,
      changeType: type,
      beforeMetric: 1.0,
      afterMetric: 1.0 + delta,
    });
  }
  return out;
}

describe("analyzeChangeAttribution", () => {
  it("a consistently-positive change-type aggregates as improves", () => {
    const r = analyzeChangeAttribution(changes("sizing", 30, 0.2, 0.03));
    const agg = r.aggregates[0]!;
    expect(agg.changeType).toBe("sizing");
    expect(agg.meanDelta).toBeCloseTo(0.2, 2);
    expect(agg.improvementRate).toBe(1);
    expect(agg.pValue).not.toBeNull();
    expect(agg.pValue!).toBeLessThan(r.correctedAlpha);
    expect(agg.verdict).toBe("improves");
    expect(agg.significance).toBe("robust");
    expect(r.topChangeType?.changeType).toBe("sizing");
  });

  it("a mixed change-type nets to ~zero and reads neutral", () => {
    // Symmetric +0.2 / -0.2 deltas: mean ~ 0, high variance, not significant.
    const out: StrategyChange[] = [];
    for (let i = 0; i < 30; i++) {
      const delta = i % 2 === 0 ? 0.2 : -0.2;
      out.push({
        changeId: `mix-${i}`,
        changeType: "entry_logic",
        beforeMetric: 1,
        afterMetric: 1 + delta,
      });
    }
    const r = analyzeChangeAttribution(out);
    const agg = r.aggregates[0]!;
    expect(Math.abs(agg.meanDelta)).toBeLessThan(0.02);
    expect(agg.verdict).toBe("neutral");
    expect(r.topChangeType).toBeNull();
  });

  it("a consistently-negative change-type reads regresses", () => {
    const r = analyzeChangeAttribution(changes("stop", 30, -0.15, 0.03));
    const agg = r.aggregates[0]!;
    expect(agg.meanDelta).toBeLessThan(0);
    expect(agg.verdict).toBe("regresses");
    expect(r.topChangeType).toBeNull();
  });

  it("a thin change-type is insufficient, not judged", () => {
    const r = analyzeChangeAttribution(changes("universe", 4, 0.3, 0.03));
    const agg = r.aggregates[0]!;
    expect(agg.significance).toBe("insufficient");
    expect(agg.verdict).toBe("insufficient");
  });

  it("Bonferroni: a moderate effect improving alone is downgraded when many types are tested", () => {
    const moderate = changes("param_class", 12, 0.14, 0.18); // borderline at 0.05

    const alone = analyzeChangeAttribution(moderate);
    expect(alone.aggregates[0]!.verdict).toBe("improves");

    const others: ChangeType[] = ["entry_logic", "sizing", "stop", "regime_filter", "universe"];
    const many = analyzeChangeAttribution([
      ...moderate,
      ...others.flatMap((t) => changes(t, 12, 0.0, 0.18)),
    ]);
    expect(many.correctedAlpha).toBeCloseTo(0.05 / 6, 6);
    const param = many.aggregates.find((a) => a.changeType === "param_class")!;
    expect(param.verdict).toBe("neutral"); // same data, stricter bar
  });

  it("groups multiple types and sorts by |meanDelta|", () => {
    const r = analyzeChangeAttribution([
      ...changes("sizing", 20, 0.3, 0.03),
      ...changes("stop", 20, 0.05, 0.03),
    ]);
    expect(r.changeTypesSeen).toBe(2);
    expect(r.aggregates[0]!.changeType).toBe("sizing"); // larger |delta| first
    expect(r.aggregates.map((a) => a.changeType)).toContain("stop");
  });

  it("empty history yields an empty, no-top report", () => {
    const r = analyzeChangeAttribution([]);
    expect(r.changesAnalyzed).toBe(0);
    expect(r.changeTypesSeen).toBe(0);
    expect(r.aggregates).toHaveLength(0);
    expect(r.topChangeType).toBeNull();
  });
});
