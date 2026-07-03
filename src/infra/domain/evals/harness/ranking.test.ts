import { describe, it, expect } from "bun:test";
import {
  wilsonInterval,
  bradleyTerry,
  rankVariants,
  rankVariantResults,
  formatLeaderboard,
  zForConfidence,
  type RankingVariant,
} from "./ranking.ts";
import type { VariantRunResult } from "./types.ts";

describe("zForConfidence", () => {
  it("returns ~1.96 for 95%", () => {
    expect(zForConfidence(0.95)).toBeCloseTo(1.959964, 4);
  });
  it("returns ~2.576 for 99%", () => {
    expect(zForConfidence(0.99)).toBeCloseTo(2.575829, 4);
  });
});

describe("wilsonInterval", () => {
  it("keeps a perfect proportion off the ceiling on small n", () => {
    const ci = wilsonInterval(10, 10, 1.959964);
    expect(ci.p).toBe(1);
    expect(ci.low).toBeGreaterThan(0.6);
    expect(ci.low).toBeLessThan(1);
    expect(ci.high).toBeCloseTo(1, 9);
  });
  it("brackets 0.5 symmetrically for a fair split", () => {
    const ci = wilsonInterval(5, 10, 1.959964);
    expect(ci.p).toBe(0.5);
    expect(ci.low).toBeLessThan(0.5);
    expect(ci.high).toBeGreaterThan(0.5);
  });
  it("returns the widest interval for zero games", () => {
    const ci = wilsonInterval(0, 0, 1.959964);
    expect(ci.low).toBe(0);
    expect(ci.high).toBe(1);
  });
});

describe("bradleyTerry", () => {
  it("gives the dominant competitor the highest strength", () => {
    // 3 players: 0 beats everyone, 1 beats 2.
    const wins = [
      [0, 5, 5],
      [0, 0, 3],
      [0, 2, 0],
    ];
    const games = [
      [0, 5, 5],
      [5, 0, 5],
      [5, 5, 0],
    ];
    const s = bradleyTerry(wins, games);
    expect(s.length).toBe(3);
    expect(s[0]).toBeGreaterThan(s[1]!);
    expect(s[1]).toBeGreaterThan(s[2]!);
    expect(s.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  });
});

describe("rankVariants", () => {
  // A dominates every scenario; B and C split their head-to-head and both
  // always lose to A — their win rates land close enough that the small-sample
  // Wilson intervals overlap (statistically indistinguishable).
  function build(): RankingVariant[] {
    const rows: Array<{ s: string; A: number; B: number; C: number }> = [
      { s: "s0", A: 0.9, B: 0.6, C: 0.5 },
      { s: "s1", A: 0.9, B: 0.6, C: 0.5 },
      { s: "s2", A: 0.9, B: 0.6, C: 0.5 },
      { s: "s3", A: 0.9, B: 0.5, C: 0.6 },
      { s: "s4", A: 0.9, B: 0.5, C: 0.6 },
    ];
    const mk = (pick: (r: (typeof rows)[number]) => number): ReadonlyMap<string, number> => {
      const m = new Map<string, number>();
      for (const r of rows) m.set(r.s, pick(r));
      return m;
    };
    return [
      { label: "A", scores: mk((r) => r.A) },
      { label: "B", scores: mk((r) => r.B) },
      { label: "C", scores: mk((r) => r.C) },
    ];
  }

  it("ranks the clearly-better variant on top", () => {
    const board = rankVariants({ variants: build() });
    expect(board.variants[0]?.label).toBe("A");
    expect(board.variants[0]?.rank).toBe(1);
    expect(board.variants[0]?.winRate).toBe(1);
    expect(board.variants[0]?.tiedWithPrevious).toBe(false);
  });

  it("flags the two overlapping-CI variants as tied", () => {
    const board = rankVariants({ variants: build() });
    // A is clearly separated from the pack.
    const b = board.variants.find((v) => v.label === "B")!;
    const c = board.variants.find((v) => v.label === "C")!;
    // B outranks C (won 3 of their 5 head-to-heads), but the CIs overlap.
    expect(b.rank).toBe(2);
    expect(c.rank).toBe(3);
    expect(b.tiedWithPrevious).toBe(false); // vs A — not tied
    expect(c.tiedWithPrevious).toBe(true); // vs B — indistinguishable
  });

  it("A's interval does not overlap B's (A is distinguishable)", () => {
    const board = rankVariants({ variants: build() });
    const a = board.variants.find((v) => v.label === "A")!;
    const b = board.variants.find((v) => v.label === "B")!;
    expect(a.ciLow).toBeGreaterThan(b.ciHigh);
  });

  it("is deterministic across calls", () => {
    const a = rankVariants({ variants: build() });
    const b = rankVariants({ variants: build() });
    expect(a.variants.map((v) => v.label)).toEqual(b.variants.map((v) => v.label));
    expect(a.variants.map((v) => v.winRate)).toEqual(b.variants.map((v) => v.winRate));
  });

  it("formatLeaderboard renders one line per variant", () => {
    const board = rankVariants({ variants: build() });
    const text = formatLeaderboard(board);
    expect(text).toContain("1. A");
    expect(text).toContain("~tied with above");
  });
});

describe("rankVariantResults adapter", () => {
  function res(label: string, scores: Record<string, number>): VariantRunResult {
    const perScenario = Object.entries(scores).map(([scenarioId, score]) => ({
      scenarioId,
      score,
      rank: 1,
      explanation: "",
    }));
    const aggregate = perScenario.reduce((s, p) => s + p.score, 0) / perScenario.length;
    return {
      variantLabel: label,
      judgeModel: "test",
      ranAt: "2026-04-26T00:00:00Z",
      perScenario,
      aggregate,
      winCount: 0,
      scenarioCount: perScenario.length,
    };
  }

  it("builds a leaderboard from runEvalSuite-shaped results", () => {
    const board = rankVariantResults([
      res("top", { s0: 0.9, s1: 0.9, s2: 0.9 }),
      res("mid", { s0: 0.5, s1: 0.5, s2: 0.5 }),
      res("low", { s0: 0.2, s1: 0.2, s2: 0.2 }),
    ]);
    expect(board.variants[0]?.label).toBe("top");
    expect(board.variants[2]?.label).toBe("low");
    expect(board.variants[0]?.winRate).toBe(1);
    expect(board.variants[2]?.winRate).toBe(0);
  });
});
