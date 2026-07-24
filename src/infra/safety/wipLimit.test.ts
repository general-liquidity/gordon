import { describe, it, expect } from "bun:test";

import {
  isWipLimitEnabled,
  readWipLimitsFromEnv,
  gatePlan,
  createWipRegistry,
  wipResultToPayload,
  DEFAULT_LIMITS,
  WIP_FLAG_ENV,
  WIP_PER_SYMBOL_ENV,
  WIP_PER_STRATEGY_ENV,
  WIP_GLOBAL_ENV,
  type ActivePlan,
} from "./wipLimit.ts";

const plan = (id: string, symbol: string, strategy: string, t = 0): ActivePlan => ({
  planId: id,
  symbol,
  strategy,
  activeSinceMs: t,
});

describe("isWipLimitEnabled", () => {
  it("respects the flag (default-on, explicit opt-out)", () => {
    expect(isWipLimitEnabled({})).toBe(true);
    expect(isWipLimitEnabled({ [WIP_FLAG_ENV]: "1" })).toBe(true);
    expect(isWipLimitEnabled({ [WIP_FLAG_ENV]: "true" })).toBe(true);
    expect(isWipLimitEnabled({ [WIP_FLAG_ENV]: "0" })).toBe(false);
    expect(isWipLimitEnabled({ [WIP_FLAG_ENV]: "false" })).toBe(false);
  });
});

describe("readWipLimitsFromEnv", () => {
  it("returns sensible defaults", () => {
    const l = readWipLimitsFromEnv({});
    expect(l.perSymbol).toBe(1);
    expect(l.perStrategy).toBe(Infinity);
    expect(l.global).toBe(Infinity);
  });

  it("respects overrides", () => {
    const l = readWipLimitsFromEnv({
      [WIP_PER_SYMBOL_ENV]: "3",
      [WIP_PER_STRATEGY_ENV]: "5",
      [WIP_GLOBAL_ENV]: "10",
    });
    expect(l.perSymbol).toBe(3);
    expect(l.perStrategy).toBe(5);
    expect(l.global).toBe(10);
  });

  it("treats 0 / Infinity as unbounded", () => {
    expect(readWipLimitsFromEnv({ [WIP_PER_SYMBOL_ENV]: "0" }).perSymbol).toBe(Infinity);
    expect(readWipLimitsFromEnv({ [WIP_PER_SYMBOL_ENV]: "Infinity" }).perSymbol).toBe(Infinity);
  });

  it("rejects nonsense and falls back to default", () => {
    expect(readWipLimitsFromEnv({ [WIP_PER_SYMBOL_ENV]: "abc" }).perSymbol).toBe(1);
    expect(readWipLimitsFromEnv({ [WIP_PER_SYMBOL_ENV]: "-5" }).perSymbol).toBe(1);
  });
});

