import { describe, it, expect } from "bun:test";
import { createSynthesisAgentStep } from "./synthesisAgentStep.ts";

describe("createSynthesisAgentStep", () => {
  it("returns the LLM response as the assistant message", async () => {
    const step = createSynthesisAgentStep({
      llm: { call: async () => "  the synthesis  " },
    });
    const out = await step({
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "hi" },
      ],
      allowedToolIds: [],
    });
    expect(out.messages.length).toBe(3);
    expect(out.messages[2]!.content).toBe("the synthesis");
    expect(out.messages[2]!.role).toBe("assistant");
  });

  it("marks finished after the first call (no loop)", async () => {
    const step = createSynthesisAgentStep({
      llm: { call: async () => "done" },
    });
    const out = await step({
      messages: [{ role: "user", content: "x" }],
      allowedToolIds: [],
    });
    expect(out.finished).toBe(true);
    expect(out.toolCalls).toEqual([]);
  });

  it("surfaces allowed tools to the system prompt by default", async () => {
    let lastMessages: Array<{ role: string; content: string }> = [];
    const step = createSynthesisAgentStep({
      llm: {
        call: async (messages) => {
          lastMessages = messages;
          return "ok";
        },
      },
    });
    await step({
      messages: [{ role: "user", content: "task" }],
      allowedToolIds: ["scan_market", "get_candles"],
    });
    // Final message should be the injected system note listing tools
    const last = lastMessages[lastMessages.length - 1]!;
    expect(last.role).toBe("system");
    expect(last.content).toContain("scan_market");
    expect(last.content).toContain("get_candles");
    expect(last.content).toContain("cannot call them");
  });

  it("respects surfaceAllowedTools=false", async () => {
    let lastMessages: Array<{ role: string; content: string }> = [];
    const step = createSynthesisAgentStep({
      surfaceAllowedTools: false,
      llm: {
        call: async (messages) => {
          lastMessages = messages;
          return "ok";
        },
      },
    });
    await step({
      messages: [{ role: "user", content: "task" }],
      allowedToolIds: ["scan_market"],
    });
    // No system-injected tool note
    for (const m of lastMessages) {
      expect(m.content).not.toContain("Read-only context");
    }
  });

  it("works with empty allowed tools list (no injected note)", async () => {
    let lastMessages: Array<{ role: string; content: string }> = [];
    const step = createSynthesisAgentStep({
      llm: {
        call: async (messages) => {
          lastMessages = messages;
          return "ok";
        },
      },
    });
    await step({
      messages: [{ role: "user", content: "task" }],
      allowedToolIds: [],
    });
    for (const m of lastMessages) {
      expect(m.content).not.toContain("Read-only context");
    }
  });
});
