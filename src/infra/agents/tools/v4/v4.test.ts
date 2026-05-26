import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { v4Tools, V4_TOOL_IDS, getV4Tools, isV4Active } from "./index.ts";

describe("V4 tool surface — registry", () => {
  test("exposes exactly 22 tools", () => {
    expect(V4_TOOL_IDS.length).toBe(22);
  });

  test("each expected tool ID is present", () => {
    const expected = [
      // data (5)
      "get_market_data",
      "get_account_state",
      "get_portfolio",
      "get_news",
      "get_fundamentals",
      // analytics (4)
      "compute_indicator",
      "compute_regime",
      "compute_risk",
      "compute_microstructure",
      // plan (6)
      "create_plan",
      "verify_plan",
      "approve_plan",
      "execute_plan",
      "cancel",
      "backtest",
      // memory (3)
      "memory_search",
      "memory_write",
      "audit_event",
      // workflow (4)
      "skill",
      "delegate_subagent",
      "ask_user",
      "schedule_task",
    ];

    const ids = [...V4_TOOL_IDS] as string[];
    for (const id of expected) {
      expect(ids.includes(id)).toBe(true);
    }
  });

  test("no duplicate tool IDs", () => {
    const ids = new Set(V4_TOOL_IDS);
    expect(ids.size).toBe(V4_TOOL_IDS.length);
  });
});

describe("V4 tool surface — feature flag", () => {
  const originalFlag = process.env.GORDON_V4_TOOLS;

  beforeEach(() => {
    delete process.env.GORDON_V4_TOOLS;
  });

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.GORDON_V4_TOOLS;
    else process.env.GORDON_V4_TOOLS = originalFlag;
  });

  test("getV4Tools returns empty object when flag unset", () => {
    expect(Object.keys(getV4Tools())).toHaveLength(0);
    expect(isV4Active()).toBe(false);
  });

  test("getV4Tools returns full surface when flag=1", () => {
    process.env.GORDON_V4_TOOLS = "1";
    expect(Object.keys(getV4Tools())).toHaveLength(22);
    expect(isV4Active()).toBe(true);
  });

  test("getV4Tools returns empty for flag=0 or other values", () => {
    process.env.GORDON_V4_TOOLS = "0";
    expect(Object.keys(getV4Tools())).toHaveLength(0);
    expect(isV4Active()).toBe(false);

    process.env.GORDON_V4_TOOLS = "true";
    expect(Object.keys(getV4Tools())).toHaveLength(0);
  });
});

describe("V4 tools — schema sanity", () => {
  test("every tool has id, description, inputSchema, outputSchema, execute", () => {
    for (const [id, tool] of Object.entries(v4Tools)) {
      expect(tool.id as string).toBe(id);
      expect(typeof tool.description).toBe("string");
      expect((tool.description as string).length).toBeGreaterThan(60);
      expect(tool.inputSchema).toBeDefined();
      expect(tool.outputSchema).toBeDefined();
      expect(typeof tool.execute).toBe("function");
    }
  });

  test("safety-critical tools require rationale/reason", () => {
    // create_plan requires rationale
    const createPlan = v4Tools.create_plan;
    const planResult = (createPlan.inputSchema as any).safeParse({
      symbol: "BTC/USDT",
      side: "buy",
      stopLossPrice: 50000,
      sizeUsd: 1000,
      rationale: "too short",
    });
    expect(planResult.success).toBe(false);

    // approve_plan requires rationale
    const approvePlan = v4Tools.approve_plan;
    const approveResult = (approvePlan.inputSchema as any).safeParse({
      planId: "plan-123",
      rationale: "short",
    });
    expect(approveResult.success).toBe(false);

    // cancel requires reason
    const cancel = v4Tools.cancel;
    const cancelResult = (cancel.inputSchema as any).safeParse({
      target: "order",
      reason: "short",
    });
    expect(cancelResult.success).toBe(false);
  });

  test("compute_indicator enforces closed indicator enum", () => {
    const tool = v4Tools.compute_indicator;
    const ok = (tool.inputSchema as any).safeParse({
      indicator: "rsi",
      symbol: "BTC/USDT",
    });
    expect(ok.success).toBe(true);

    const bad = (tool.inputSchema as any).safeParse({
      indicator: "made_up_indicator",
      symbol: "BTC/USDT",
    });
    expect(bad.success).toBe(false);
  });
});

describe("V4 tools — stub execution does not throw", () => {
  test("each tool's stub execute runs cleanly without context", async () => {
    for (const [id, tool] of Object.entries(v4Tools)) {
      // Build a minimum-valid input for each tool's schema. zod's parse
      // with .default()-less schemas means we provide concrete values.
      const inputs: Record<string, unknown> = {
        get_market_data: { dataType: "price", symbol: "BTC/USDT" },
        get_account_state: {},
        get_portfolio: {},
        get_news: {},
        get_fundamentals: { ticker: "AAPL", metric: "profile" },
        compute_indicator: { indicator: "rsi", symbol: "BTC/USDT" },
        compute_regime: { symbol: "BTC/USDT" },
        compute_risk: { symbol: "BTC/USDT", side: "buy", notionalUsd: 1000 },
        compute_microstructure: { operation: "microprice", params: {} },
        create_plan: {
          symbol: "BTC/USDT",
          side: "buy",
          stopLossPrice: 50000,
          sizeUsd: 1000,
          rationale: "valid test rationale",
        },
        verify_plan: { planId: "plan-x" },
        approve_plan: { planId: "plan-x", rationale: "valid test rationale" },
        execute_plan: { planId: "plan-x" },
        cancel: { target: "order", id: "ord-1", reason: "valid test reason" },
        backtest: {
          symbol: "BTC/USDT",
          startDate: "2024-01-01",
          endDate: "2024-06-01",
        },
        memory_search: { query: "trend" },
        memory_write: { kind: "note", content: "hello" },
        audit_event: { action: "OBSERVATION", summary: "test" },
        skill: { action: "list" },
        delegate_subagent: { role: "general-purpose", task: "test task" },
        ask_user: { question: "test?" },
        schedule_task: { action: "list" },
      };

      const input = inputs[id];
      expect(input, `missing test input for ${id}`).toBeDefined();

      // Stubs should not throw — they return placeholder payloads.
      const result = await (tool.execute as any)(input, undefined);
      expect(result, `${id} returned no result`).toBeDefined();
    }
  });
});
