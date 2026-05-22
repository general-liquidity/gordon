import { describe, it, expect } from "bun:test";
import {
  forkContext,
  type ContextForkAuditEntry,
} from "./contextFork.ts";
import type {
  InvestigationAgentStep,
  InvestigationMessage,
} from "./investigation.ts";

function scriptedAgentStep(
  responses: Array<{
    appendAssistant: string;
    toolCalls?: Array<{ toolId: string }>;
    finished?: boolean;
  }>,
): InvestigationAgentStep {
  let cursor = 0;
  return async ({ messages }) => {
    const next = responses[cursor] ?? { appendAssistant: "ok", finished: true };
    cursor += 1;
    return {
      messages: [
        ...messages,
        { role: "assistant" as const, content: next.appendAssistant },
      ],
      toolCalls: next.toolCalls ?? [],
      finished: next.finished ?? true,
    };
  };
}

describe("forkContext — basic inheritance", () => {
  it("inherits parent messages into the fork", async () => {
    let seen: InvestigationMessage[] = [];
    const result = await forkContext(
      {
        parentMessages: [
          { role: "user", content: "What's the deal with ETH?" },
          { role: "assistant", content: "ETH had a notable breakout earlier." },
        ],
        task: "Deepen the analysis",
        allowedTools: ["scan_market"],
        stripSafetyMessages: false,
      },
      {
        agentStep: async ({ messages }) => {
          seen = messages;
          return {
            messages: [...messages, { role: "assistant" as const, content: "Synthesis" }],
            toolCalls: [],
            finished: true,
          };
        },
      },
    );
    // system + 2 inherited + 1 task
    expect(seen.length).toBe(4);
    expect(result.inheritedMessageCount).toBe(2);
    expect(result.strippedMessageCount).toBe(0);
    expect(result.synthesis).toBe("Synthesis");
  });

  it("reports inheritedMessageCount accurately", async () => {
    const result = await forkContext(
      {
        parentMessages: [
          { role: "user", content: "A" },
          { role: "assistant", content: "B" },
          { role: "user", content: "C" },
        ],
        task: "Continue",
        allowedTools: ["scan_market"],
        stripSafetyMessages: false,
      },
      { agentStep: scriptedAgentStep([{ appendAssistant: "done" }]) },
    );
    expect(result.inheritedMessageCount).toBe(3);
  });

  it("empty parent messages produces a clean fork", async () => {
    const result = await forkContext(
      {
        parentMessages: [],
        task: "From scratch",
        allowedTools: ["scan_market"],
      },
      { agentStep: scriptedAgentStep([{ appendAssistant: "ok" }]) },
    );
    expect(result.inheritedMessageCount).toBe(0);
    expect(result.strippedMessageCount).toBe(0);
  });
});

