import { describe, it, expect } from "bun:test";
import {
  runInvestigation,
  INVESTIGATION_SAFETY_DENY_LIST,
  type InvestigationAgentStep,
  type InvestigationMessage,
} from "./investigation.ts";

/**
 * Builds a scripted agent-step mock from a sequence of outputs.
 * Each call consumes one element from the queue.
 */
function scriptedAgentStep(
  responses: Array<{
    appendAssistant: string;
    toolCalls: Array<{ toolId: string; argsSummary?: string }>;
    finished: boolean;
  }>,
): InvestigationAgentStep {
  let cursor = 0;
  return async ({ messages }) => {
    const next = responses[cursor];
    if (!next) {
      throw new Error(`scripted agentStep exhausted at call ${cursor + 1}`);
    }
    cursor += 1;
    return {
      messages: [
        ...messages,
        { role: "assistant" as const, content: next.appendAssistant },
      ],
      toolCalls: next.toolCalls,
      finished: next.finished,
    };
  };
}

describe("runInvestigation — basic flow", () => {
  it("returns the assistant's final synthesis", async () => {
    const result = await runInvestigation(
      { task: "Find the top 3 movers today", allowedTools: ["scan_market"] },
      {
        agentStep: scriptedAgentStep([
          {
            appendAssistant: "Top movers: BTC, ETH, SOL.",
            toolCalls: [{ toolId: "scan_market" }],
            finished: true,
          },
        ]),
      },
    );
    expect(result.synthesis).toBe("Top movers: BTC, ETH, SOL.");
    expect(result.toolCallCount).toBe(1);
    expect(result.budgetExhausted).toBe(false);
    expect(result.rounds).toBe(1);
  });

  it("loops through multiple rounds until finished", async () => {
    const result = await runInvestigation(
      { task: "Investigate", allowedTools: ["scan_market", "get_candles"] },
      {
        agentStep: scriptedAgentStep([
          {
            appendAssistant: "Scanning markets...",
            toolCalls: [{ toolId: "scan_market" }],
            finished: false,
          },
          {
            appendAssistant: "Pulling candles...",
            toolCalls: [{ toolId: "get_candles" }],
            finished: false,
          },
          {
            appendAssistant: "Synthesis: ETH looks strong.",
            toolCalls: [],
            finished: true,
          },
        ]),
      },
    );
    expect(result.synthesis).toBe("Synthesis: ETH looks strong.");
    expect(result.rounds).toBe(3);
    expect(result.toolCallCount).toBe(2);
  });
});

describe("runInvestigation — safety deny-list", () => {
  it("strips execute_plan from allowed tools", async () => {
    const result = await runInvestigation(
      {
        task: "Look around",
        allowedTools: ["scan_market", "execute_plan"],
      },
      {
        agentStep: scriptedAgentStep([
          { appendAssistant: "ok", toolCalls: [], finished: true },
        ]),
      },
    );
    expect(result.deniedTools).toContain("execute_plan");
    expect(result.deniedTools.length).toBe(1);
  });

  it("strips all canonical execution tools", async () => {
    const result = await runInvestigation(
      {
        task: "Look around",
        allowedTools: [
          "place_order",
          "cancel_order",
          "cancel_all_orders",
          "wallet_transfer",
          "withdraw",
          "close_position",
          "scan_market", // this one is fine
        ],
      },
      {
        agentStep: scriptedAgentStep([
          { appendAssistant: "ok", toolCalls: [], finished: true },
        ]),
      },
    );
    expect(result.deniedTools.length).toBe(6);
    expect(result.deniedTools).not.toContain("scan_market");
  });

  it("agentStep sees only the surviving tools (no denied ids)", async () => {
    let observedAllowed: string[] | null = null;
    await runInvestigation(
      {
        task: "Look around",
        allowedTools: ["scan_market", "execute_plan", "get_candles"],
      },
      {
        agentStep: async ({ allowedToolIds }) => {
          observedAllowed = allowedToolIds;
          return {
            messages: [
              { role: "user", content: "x" },
              { role: "assistant", content: "y" },
            ],
            toolCalls: [],
            finished: true,
          };
        },
      },
    );
    expect(observedAllowed).not.toBeNull();
    expect(observedAllowed!).toEqual(["scan_market", "get_candles"]);
    expect(observedAllowed!).not.toContain("execute_plan");
  });

  it("INVESTIGATION_SAFETY_DENY_LIST includes all critical tools", () => {
    const required = [
      "execute_plan",
      "place_order",
      "cancel_order",
      "wallet_transfer",
      "withdraw",
      "close_position",
    ];
    for (const tool of required) {
      expect(INVESTIGATION_SAFETY_DENY_LIST).toContain(tool);
    }
  });
});

