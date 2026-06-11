import { describe, expect, test } from "bun:test";
import { approvalRulesToQuickCheckRules } from "./runtime.ts";
import { quickPermissionCheck } from "../../infra/permissions/racing.ts";
import type { RuntimeApprovalRule } from "../../runtime/contracts/types.ts";

const NOW = Date.parse("2026-06-11T12:00:00Z");

function rule(overrides: Partial<RuntimeApprovalRule>): RuntimeApprovalRule {
  return {
    id: overrides.id ?? "rule-1",
    decision: "allow",
    scope: "session",
    createdAt: new Date(NOW - 60_000).toISOString(),
    createdBy: "human",
    ...overrides,
  };
}

function quickCheck(
  rules: RuntimeApprovalRule[],
  toolName: string,
  scope: RuntimeApprovalRule["permissionScope"] = "market.read",
) {
  return quickPermissionCheck(
    approvalRulesToQuickCheckRules(rules, scope, NOW),
    toolName,
    undefined,
  );
}

describe("approvalRulesToQuickCheckRules + quickPermissionCheck", () => {
  test("no rules → null (falls through to risk kernel + dialog)", () => {
    expect(quickCheck([], "get_market_data")).toBeNull();
  });

  test("exact toolName allow rule short-circuits to allow", () => {
    const result = quickCheck([rule({ toolName: "get_market_data" })], "get_market_data");
    expect(result?.decision).toBe("allow");
  });

  test("exact toolName deny rule short-circuits to deny", () => {
    const result = quickCheck(
      [rule({ toolName: "place_order", decision: "deny" })],
      "place_order",
    );
    expect(result?.decision).toBe("deny");
  });

  test("non-matching toolName → null", () => {
    expect(quickCheck([rule({ toolName: "place_order" })], "get_market_data")).toBeNull();
  });

  test("glob toolNamePattern matches", () => {
    const result = quickCheck([rule({ toolNamePattern: "kraken_*" })], "kraken_get_balance");
    expect(result?.decision).toBe("allow");
  });

  test("expired rule is dropped", () => {
    const expired = rule({
      toolName: "get_market_data",
      expiresAt: new Date(NOW - 1).toISOString(),
    });
    expect(quickCheck([expired], "get_market_data")).toBeNull();
  });

  test("permissionScope mismatch is dropped, match is honored", () => {
    const scoped = rule({ toolName: "place_order", permissionScope: "papertrade.execute" });
    expect(quickCheck([scoped], "place_order", "livetrade.execute")).toBeNull();
    expect(quickCheck([scoped], "place_order", "papertrade.execute")?.decision).toBe("allow");
  });

  test("rule with both toolName and toolNamePattern defers to the kernel path", () => {
    const both = rule({ toolName: "place_order", toolNamePattern: "place_*" });
    expect(quickCheck([both], "place_order")).toBeNull();
  });

  test("exact toolName rule beats pattern rule regardless of recency", () => {
    const newerPatternAllow = rule({
      id: "pattern-allow",
      toolNamePattern: "place_*",
      createdAt: new Date(NOW - 1_000).toISOString(),
    });
    const olderExactDeny = rule({
      id: "exact-deny",
      toolName: "place_order",
      decision: "deny",
      createdAt: new Date(NOW - 600_000).toISOString(),
    });
    const result = quickCheck([newerPatternAllow, olderExactDeny], "place_order");
    expect(result?.decision).toBe("deny");
  });

  test("within the same specificity tier the most recent rule wins", () => {
    const olderAllow = rule({
      id: "older",
      toolName: "place_order",
      createdAt: new Date(NOW - 600_000).toISOString(),
    });
    const newerDeny = rule({
      id: "newer",
      toolName: "place_order",
      decision: "deny",
      createdAt: new Date(NOW - 1_000).toISOString(),
    });
    const result = quickCheck([olderAllow, newerDeny], "place_order");
    expect(result?.decision).toBe("deny");
  });

  test("catch-all rule (no name, no pattern, no scope) matches everything", () => {
    const result = quickCheck([rule({ decision: "deny" })], "anything_at_all");
    expect(result?.decision).toBe("deny");
  });
});
