import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { GordonConfigSchema } from "../../types/config.ts";
import {
  shouldRunToolFreeThinking,
  prependThinkingTrace,
  getThinkingDepthFromContext,
} from "./thinkingPhase.ts";
import type { GordonContext } from "./types.ts";

function createContext(overrides: Partial<GordonContext> = {}): GordonContext {
  return {
    binance: null,
    exchange: null,
    broker: null,
    agentRails: null,
    llm: {} as GordonContext["llm"],
    config: GordonConfigSchema.parse({
      permissionMode: "auto",
      modelConfig: { provider: "openai", model: "gpt-5.4" },
    }),
    portfolioValue: 10000,
    availableCash: 1000,
    threadId: "thread-think",
    requestedActionId: undefined,
    requestedTaskScope: undefined,
    ...overrides,
  };
}

const ORIG_FLAG = process.env.GORDON_TOOL_FREE_THINKING;
const ORIG_DEPTH = process.env.GORDON_THINKING_DEPTH;

beforeEach(() => {
  delete process.env.GORDON_TOOL_FREE_THINKING;
  delete process.env.GORDON_THINKING_DEPTH;
});

afterEach(() => {
  if (ORIG_FLAG !== undefined) process.env.GORDON_TOOL_FREE_THINKING = ORIG_FLAG;
  else delete process.env.GORDON_TOOL_FREE_THINKING;
  if (ORIG_DEPTH !== undefined) process.env.GORDON_THINKING_DEPTH = ORIG_DEPTH;
  else delete process.env.GORDON_THINKING_DEPTH;
});

describe("shouldRunToolFreeThinking gate", () => {
  it("returns false when GORDON_TOOL_FREE_THINKING is unset", () => {
    const ctx = createContext();
    const decision = shouldRunToolFreeThinking("a long message ".repeat(20), ctx);
    expect(decision.run).toBe(false);
    expect(decision.reason).toContain("flag");
  });

  it("triggers when message > 200 chars", () => {
    process.env.GORDON_TOOL_FREE_THINKING = "true";
    const ctx = createContext();
    const long = "a".repeat(201);
    const decision = shouldRunToolFreeThinking(long, ctx);
    expect(decision.run).toBe(true);
    expect(decision.reason).toBe("user message > 200 chars");
  });

  it("triggers when thinkingDepth is medium", () => {
    process.env.GORDON_TOOL_FREE_THINKING = "true";
    process.env.GORDON_THINKING_DEPTH = "medium";
    const ctx = createContext();
    const decision = shouldRunToolFreeThinking("short msg", ctx);
    expect(decision.run).toBe(true);
    expect(decision.reason).toBe("thinkingDepth=medium");
  });

  it("triggers in planning phase", () => {
    process.env.GORDON_TOOL_FREE_THINKING = "true";
    const ctx = createContext({ requestedTaskScope: "planning" });
    const decision = shouldRunToolFreeThinking("plan trade", ctx);
    expect(decision.run).toBe(true);
    expect(decision.reason).toBe("phase=planning");
  });

  it("does NOT trigger for routine analysis below complexity threshold", () => {
    process.env.GORDON_TOOL_FREE_THINKING = "true";
    const ctx = createContext({ requestedTaskScope: "analysis" });
    const decision = shouldRunToolFreeThinking("price?", ctx);
    expect(decision.run).toBe(false);
    expect(decision.reason).toBe("below complexity threshold");
  });

  it("triggers in execution phase", () => {
    process.env.GORDON_TOOL_FREE_THINKING = "true";
    const ctx = createContext({ requestedTaskScope: "execution" });
    const decision = shouldRunToolFreeThinking("execute", ctx);
    expect(decision.run).toBe(true);
    expect(decision.reason).toBe("phase=execution");
  });
});

describe("prependThinkingTrace", () => {
  it("returns messages unchanged on empty trace", () => {
    const messages = [
      { role: "system", content: "stable" },
      { role: "user", content: "hi" },
    ];
    expect(prependThinkingTrace(messages, "")).toEqual(messages);
    expect(prependThinkingTrace(messages, "   ")).toEqual(messages);
  });

  it("inserts trace AFTER existing system messages", () => {
    const messages = [
      { role: "system", content: "stable prefix" },
      { role: "system", content: "dynamic block" },
      { role: "user", content: "hello" },
    ];
    const result = prependThinkingTrace(messages, "thought process");
    expect(result.length).toBe(messages.length + 1);
    expect(result[0]?.role).toBe("system");
    expect(result[1]?.role).toBe("system");
    expect(result[2]?.role).toBe("system"); // the trace
    expect(result[2]?.content).toContain("[GORDON_THINKING_TRACE]");
    expect(result[2]?.content).toContain("thought process");
    expect(result[3]?.role).toBe("user");
  });

  it("inserts at start when there are no system messages", () => {
    const messages = [{ role: "user", content: "hello" }];
    const result = prependThinkingTrace(messages, "trace");
    expect(result.length).toBe(2);
    expect(result[0]?.role).toBe("system");
    expect(result[0]?.content).toContain("[GORDON_THINKING_TRACE]");
    expect(result[1]?.role).toBe("user");
  });

  it("does not modify the original messages array", () => {
    const messages = [{ role: "user", content: "hello" }];
    const result = prependThinkingTrace(messages, "trace");
    expect(messages.length).toBe(1);
    expect(result.length).toBe(2);
  });
});

describe("getThinkingDepthFromContext", () => {
  it("defaults to off when neither config nor env is set", () => {
    const ctx = createContext();
    expect(getThinkingDepthFromContext(ctx)).toBe("off");
  });

  it("respects env override", () => {
    process.env.GORDON_THINKING_DEPTH = "low";
    const ctx = createContext();
    expect(getThinkingDepthFromContext(ctx)).toBe("low");
  });
});