describe("runInvestigation — budget enforcement", () => {
  it("respects maxToolCalls cap", async () => {
    const result = await runInvestigation(
      {
        task: "Loop",
        allowedTools: ["scan_market"],
        maxToolCalls: 3,
      },
      {
        agentStep: scriptedAgentStep([
          { appendAssistant: "1", toolCalls: [{ toolId: "scan_market" }], finished: false },
          { appendAssistant: "2", toolCalls: [{ toolId: "scan_market" }], finished: false },
          { appendAssistant: "3", toolCalls: [{ toolId: "scan_market" }], finished: false },
          { appendAssistant: "4", toolCalls: [{ toolId: "scan_market" }], finished: false },
        ]),
      },
    );
    expect(result.budgetExhausted).toBe(true);
    expect(result.toolCallCount).toBeGreaterThan(3);
  });

  it("does not flag budgetExhausted when finishing under cap", async () => {
    const result = await runInvestigation(
      { task: "Short", allowedTools: ["scan_market"], maxToolCalls: 10 },
      {
        agentStep: scriptedAgentStep([
          { appendAssistant: "done", toolCalls: [{ toolId: "scan_market" }], finished: true },
        ]),
      },
    );
    expect(result.budgetExhausted).toBe(false);
  });
});

describe("runInvestigation — context messages", () => {
  it("seeds the agent with optional context messages", async () => {
    let seenMessages: InvestigationMessage[] = [];
    await runInvestigation(
      {
        task: "Continue analysis",
        allowedTools: ["scan_market"],
        contextMessages: [
          { role: "user", content: "Earlier: we discussed BTC" },
          { role: "assistant", content: "BTC showed strong momentum" },
        ],
      },
      {
        agentStep: async ({ messages }) => {
          seenMessages = messages;
          return {
            messages: [...messages, { role: "assistant", content: "ok" }],
            toolCalls: [],
            finished: true,
          };
        },
      },
    );
    // system + 2 context + 1 task = 4 messages
    expect(seenMessages.length).toBe(4);
    expect(seenMessages[1]!.content).toContain("Earlier");
    expect(seenMessages[3]!.content).toBe("Continue analysis");
  });
});

describe("runInvestigation — system prompt", () => {
  it("uses default system prompt when none supplied", async () => {
    let systemSeen = "";
    await runInvestigation(
      { task: "x", allowedTools: ["scan_market"] },
      {
        agentStep: async ({ messages }) => {
          systemSeen = messages[0]!.content;
          return { messages, toolCalls: [], finished: true };
        },
      },
    );
    expect(systemSeen).toContain("read-only");
    expect(systemSeen).toContain("synthesis");
  });

  it("honors custom system prompt", async () => {
    let systemSeen = "";
    await runInvestigation(
      { task: "x", allowedTools: [], systemPrompt: "you are an octopus" },
      {
        agentStep: async ({ messages }) => {
          systemSeen = messages[0]!.content;
          return { messages, toolCalls: [], finished: true };
        },
      },
    );
    expect(systemSeen).toBe("you are an octopus");
  });
});

describe("runInvestigation — timing", () => {
  it("records duration via deps.now", async () => {
    let tick = 1000;
    const now = () => new Date(tick);
    const result = await runInvestigation(
      { task: "x", allowedTools: ["scan_market"] },
      {
        now,
        agentStep: async ({ messages }) => {
          tick += 50;
          return {
            messages: [...messages, { role: "assistant" as const, content: "ok" }],
            toolCalls: [],
            finished: true,
          };
        },
      },
    );
    expect(result.durationMs).toBeGreaterThanOrEqual(50);
  });
});
