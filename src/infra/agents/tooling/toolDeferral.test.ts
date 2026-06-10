import { describe, it, expect } from "bun:test";
import {
  DEFAULT_CORE_TOOL_NAMES,
  ToolDeferralRegistry,
  classifyToolNames,
} from "./toolDeferral.ts";

describe("ToolDeferralRegistry", () => {
  it("core tools are always active", () => {
    const r = new ToolDeferralRegistry({
      initial: [{ toolName: "get_price", class: "core" }],
    });
    expect(r.isActive("get_price")).toBe(true);
  });

  it("deferred tools are inactive until activated", () => {
    const r = new ToolDeferralRegistry({
      initial: [{ toolName: "uniswap_pool_info", class: "deferred" }],
    });
    expect(r.isActive("uniswap_pool_info")).toBe(false);
    r.activate("uniswap_pool_info");
    expect(r.isActive("uniswap_pool_info")).toBe(true);
  });

  it("unknown tools default to active (safe)", () => {
    const r = new ToolDeferralRegistry();
    expect(r.isActive("anything_at_all")).toBe(true);
  });

  it("deactivate removes the activation", () => {
    const r = new ToolDeferralRegistry({
      initial: [{ toolName: "x", class: "deferred" }],
    });
    r.activate("x");
    expect(r.isActive("x")).toBe(true);
    r.deactivate("x");
    expect(r.isActive("x")).toBe(false);
  });

  it("tick auto-deactivates idle tools after the configured cap", () => {
    const r = new ToolDeferralRegistry({
      initial: [{ toolName: "x", class: "deferred" }],
      autoDeactivateAfterIdleTurns: 3,
    });
    r.activate("x");
    expect(r.isActive("x")).toBe(true);
    r.tick(new Set()); // idleTurns=1
    expect(r.isActive("x")).toBe(true);
    r.tick(new Set()); // idleTurns=2
    expect(r.isActive("x")).toBe(true);
    const result = r.tick(new Set()); // idleTurns=3 → deactivate
    expect(result.deactivated).toContain("x");
    expect(r.isActive("x")).toBe(false);
  });

  it("tick resets idle when the tool is used", () => {
    const r = new ToolDeferralRegistry({
      initial: [{ toolName: "x", class: "deferred" }],
      autoDeactivateAfterIdleTurns: 2,
    });
    r.activate("x");
    r.tick(new Set()); // idle 1
    r.tick(new Set(["x"])); // resets to 0
    r.tick(new Set()); // idle 1 again
    expect(r.isActive("x")).toBe(true);
  });

  it("idleCap=0 disables auto-deactivation", () => {
    const r = new ToolDeferralRegistry({
      initial: [{ toolName: "x", class: "deferred" }],
      autoDeactivateAfterIdleTurns: 0,
    });
    r.activate("x");
    for (let i = 0; i < 100; i++) r.tick(new Set());
    expect(r.isActive("x")).toBe(true);
  });

  it("search matches name / description / family", () => {
    const r = new ToolDeferralRegistry({
      initial: [
        { toolName: "uniswap_pool", class: "deferred", family: "defi", description: "Uniswap V3 pool info" },
        { toolName: "solana_balance", class: "deferred", family: "solana" },
        { toolName: "get_price", class: "core" },
      ],
    });
    expect(r.search("uniswap").length).toBe(1);
    expect(r.search("defi")[0]?.toolName).toBe("uniswap_pool");
    expect(r.search("pool info")[0]?.toolName).toBe("uniswap_pool");
    // Core tools are excluded from search
    expect(r.search("get_price")).toEqual([]);
  });

  it("filterActive keeps core + active-deferred + unknown", () => {
    const r = new ToolDeferralRegistry({
      initial: [
        { toolName: "get_price", class: "core" },
        { toolName: "uniswap_pool", class: "deferred" },
      ],
    });
    const all = {
      get_price: "P",
      uniswap_pool: "U",
      unknown_tool: "X",
    };
    expect(r.filterActive(all)).toEqual({ get_price: "P", unknown_tool: "X" });
    r.activate("uniswap_pool");
    expect(r.filterActive(all)).toEqual(all);
  });

  it("snapshot reports counts", () => {
    const r = new ToolDeferralRegistry({
      initial: [
        { toolName: "a", class: "core" },
        { toolName: "b", class: "core" },
        { toolName: "c", class: "deferred" },
        { toolName: "d", class: "deferred" },
      ],
    });
    r.activate("c");
    const snap = r.snapshot();
    expect(snap.coreCount).toBe(2);
    expect(snap.deferredCount).toBe(2);
    expect(snap.activeDeferredCount).toBe(1);
  });
});

describe("classifyToolNames", () => {
  it("marks the canonical core set as core", () => {
    const out = classifyToolNames(["get_price", "scan_market", "get_portfolio"]);
    expect(out.every((e) => e.class === "core")).toBe(true);
  });

  it("marks unknown tools as deferred", () => {
    const out = classifyToolNames(["weird_unique_tool_name"]);
    expect(out[0]?.class).toBe("deferred");
  });

  it("infers family from prefixes", () => {
    const families = classifyToolNames([
      "get_ticker", "place_limit_order", "defillama_yields", "finnhub_news",
      "backtest_strategy", "search_memory",
    ]);
    expect(families.find((e) => e.toolName === "get_ticker")?.family).toBe("market");
    expect(families.find((e) => e.toolName === "place_limit_order")?.family).toBe("trading");
    expect(families.find((e) => e.toolName === "defillama_yields")?.family).toBe("defi");
    expect(families.find((e) => e.toolName === "finnhub_news")?.family).toBe("finnhub");
    expect(families.find((e) => e.toolName === "backtest_strategy")?.family).toBe("backtest");
    expect(families.find((e) => e.toolName === "search_memory")?.family).toBe("memory");
  });

  it("DEFAULT_CORE_TOOL_NAMES contains the workhorses", () => {
    expect(DEFAULT_CORE_TOOL_NAMES.has("get_price")).toBe(true);
    expect(DEFAULT_CORE_TOOL_NAMES.has("scan_market")).toBe(true);
    expect(DEFAULT_CORE_TOOL_NAMES.has("get_portfolio")).toBe(true);
    expect(DEFAULT_CORE_TOOL_NAMES.has("preview_market_order")).toBe(true);
    expect(DEFAULT_CORE_TOOL_NAMES.has("check_risk")).toBe(true);
  });
});
