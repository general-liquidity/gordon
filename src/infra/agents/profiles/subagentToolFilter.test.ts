import { describe, expect, test } from "bun:test";
import {
  filterToolsForProfile,
  isExecutionTool,
} from "./subagentToolFilter.ts";

const READONLY_REGISTRY = [
  "scan_market",
  "get_candles",
  "get_orderbook",
  "list_skills",
  "load_skill",
  "search_memory",
  "finnhub_company_profile",
  "finnhub_news",
  "smc_pattern_detect",
  "smc_swept_liquidity",
  "read_shared_context",
  // Execution tools live in the registry too — filter is responsible for dropping them.
  "place_market_order",
  "place_limit_order",
  "cancel_order",
  "execute_plan",
  "wallet_transfer",
];

describe("FW7 — isExecutionTool", () => {
  test("execute_plan is execution", () => {
    expect(isExecutionTool("execute_plan")).toBe(true);
  });

  test("place_market_order is execution", () => {
    expect(isExecutionTool("place_market_order")).toBe(true);
  });

  test("cancel_order is execution", () => {
    expect(isExecutionTool("cancel_order")).toBe(true);
  });

  test("wallet_transfer is execution", () => {
    expect(isExecutionTool("wallet_transfer")).toBe(true);
  });

  test("set_permission_mode is execution", () => {
    expect(isExecutionTool("set_permission_mode")).toBe(true);
  });

  test("write_shared_context is execution", () => {
    expect(isExecutionTool("write_shared_context")).toBe(true);
  });

  test("scan_market is NOT execution", () => {
    expect(isExecutionTool("scan_market")).toBe(false);
  });

  test("list_skills is NOT execution", () => {
    expect(isExecutionTool("list_skills")).toBe(false);
  });

  test("read_shared_context is NOT execution", () => {
    expect(isExecutionTool("read_shared_context")).toBe(false);
  });

  test("transfer_funds is execution", () => {
    expect(isExecutionTool("transfer_funds")).toBe(true);
  });

  test("withdraw_to_external is execution", () => {
    expect(isExecutionTool("withdraw_to_external")).toBe(true);
  });

  test("preview_market_order is execution (touches venue API)", () => {
    expect(isExecutionTool("preview_market_order")).toBe(true);
  });
});

describe("FW7 — filterToolsForProfile", () => {
  test("exact match of read-only tools", () => {
    const result = filterToolsForProfile(
      ["scan_market", "list_skills"],
      READONLY_REGISTRY,
    );
    expect(result.allowed).toEqual(["scan_market", "list_skills"]);
    expect(result.unmatched).toEqual([]);
    expect(result.blocked).toEqual([]);
  });

  test("execution tool listed explicitly is blocked", () => {
    const result = filterToolsForProfile(
      ["scan_market", "place_market_order"],
      READONLY_REGISTRY,
    );
    expect(result.allowed).toEqual(["scan_market"]);
    expect(result.blocked).toEqual(["place_market_order"]);
  });

  test("glob matches multiple read-only tools", () => {
    const result = filterToolsForProfile(
      ["smc_*"],
      READONLY_REGISTRY,
    );
    expect(result.allowed).toContain("smc_pattern_detect");
    expect(result.allowed).toContain("smc_swept_liquidity");
    expect(result.blocked).toEqual([]);
  });

  test("glob that includes execution tools drops them silently", () => {
    const result = filterToolsForProfile(
      ["*"],
      READONLY_REGISTRY,
    );
    expect(result.allowed).toContain("scan_market");
    expect(result.allowed).not.toContain("place_market_order");
    expect(result.allowed).not.toContain("execute_plan");
    expect(result.blocked).toContain("place_market_order");
    expect(result.blocked).toContain("execute_plan");
  });

  test("unmatched pattern surfaces", () => {
    const result = filterToolsForProfile(
      ["this_tool_does_not_exist"],
      READONLY_REGISTRY,
    );
    expect(result.allowed).toEqual([]);
    expect(result.unmatched).toEqual(["this_tool_does_not_exist"]);
  });

  test("execution tool unknown to registry is still blocked", () => {
    const result = filterToolsForProfile(
      ["place_nonexistent_order"],
      READONLY_REGISTRY,
    );
    expect(result.blocked).toEqual(["place_nonexistent_order"]);
    expect(result.unmatched).toEqual([]);
  });

  test("empty profile.tools returns empty allowed", () => {
    const result = filterToolsForProfile([], READONLY_REGISTRY);
    expect(result.allowed).toEqual([]);
    expect(result.unmatched).toEqual([]);
    expect(result.blocked).toEqual([]);
  });

  test("duplicates in profile.tools deduplicate in allowed", () => {
    const result = filterToolsForProfile(
      ["scan_market", "scan_market", "scan_market"],
      READONLY_REGISTRY,
    );
    expect(result.allowed).toEqual(["scan_market"]);
  });

  test("allowed order matches registry order", () => {
    const result = filterToolsForProfile(
      ["load_skill", "scan_market", "list_skills"],
      READONLY_REGISTRY,
    );
    // Registry order: scan_market < list_skills < load_skill
    expect(result.allowed).toEqual(["scan_market", "list_skills", "load_skill"]);
  });

  test("complex glob 'finnhub_*' matches all finnhub tools", () => {
    const result = filterToolsForProfile(["finnhub_*"], READONLY_REGISTRY);
    expect(result.allowed).toContain("finnhub_company_profile");
    expect(result.allowed).toContain("finnhub_news");
  });

  test("regex metacharacters in profile pattern are escaped", () => {
    const result = filterToolsForProfile(
      ["scan.market"], // dot is literal, not regex any-char
      READONLY_REGISTRY,
    );
    expect(result.allowed).toEqual([]);
    expect(result.unmatched).toEqual(["scan.market"]);
  });
});