describe("gatePlan", () => {
  it("allows when no plans are active", () => {
    const r = gatePlan({ symbol: "BTC/USD", strategy: "rsi", active: [] }, DEFAULT_LIMITS);
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe("ok");
  });

  it("blocks per-symbol when limit reached", () => {
    const r = gatePlan({
      symbol: "BTC/USD",
      strategy: "macd",
      active: [plan("p1", "BTC/USD", "rsi")],
    }, DEFAULT_LIMITS);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("per-symbol");
    expect(r.blockingPlanIds).toEqual(["p1"]);
  });

  it("allows plans for different symbols up to per-symbol limit each", () => {
    const r = gatePlan({
      symbol: "ETH/USD",
      strategy: "rsi",
      active: [plan("p1", "BTC/USD", "rsi")],
    }, DEFAULT_LIMITS);
    expect(r.allowed).toBe(true);
  });

  it("respects perSymbol=2", () => {
    const limits = { ...DEFAULT_LIMITS, perSymbol: 2 };
    const oneActive = gatePlan({
      symbol: "BTC/USD",
      strategy: "rsi",
      active: [plan("p1", "BTC/USD", "x")],
    }, limits);
    expect(oneActive.allowed).toBe(true);
    const twoActive = gatePlan({
      symbol: "BTC/USD",
      strategy: "rsi",
      active: [plan("p1", "BTC/USD", "x"), plan("p2", "BTC/USD", "y")],
    }, limits);
    expect(twoActive.allowed).toBe(false);
  });

  it("blocks per-strategy when limit reached", () => {
    const limits = { ...DEFAULT_LIMITS, perSymbol: Infinity, perStrategy: 1 };
    const r = gatePlan({
      symbol: "ETH/USD",
      strategy: "rsi",
      active: [plan("p1", "BTC/USD", "rsi")],
    }, limits);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("per-strategy");
  });

  it("blocks global when limit reached", () => {
    const limits = { perSymbol: Infinity, perStrategy: Infinity, global: 2 };
    const r = gatePlan({
      symbol: "DOGE/USD",
      strategy: "x",
      active: [plan("p1", "BTC/USD", "a"), plan("p2", "ETH/USD", "b")],
    }, limits);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("global");
    expect(r.blockingPlanIds.length).toBe(2);
  });

  it("global block takes precedence over per-symbol", () => {
    const limits = { perSymbol: Infinity, perStrategy: Infinity, global: 1 };
    const r = gatePlan({
      symbol: "BTC/USD",
      strategy: "x",
      active: [plan("p1", "ETH/USD", "y")],
    }, limits);
    expect(r.reason).toBe("global");
  });
});

describe("createWipRegistry", () => {
  it("starts empty", () => {
    const r = createWipRegistry();
    expect(r.size()).toBe(0);
    expect(r.active()).toEqual([]);
  });

  it("tracks active plans", () => {
    const r = createWipRegistry();
    r.markActive({ planId: "p1", symbol: "BTC/USD", strategy: "rsi" });
    r.markActive({ planId: "p2", symbol: "ETH/USD", strategy: "rsi" });
    expect(r.size()).toBe(2);
    expect(r.activeBySymbol("BTC/USD").length).toBe(1);
    expect(r.activeByStrategy("rsi").length).toBe(2);
  });

  it("markActive is idempotent on duplicate planId", () => {
    const r = createWipRegistry();
    r.markActive({ planId: "p1", symbol: "BTC/USD", strategy: "rsi" });
    r.markActive({ planId: "p1", symbol: "BTC/USD", strategy: "rsi" });
    expect(r.size()).toBe(1);
  });

  it("markInactive removes and returns true on hit", () => {
    const r = createWipRegistry();
    r.markActive({ planId: "p1", symbol: "BTC/USD", strategy: "rsi" });
    expect(r.markInactive("p1")).toBe(true);
    expect(r.size()).toBe(0);
    expect(r.markInactive("never-existed")).toBe(false);
  });

  it("gate uses configured limits", () => {
    const r = createWipRegistry({ perSymbol: 1, perStrategy: Infinity, global: Infinity });
    expect(r.gate("BTC/USD", "rsi").allowed).toBe(true);
    r.markActive({ planId: "p1", symbol: "BTC/USD", strategy: "rsi" });
    const blocked = r.gate("BTC/USD", "macd");
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toBe("per-symbol");
  });

  it("clear empties the registry", () => {
    const r = createWipRegistry();
    r.markActive({ planId: "p1", symbol: "BTC/USD", strategy: "rsi" });
    r.markActive({ planId: "p2", symbol: "ETH/USD", strategy: "rsi" });
    r.clear();
    expect(r.size()).toBe(0);
  });

  it("uses injected now timestamp", () => {
    const r = createWipRegistry();
    r.markActive({ planId: "p1", symbol: "BTC/USD", strategy: "rsi" }, 12345);
    expect(r.active()[0]!.activeSinceMs).toBe(12345);
  });
});

describe("wipResultToPayload", () => {
  it("emits stable shape", () => {
    const result = gatePlan({ symbol: "BTC/USD", strategy: "x", active: [] }, DEFAULT_LIMITS);
    const p = wipResultToPayload(result);
    expect(p.kind).toBe("wip_limit.gate_recorded");
    expect(p.allowed).toBe(true);
    expect(p.reason).toBe("ok");
  });
});