describe("forkContext — safety filtering", () => {
  it("strips messages containing rationale_recorded marker by default", async () => {
    const result = await forkContext(
      {
        parentMessages: [
          { role: "user", content: "Plan trade" },
          { role: "assistant", content: "execute_plan(symbol=BTCUSDT)" }, // contains marker
          { role: "user", content: "Looks good" },
          { role: "assistant", content: "rationale_recorded for the order" }, // contains marker
          { role: "user", content: "Continue analysis" },
        ],
        task: "Deepen",
        allowedTools: ["scan_market"],
      },
      { agentStep: scriptedAgentStep([{ appendAssistant: "ok" }]) },
    );
    expect(result.strippedMessageCount).toBe(2);
    expect(result.inheritedMessageCount).toBe(3);
  });

  it("strips messages with permission_granted JSON marker", async () => {
    const result = await forkContext(
      {
        parentMessages: [
          { role: "user", content: "Normal context" },
          { role: "assistant", content: '{"permission_granted": "place_order"}' },
        ],
        task: "Continue",
        allowedTools: ["scan_market"],
      },
      { agentStep: scriptedAgentStep([{ appendAssistant: "ok" }]) },
    );
    expect(result.strippedMessageCount).toBe(1);
    expect(result.inheritedMessageCount).toBe(1);
  });

  it("disables safety filter when stripSafetyMessages=false", async () => {
    const result = await forkContext(
      {
        parentMessages: [
          { role: "user", content: "rationale_recorded" },
          { role: "assistant", content: "execute_plan(x)" },
        ],
        task: "Continue",
        allowedTools: ["scan_market"],
        stripSafetyMessages: false,
      },
      { agentStep: scriptedAgentStep([{ appendAssistant: "ok" }]) },
    );
    expect(result.strippedMessageCount).toBe(0);
    expect(result.inheritedMessageCount).toBe(2);
  });

  it("default behavior (no flag) strips safety markers", async () => {
    const result = await forkContext(
      {
        parentMessages: [{ role: "assistant", content: "wallet_transfer(amount=100)" }],
        task: "Continue",
        allowedTools: ["scan_market"],
      },
      { agentStep: scriptedAgentStep([{ appendAssistant: "ok" }]) },
    );
    expect(result.strippedMessageCount).toBe(1);
  });
});

describe("forkContext — deny-list enforcement", () => {
  it("strips execute_plan from allowed tools (delegates to investigation deny-list)", async () => {
    const result = await forkContext(
      {
        parentMessages: [],
        task: "Try to execute a trade",
        allowedTools: ["scan_market", "execute_plan", "place_order"],
      },
      { agentStep: scriptedAgentStep([{ appendAssistant: "ok" }]) },
    );
    expect(result.deniedTools).toContain("execute_plan");
    expect(result.deniedTools).toContain("place_order");
  });
});

describe("forkContext — audit hook", () => {
  it("calls the audit hook with the fork details", async () => {
    let captured: ContextForkAuditEntry | null = null;
    await forkContext(
      {
        parentMessages: [
          { role: "user", content: "Some context" },
          { role: "assistant", content: "execute_plan(x)" }, // will be stripped
        ],
        task: "Analyze further",
        allowedTools: ["scan_market", "execute_plan"],
      },
      {
        agentStep: scriptedAgentStep([{ appendAssistant: "synthesis" }]),
        auditHook: (entry) => {
          captured = entry;
        },
      },
    );
    expect(captured).not.toBeNull();
    expect(captured!.task).toBe("Analyze further");
    expect(captured!.strippedMessageCount).toBe(1);
    expect(captured!.inheritedMessageCount).toBe(1);
    expect(captured!.deniedTools).toContain("execute_plan");
    expect(captured!.toolCallCount).toBe(0);
  });

  it("swallows audit-hook errors silently", async () => {
    const result = await forkContext(
      {
        parentMessages: [],
        task: "x",
        allowedTools: ["scan_market"],
      },
      {
        agentStep: scriptedAgentStep([{ appendAssistant: "ok" }]),
        auditHook: () => {
          throw new Error("audit failed");
        },
      },
    );
    expect(result.synthesis).toBe("ok");
  });
});

describe("forkContext — synthesis return", () => {
  it("returns only the final synthesis (intermediate not in result)", async () => {
    const result = await forkContext(
      {
        parentMessages: [{ role: "user", content: "context" }],
        task: "Investigate",
        allowedTools: ["scan_market"],
        stripSafetyMessages: false,
      },
      {
        agentStep: scriptedAgentStep([
          { appendAssistant: "Step 1 done", toolCalls: [{ toolId: "scan_market" }], finished: false },
          { appendAssistant: "Step 2 done", toolCalls: [{ toolId: "scan_market" }], finished: false },
          { appendAssistant: "Final synthesis: ETH bullish", toolCalls: [], finished: true },
        ]),
      },
    );
    expect(result.synthesis).toBe("Final synthesis: ETH bullish");
    expect(result.toolCallCount).toBe(2);
  });
});
