import { describe, expect, test } from "bun:test";
import { agentTools, AGENT_TOOL_IDS } from "./index.ts";

describe("Agent tool surface — registry", () => {
  test("exposes exactly 22 tools", () => {
    expect(AGENT_TOOL_IDS.length).toBe(22);
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

    const ids = [...AGENT_TOOL_IDS] as string[];
    for (const id of expected) {
      expect(ids.includes(id)).toBe(true);
    }
  });

  test("no duplicate tool IDs", () => {
    const ids = new Set(AGENT_TOOL_IDS);
    expect(ids.size).toBe(AGENT_TOOL_IDS.length);
  });
});

describe("Agent tools — schema sanity", () => {
  test("every tool has id, description, inputSchema, outputSchema, execute", () => {
    for (const [id, tool] of Object.entries(agentTools)) {
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
    const createPlan = agentTools.create_plan;
    const planResult = (createPlan.inputSchema as any).safeParse({
      symbol: "BTC/USDT",
      side: "buy",
      stopLossPrice: 50000,
      sizeUsd: 1000,
      rationale: "too short",
    });
    expect(planResult.success).toBe(false);

    // approve_plan requires rationale
    const approvePlan = agentTools.approve_plan;
    const approveResult = (approvePlan.inputSchema as any).safeParse({
      planId: "plan-123",
      rationale: "short",
    });
    expect(approveResult.success).toBe(false);

    // cancel requires reason
    const cancel = agentTools.cancel;
    const cancelResult = (cancel.inputSchema as any).safeParse({
      target: "order",
      reason: "short",
    });
    expect(cancelResult.success).toBe(false);
  });

  test("compute_indicator enforces closed indicator enum", () => {
    const tool = agentTools.compute_indicator;
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

describe("Agent tools — input schema accepts canonical examples", () => {
  test("each tool's inputSchema parses a representative payload", () => {
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
      execute_plan: { planId: "plan-x", rationale: "valid test rationale" },
      cancel: { target: "order", id: "ord-1", symbol: "BTC/USDT", reason: "valid test reason" },
      backtest: { strategyId: "support_bounce", symbol: "BTC/USDT" },
      memory_search: { query: "trend" },
      memory_write: { kind: "note", content: "hello" },
      audit_event: { action: "OBSERVATION", summary: "test" },
      skill: { action: "list" },
      delegate_subagent: { role: "general-purpose", task: "test task" },
      ask_user: { question: "test?" },
      schedule_task: { action: "list" },
    };

    for (const [id, tool] of Object.entries(agentTools)) {
      const input = inputs[id];
      expect(input).toBeDefined();
      const parsed = (tool.inputSchema as any).safeParse(input);
      expect(parsed.success).toBe(true);
    }
  });
});
