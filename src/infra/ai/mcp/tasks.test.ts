import { describe, it, expect } from "bun:test";
import {
  resolveTaskSupport,
  buildTaskAnnotations,
  getTaskToolSets,
} from "./tasks.ts";

describe("resolveTaskSupport", () => {
  it("flags backtests as required (slow)", () => {
    expect(resolveTaskSupport("run_backtest")).toBe("required");
    expect(resolveTaskSupport("backtest_strategy")).toBe("required");
  });

  it("flags MCPT + deep research as required", () => {
    expect(resolveTaskSupport("run_mcpt")).toBe("required");
    expect(resolveTaskSupport("monte_carlo_permutation_test")).toBe("required");
    expect(resolveTaskSupport("deep_research")).toBe("required");
  });

  it("flags ACE passes as required", () => {
    expect(resolveTaskSupport("ace_reflector_pass")).toBe("required");
    expect(resolveTaskSupport("ace_curator_pass")).toBe("required");
  });

  it("flags scans + candles as optional (medium)", () => {
    expect(resolveTaskSupport("scan_market")).toBe("optional");
    expect(resolveTaskSupport("get_candles")).toBe("optional");
    expect(resolveTaskSupport("get_orderbook")).toBe("optional");
  });

  it("returns undefined for non-slow tools (synchronous by default)", () => {
    expect(resolveTaskSupport("get_price")).toBeUndefined();
    expect(resolveTaskSupport("execute_plan")).toBeUndefined();
    expect(resolveTaskSupport("place_market_order")).toBeUndefined();
    expect(resolveTaskSupport("get_account_info")).toBeUndefined();
    expect(resolveTaskSupport("cancel_order")).toBeUndefined();
  });

  it("does NOT downgrade safety-critical tools to async", () => {
    // Critical correctness — never let trade execution run as a task.
    expect(resolveTaskSupport("execute_plan")).toBeUndefined();
    expect(resolveTaskSupport("place_market_order")).toBeUndefined();
    expect(resolveTaskSupport("place_limit_order")).toBeUndefined();
    expect(resolveTaskSupport("cancel_order")).toBeUndefined();
    expect(resolveTaskSupport("withdraw")).toBeUndefined();
    expect(resolveTaskSupport("wallet_transfer")).toBeUndefined();
  });
});

describe("buildTaskAnnotations", () => {
  it("builds annotations for slow tools", () => {
    const annotations = buildTaskAnnotations("run_backtest");
    expect(annotations?.execution?.taskSupport).toBe("required");
  });

  it("returns undefined for synchronous tools", () => {
    expect(buildTaskAnnotations("get_price")).toBeUndefined();
    expect(buildTaskAnnotations("execute_plan")).toBeUndefined();
  });

  it("handles optional-tier tools", () => {
    const annotations = buildTaskAnnotations("scan_market");
    expect(annotations?.execution?.taskSupport).toBe("optional");
  });
});

describe("getTaskToolSets", () => {
  it("returns required + optional sets sorted", () => {
    const sets = getTaskToolSets();
    expect(sets.required.length).toBeGreaterThan(0);
    expect(sets.optional.length).toBeGreaterThan(0);
    expect(sets.required).toEqual([...sets.required].sort());
    expect(sets.optional).toEqual([...sets.optional].sort());
  });

  it("required + optional sets are disjoint", () => {
    const { required, optional } = getTaskToolSets();
    const reqSet = new Set(required);
    for (const opt of optional) {
      expect(reqSet.has(opt)).toBe(false);
    }
  });
});
