import { afterEach, describe, expect, test } from "bun:test";
import type { RiskTier } from "../../trading/risk/riskClassifier.ts";
import {
  applyNativeApprovalMarkers,
  buildRequireApproval,
  buildRequireToolApproval,
  decideNativeApproval,
  isNativeApprovalTool,
  isNativeToolApprovalEnabled,
  NATIVE_APPROVAL_TOOL_IDS,
  setPlanTierResolver,
} from "./nativeToolApproval.ts";

const ON = { GORDON_NATIVE_TOOL_APPROVAL: "1" } as unknown as NodeJS.ProcessEnv;
const OFF = {} as unknown as NodeJS.ProcessEnv;

afterEach(() => {
  setPlanTierResolver(undefined);
});

describe("flag gating", () => {
  test("disabled by default", () => {
    expect(isNativeToolApprovalEnabled(OFF)).toBe(false);
  });
  test("enabled via 1 or true", () => {
    expect(isNativeToolApprovalEnabled(ON)).toBe(true);
    expect(isNativeToolApprovalEnabled({ GORDON_NATIVE_TOOL_APPROVAL: "true" } as any)).toBe(true);
  });
});

describe("tool membership", () => {
  test("money-path ids are covered", () => {
    for (const id of ["execute_plan", "cancel", "cancel_order", "cancel_all_orders", "cancel_replace_order", "cancel_order_list"]) {
      expect(isNativeApprovalTool(id)).toBe(true);
      expect(NATIVE_APPROVAL_TOOL_IDS).toContain(id as any);
    }
  });
  test("non-money tools are not covered", () => {
    expect(isNativeApprovalTool("get_market_data")).toBe(false);
    expect(isNativeApprovalTool("create_plan")).toBe(false);
  });
});

describe("buildRequireApproval — flag off is inert", () => {
  test("execute_plan never requires approval when flag off", async () => {
    const pred = buildRequireApproval("execute_plan", OFF);
    expect(await pred({ planId: "p1", rationale: "x" })).toBe(false);
  });
  test("cancel_order never requires approval when flag off", async () => {
    const pred = buildRequireApproval("cancel_order", OFF);
    expect(await pred({ orderId: "o1" })).toBe(false);
  });
});

describe("buildRequireApproval — cancel family always fires when on", () => {
  test.each(["cancel", "cancel_order", "cancel_all_orders", "cancel_replace_order", "cancel_order_list"])(
    "%s requires approval",
    async (id) => {
      expect(await buildRequireApproval(id, ON)({})).toBe(true);
    },
  );
});

describe("buildRequireApproval — execute_plan tier gating", () => {
  test("fails safe (requires approval) when no resolver registered", async () => {
    const pred = buildRequireApproval("execute_plan", ON);
    expect(await pred({ planId: "p1" })).toBe(true);
  });

  test("fails safe when no planId in input", async () => {
    setPlanTierResolver(() => "low");
    const pred = buildRequireApproval("execute_plan", ON);
    expect(await pred({})).toBe(true);
  });

  test("low tier does NOT require approval (current behavior preserved)", async () => {
    setPlanTierResolver(() => "low");
    const pred = buildRequireApproval("execute_plan", ON);
    expect(await pred({ planId: "p1" })).toBe(false);
  });

  test.each(["medium", "high", "critical"] as RiskTier[])(
    "%s tier requires approval",
    async (tier) => {
      setPlanTierResolver(() => tier);
      const pred = buildRequireApproval("execute_plan", ON);
      expect(await pred({ planId: "p1" })).toBe(true);
    },
  );

  test("resolver returning undefined fails safe", async () => {
    setPlanTierResolver(() => undefined);
    expect(await buildRequireApproval("execute_plan", ON)({ planId: "p1" })).toBe(true);
  });

  test("resolver throwing fails safe", async () => {
    setPlanTierResolver(() => {
      throw new Error("boom");
    });
    expect(await buildRequireApproval("execute_plan", ON)({ planId: "p1" })).toBe(true);
  });

  test("async resolver is awaited", async () => {
    setPlanTierResolver(async (): Promise<RiskTier> => "low");
    expect(await buildRequireApproval("execute_plan", ON)({ planId: "p1" })).toBe(false);
  });
});

