import { describe, expect, it } from "bun:test";
import { computeSinglePrints } from "./singlePrints.ts";
import type { ProfileBar } from "./marketProfile.ts";

const BLOCK = 30 * 60 * 1000; // one TPO per 30-min block
const bar = (low: number, high: number, blockIdx: number): ProfileBar => ({
  low,
  high,
  timestamp: blockIdx * BLOCK,
});

describe("computeSinglePrints", () => {
  it("extracts buying/selling tails and a mid-range single-print zone", () => {
    // Target TPO histogram (tick=1): 100:1 101:2 102:3 103:1 104:2 105:3 106:1
    //   → buying tail at 100, mid-range single print at 103, selling tail at 106.
    const bars: ProfileBar[] = [
      bar(100, 102, 0), // 100,101,102
      bar(101, 102, 1), // 101,102
      bar(102, 103, 2), // 102,103   ← the one block crossing 103
      bar(104, 105, 3), // 104,105
      bar(104, 106, 4), // 104,105,106
      bar(105, 105, 5), // 105
    ];
    const r = computeSinglePrints({ bars, tickSize: 1 });

    expect(r.buyingTailLength).toBe(1);
    expect(r.sellingTailLength).toBe(1);
    expect(r.poorLow).toBe(false);
    expect(r.poorHigh).toBe(false);
    expect(r.midRangeTargets).toEqual([103]);
    // canonical: only the mid-range level (103) is a "single print"; the two
    // extreme levels (100, 106) are tails, not single prints.
    expect(r.totalSinglePrints).toBe(1);

    const locations = r.zones.map((z) => z.location).sort();
    expect(locations).toEqual(["buying_tail", "mid_range", "selling_tail"]);
    const mid = r.zones.find((z) => z.location === "mid_range");
    expect(mid?.priceLow).toBe(103);
    expect(mid?.priceHigh).toBe(103);
  });

  it("flags a poor high (extreme touched ≥ poorThreshold) with no selling tail", () => {
    // 100:1 101:3 102:3 — high (102) touched 3× → poor high, no selling tail.
    const bars: ProfileBar[] = [
      bar(100, 102, 0), // 100,101,102
      bar(101, 102, 1), // 101,102
      bar(101, 102, 2), // 101,102
    ];
    const r = computeSinglePrints({ bars, tickSize: 1 });
    expect(r.poorHigh).toBe(true);
    expect(r.sellingTailLength).toBe(0);
    expect(r.buyingTailLength).toBe(1); // 100 is still a single print
    expect(r.poorLow).toBe(false);
  });

  it("measures a multi-print buying tail (responsive rejection length)", () => {
    // 100:1 101:1 102:2 103:2 104:2 — buying tail of length 2 from the low.
    const bars: ProfileBar[] = [
      bar(100, 100, 0),
      bar(101, 101, 1),
      bar(102, 104, 2),
      bar(102, 104, 3),
    ];
    const r = computeSinglePrints({ bars, tickSize: 1 });
    expect(r.buyingTailLength).toBe(2);
    expect(r.poorHigh).toBe(true); // 104 touched 2×
    const tail = r.zones.find((z) => z.location === "buying_tail");
    expect(tail?.length).toBe(2);
  });

  it("returns a neutral result on insufficient data", () => {
    const r = computeSinglePrints({ bars: [], tickSize: 1 });
    expect(r.zones).toEqual([]);
    expect(r.totalSinglePrints).toBe(0);
    expect(r.buyingTailLength).toBe(0);
  });
});
