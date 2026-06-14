import { describe, expect, it } from "bun:test";
import type { EdgeSpec } from "../edge/types.ts";
import {
  analyzeLeverAttribution,
  type LeverTaggedTrade,
} from "./lever-attribution.ts";

function edgeWith(leverIds: string[]): EdgeSpec {
  return {
    name: "test-edge",
    strategy: "x",
    status: "live",
    regime: [],
    instruments: [],
    hypothesis: "x",
    invariants: leverIds.map((id) => ({ id, metric: id, comparator: ">" as const, threshold: 0, description: "" })),
    killConditions: [],
  };
}

/**
 * Build `nPer` strong-margin trades (margin 2) + `nPer` marginal-margin trades
 * (margin 0); the median split is 1, so the buckets separate cleanly. Each
 * bucket's realized R is `mean ± noise` (alternating) so the t-test has variance.
 */
function leverTrades(leverId: string, nPer: number, strongMean: number, marginalMean: number, noise: number): LeverTaggedTrade[] {
  const out: LeverTaggedTrade[] = [];
  for (let i = 0; i < nPer; i++) {
    out.push({ tradeId: `s${i}`, realizedR: strongMean + (i % 2 === 0 ? noise : -noise), leverMargins: { [leverId]: 2 } });
  }
  for (let i = 0; i < nPer; i++) {
    out.push({ tradeId: `m${i}`, realizedR: marginalMean + (i % 2 === 0 ? noise : -noise), leverMargins: { [leverId]: 0 } });
  }
  return out;
}

describe("analyzeLeverAttribution", () => {
  it("recommends SHARPEN for a lever that clearly discriminates", () => {
    const r = analyzeLeverAttribution(edgeWith(["good"]), leverTrades("good", 60, 1.0, 0.0, 0.1));
    const lever = r.levers[0]!;
    expect(lever.recommendation).toBe("sharpen");
    expect(lever.discriminationR).toBeCloseTo(1.0, 1);
    expect(lever.pValue).not.toBeNull();
    expect(lever.pValue!).toBeLessThan(r.correctedAlpha);
    expect(lever.strong.significance).toBe("robust");
  });

  it("recommends DROP for a dead lever (no separation, not significant)", () => {
    const r = analyzeLeverAttribution(edgeWith(["dead"]), leverTrades("dead", 40, 0.5, 0.5, 0.2));
    expect(r.levers[0]!.recommendation).toBe("drop");
    expect(Math.abs(r.levers[0]!.discriminationR)).toBeLessThan(0.1);
  });

  it("recommends INVERT for a backwards lever (marginal entries beat strong)", () => {
    const r = analyzeLeverAttribution(edgeWith(["backwards"]), leverTrades("backwards", 40, 0.0, 1.0, 0.1));
    expect(r.levers[0]!.recommendation).toBe("invert");
    expect(r.levers[0]!.discriminationR).toBeLessThan(0);
  });

  it("recommends DEFER when a bucket is below the sample floor", () => {
    const r = analyzeLeverAttribution(edgeWith(["thin"]), leverTrades("thin", 10, 1.0, 0.0, 0.1));
    expect(r.levers[0]!.recommendation).toBe("defer");
    expect(r.levers[0]!.strong.significance).toBe("insufficient");
  });

  it("defers a lever no trade carries margin for", () => {
    const r = analyzeLeverAttribution(edgeWith(["absent"]), leverTrades("other", 40, 1.0, 0.0, 0.1));
    expect(r.levers[0]!.recommendation).toBe("defer");
  });

  it("Bonferroni guard: a moderate effect that sharpens alone is downgraded when many levers are tested", () => {
    const trades = leverTrades("mod", 30, 0.24, 0.0, 0.4); // p ≈ 0.026

    const alone = analyzeLeverAttribution(edgeWith(["mod"]), trades); // α = 0.05
    expect(alone.levers[0]!.recommendation).toBe("sharpen");

    const many = analyzeLeverAttribution(
      edgeWith(["mod", "d1", "d2", "d3", "d4", "d5", "d6", "d7", "d8", "d9"]),
      trades,
    ); // α = 0.005
    const mod = many.levers.find((l) => l.leverId === "mod")!;
    expect(mod.recommendation).not.toBe("sharpen"); // same data, stricter bar → keep
    expect(mod.recommendation).toBe("keep");
    expect(many.correctedAlpha).toBeCloseTo(0.005, 6);
  });

  it("builds a report: topLever is the sharpenable lever, summary names it", () => {
    const r = analyzeLeverAttribution(edgeWith(["good"]), leverTrades("good", 40, 1.0, 0.0, 0.1));
    expect(r.topLever?.leverId).toBe("good");
    expect(r.leversTested).toBe(1);
    expect(r.summary).toContain("sharpen");
    expect(r.summary).toContain("good");
  });

  it("returns all-defer for an empty trade batch", () => {
    const r = analyzeLeverAttribution(edgeWith(["a", "b"]), []);
    expect(r.levers.every((l) => l.recommendation === "defer")).toBe(true);
    expect(r.topLever).toBeNull();
  });
});
