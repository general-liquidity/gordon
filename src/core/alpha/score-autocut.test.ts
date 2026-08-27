import { describe, expect, it } from "bun:test";
import { selectByScoreDiscontinuity, type AutocutItem } from "./score-autocut.ts";

const items = (scores: number[]): AutocutItem[] =>
  scores.map((score, i) => ({ id: `c${i}`, score }));

describe("selectByScoreDiscontinuity", () => {
  it("cuts at a clear cliff and returns the leading cluster", () => {
    // gaps [1,1,88] over spread 90 — the 88 gap before 10 is the cliff.
    const r = selectByScoreDiscontinuity(items([100, 99, 98, 10]));
    expect(r.reason).toBe("cliff");
    expect(r.keptCount).toBe(3);
    expect(r.cutIndex).toBe(2);
    expect(r.selected.map((s) => s.score)).toEqual([100, 99, 98]);
  });

  it("returns a single candidate when one dominates", () => {
    const r = selectByScoreDiscontinuity(items([1000, 5, 4]));
    expect(r.reason).toBe("cliff");
    expect(r.keptCount).toBe(1);
    expect(r.selected[0]!.score).toBe(1000);
  });

  it("fails OPEN on a uniform decline (no dominant gap)", () => {
    const r = selectByScoreDiscontinuity(items([100, 80, 60, 40, 20]));
    expect(r.reason).toBe("uniform");
    expect(r.keptCount).toBe(5); // kept all — no real cliff
    expect(r.cutIndex).toBeNull();
  });

  it("fails open when the top gap is below jumpRatio", () => {
    // even gaps of 0.5 over spread 1.5 (largest = 0.33 of spread); a jumpRatio
    // of 0.9 is above that, so no gap qualifies as a cliff → keep all.
    const r = selectByScoreDiscontinuity(items([100, 99.5, 99, 98.5]), { jumpRatio: 0.9 });
    expect(r.cutIndex).toBeNull();
    expect(r.keptCount).toBe(4);
  });

  it("reports no_variation when all scores are equal", () => {
    const r = selectByScoreDiscontinuity(items([50, 50, 50]));
    expect(r.reason).toBe("no_variation");
    expect(r.keptCount).toBe(3);
  });

  it("needs ≥3 candidates to attempt a cut (fails open at n=2)", () => {
    const r = selectByScoreDiscontinuity(items([100, 10]));
    expect(r.reason).toBe("too_few");
    expect(r.keptCount).toBe(2);
  });

  it("respects minKeep — cuts at the cliff AFTER the floor", () => {
    // gaps [1,49,1]; with minKeep 2 the cut must be at index ≥1 → the 49 cliff.
    const r = selectByScoreDiscontinuity(items([100, 99, 50, 49]), { minKeep: 2 });
    expect(r.reason).toBe("cliff");
    expect(r.keptCount).toBe(2);
    expect(r.cutIndex).toBe(1);
  });

  it("a dominant gap stranded before minKeep makes it fail open (conservative)", () => {
    // gaps [90,1,1]; minKeep 2 strands the 90 cliff in the forced-keep zone →
    // the small in-range gaps can't dominate it → keep all.
    const r = selectByScoreDiscontinuity(items([100, 10, 9, 8]), { minKeep: 2 });
    expect(r.cutIndex).toBeNull();
    expect(r.keptCount).toBe(4);
  });

  it("never returns more than maxKeep", () => {
    const r = selectByScoreDiscontinuity(items([100, 99, 98, 97, 5]), { maxKeep: 2 });
    expect(r.selected.length).toBeLessThanOrEqual(2);
  });

  it("carries item ids through and sorts descending", () => {
    const r = selectByScoreDiscontinuity([
      { id: "low", score: 1 },
      { id: "high", score: 100 },
      { id: "mid", score: 2 },
    ]);
    expect(r.selected[0]!.id).toBe("high");
  });

  it("handles empty and single-item input without throwing", () => {
    expect(selectByScoreDiscontinuity([]).keptCount).toBe(0);
    expect(selectByScoreDiscontinuity(items([42])).keptCount).toBe(1);
  });
});