describe("buildRequireToolApproval — global stream predicate", () => {
  test("off when flag off", async () => {
    const fn = buildRequireToolApproval(OFF);
    expect(await fn({ toolName: "execute_plan", args: { planId: "p1" } })).toBe(false);
  });
  test("non-money tool ignored", async () => {
    const fn = buildRequireToolApproval(ON);
    expect(await fn({ toolName: "get_market_data", args: {} })).toBe(false);
  });
  test("cancel fires", async () => {
    const fn = buildRequireToolApproval(ON);
    expect(await fn({ toolName: "cancel_all_orders", args: { symbol: "BTCUSDT" } })).toBe(true);
  });
  test("execute_plan low tier does not fire", async () => {
    setPlanTierResolver(() => "low");
    const fn = buildRequireToolApproval(ON);
    expect(await fn({ toolName: "execute_plan", args: { planId: "p1" } })).toBe(false);
  });
});

describe("applyNativeApprovalMarkers", () => {
  test("no-op when flag off", () => {
    const tools: Record<string, { id?: string; requireApproval?: unknown }> = {
      execute_plan: { id: "execute_plan" },
      cancel_order: { id: "cancel_order" },
    };
    expect(applyNativeApprovalMarkers(tools, OFF)).toEqual([]);
    expect(tools.execute_plan!.requireApproval).toBeUndefined();
  });

  test("marks only money-path tools when on", () => {
    const tools: Record<string, { id?: string; requireApproval?: unknown }> = {
      execute_plan: { id: "execute_plan" },
      cancel_order: { id: "cancel_order" },
      get_market_data: { id: "get_market_data" },
    };
    const marked = applyNativeApprovalMarkers(tools, ON);
    expect(marked.sort()).toEqual(["cancel_order", "execute_plan"]);
    expect(typeof tools.execute_plan!.requireApproval).toBe("function");
    expect(typeof tools.cancel_order!.requireApproval).toBe("function");
    expect(tools.get_market_data!.requireApproval).toBeUndefined();
  });

  test("falls back to registry key when tool.id absent", () => {
    const tools: Record<string, { id?: string; requireApproval?: unknown }> = {
      cancel_order: {},
    };
    expect(applyNativeApprovalMarkers(tools, ON)).toEqual(["cancel_order"]);
  });
});

describe("decideNativeApproval — never approves what the gate blocks", () => {
  test("blocked → decline", () => {
    const d = decideNativeApproval({ blocked: true });
    expect(d.action).toBe("decline");
  });
  test("kill switch engaged → decline", () => {
    const d = decideNativeApproval({ blocked: false, executionAllowed: false });
    expect(d.action).toBe("decline");
  });
  test("risk classifier block → decline", () => {
    const d = decideNativeApproval({ blocked: false, recommendation: "block" });
    expect(d.action).toBe("decline");
  });
  test("permitted (require_confirmation) → prompt human", () => {
    const d = decideNativeApproval({
      blocked: false,
      executionAllowed: true,
      recommendation: "require_confirmation",
    });
    expect(d.action).toBe("prompt");
  });
  test("permitted (auto_approve) → prompt human (native layer still gates)", () => {
    const d = decideNativeApproval({
      blocked: false,
      executionAllowed: true,
      recommendation: "auto_approve",
    });
    expect(d.action).toBe("prompt");
  });
  test("blocked wins even if recommendation is permissive", () => {
    const d = decideNativeApproval({
      blocked: true,
      executionAllowed: true,
      recommendation: "auto_approve",
    });
    expect(d.action).toBe("decline");
  });
});
