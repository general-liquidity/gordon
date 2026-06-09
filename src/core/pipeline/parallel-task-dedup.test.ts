import { describe, expect, it } from "bun:test";
import { dedupeParallelTasks, tradingTaskSurface } from "./parallel-task-dedup.ts";

describe("dedupeParallelTasks", () => {
  it("keeps all when surfaces are distinct", () => {
    const r = dedupeParallelTasks([
      { id: "a", surface: ["sym:btc", "act:buy"] },
      { id: "b", surface: ["sym:eth", "act:sell"] },
      { id: "c", surface: ["sym:gold", "act:buy"] },
    ]);
    expect(r.flagged).toBe(false);
    expect(r.keep.sort()).toEqual(["a", "b", "c"]);
    expect(r.dropped).toEqual([]);
  });

  it("collapses identical-surface lanes (coherent amplification)", () => {
    const r = dedupeParallelTasks([
      { id: "a", surface: ["sym:btc", "act:buy"] },
      { id: "b", surface: ["sym:btc", "act:buy"] }, // same decision
      { id: "c", surface: ["sym:btc", "act:buy"] }, // same decision
    ]);
    expect(r.flagged).toBe(true);
    expect(r.keep).toEqual(["a"]); // first by input order
    expect(r.dropped.sort()).toEqual(["b", "c"]);
    expect(r.reducedTo).toBe(1);
  });

  it("clusters transitively (A~B, B~C ⇒ one group)", () => {
    const r = dedupeParallelTasks(
      [
        { id: "a", surface: ["x", "y", "z"] },
        { id: "b", surface: ["x", "y", "w"] }, // ~a (2/4 = 0.5 < 0.6? see threshold)
        { id: "c", surface: ["x", "y", "z"] }, // == a
      ],
      { overlapThreshold: 0.5 },
    );
    // a~c (1.0), a~b (0.5), b~c (0.5) → all one cluster
    expect(r.groups.length).toBe(1);
    expect(r.keep).toEqual(["a"]);
  });

  it("does not flag opposite actions on the same symbol as redundant", () => {
    const r = dedupeParallelTasks([
      { id: "buy", surface: tradingTaskSurface({ symbol: "BTC", action: "buy" }) },
      { id: "sell", surface: tradingTaskSurface({ symbol: "BTC", action: "sell" }) },
    ]);
    // shared {sym:btc}, union 3 → jaccard 0.33 < 0.6
    expect(r.flagged).toBe(false);
    expect(r.keep.sort()).toEqual(["buy", "sell"]);
  });

  it("flags two identical trading decisions via tradingTaskSurface", () => {
    const r = dedupeParallelTasks([
      { id: "1", surface: tradingTaskSurface({ symbol: "BTC", action: "buy", venue: "binance" }) },
      { id: "2", surface: tradingTaskSurface({ symbol: "btc", action: "BUY", venue: "Binance" }) }, // case-insensitive
    ]);
    expect(r.flagged).toBe(true);
    expect(r.redundantPairs[0]!.jaccard).toBe(1);
  });

  it("empty surface is never redundant (can't prove overlap)", () => {
    const r = dedupeParallelTasks([
      { id: "a", surface: [] },
      { id: "b", surface: [] },
    ]);
    expect(r.flagged).toBe(false);
  });

  it("single task passes through", () => {
    const r = dedupeParallelTasks([{ id: "only", surface: ["sym:btc", "act:buy"] }]);
    expect(r.keep).toEqual(["only"]);
    expect(r.flagged).toBe(false);
  });
});
