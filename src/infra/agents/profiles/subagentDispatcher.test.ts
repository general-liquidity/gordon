import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  dispatchSubagentTask,
  isDynamicSubagentsEnabled,
  type DispatchableAgent,
} from "./subagentDispatcher.ts";
import {
  AgentRegistry,
  _resetDefaultAgentRegistryForTests,
} from "../harness/subagentCoordination.ts";
import type { SubagentProfile } from "./subagentProfile.ts";

const VALID_PROFILE: SubagentProfile = {
  name: "test-analyst",
  description: "Test analyst",
  instructions: "Do analysis.",
  tools: ["scan_market", "list_skills"],
};

const FAKE_REGISTRY: Record<string, unknown> = {
  scan_market: { id: "scan_market" },
  list_skills: { id: "list_skills" },
  load_skill: { id: "load_skill" },
  place_market_order: { id: "place_market_order" },
};

function fakeAgent(text: string): DispatchableAgent {
  return {
    generate: async () => ({ text, usage: { inputTokens: 100, outputTokens: 50 } }),
  };
}

function failingAgent(message: string): DispatchableAgent {
  return {
    generate: async () => {
      throw new Error(message);
    },
  };
}

afterEach(() => {
  _resetDefaultAgentRegistryForTests();
});

describe("FW7 — isDynamicSubagentsEnabled", () => {
  test("true for '1'", () => {
    expect(isDynamicSubagentsEnabled({ GORDON_DYNAMIC_SUBAGENTS: "1" })).toBe(true);
  });
  test("true for 'true'", () => {
    expect(isDynamicSubagentsEnabled({ GORDON_DYNAMIC_SUBAGENTS: "true" })).toBe(true);
  });
  test("true for 'yes'", () => {
    expect(isDynamicSubagentsEnabled({ GORDON_DYNAMIC_SUBAGENTS: "yes" })).toBe(true);
  });
  test("false when unset", () => {
    expect(isDynamicSubagentsEnabled({})).toBe(false);
  });
  test("false for arbitrary string", () => {
    expect(isDynamicSubagentsEnabled({ GORDON_DYNAMIC_SUBAGENTS: "off" })).toBe(false);
  });
  test("case-insensitive", () => {
    expect(isDynamicSubagentsEnabled({ GORDON_DYNAMIC_SUBAGENTS: "TRUE" })).toBe(true);
  });
});

describe("FW7 — dispatchSubagentTask", () => {
  test("disabled flag returns 'disabled' status without spawning", async () => {
    const result = await dispatchSubagentTask(VALID_PROFILE, "do x", FAKE_REGISTRY, {
      env: {},
      agentFactory: () => fakeAgent("should not be called"),
    });
    expect(result.status).toBe("disabled");
    expect(result.notification).toContain("GORDON_DYNAMIC_SUBAGENTS");
  });

  test("enabled flag spawns ephemeral agent + returns completed", async () => {
    const registry = new AgentRegistry();
    const result = await dispatchSubagentTask(VALID_PROFILE, "do x", FAKE_REGISTRY, {
      env: { GORDON_DYNAMIC_SUBAGENTS: "1" },
      registry,
      agentFactory: () => fakeAgent("analysis result"),
    });
    expect(result.status).toBe("completed");
    expect(result.text).toBe("analysis result");
    expect(result.toolFilter.allowed).toEqual(["scan_market", "list_skills"]);
    expect(registry.size()).toBe(1);
    expect(registry.list("completed")).toHaveLength(1);
  });

  test("deprecated profile is refused", async () => {
    const result = await dispatchSubagentTask(
      { ...VALID_PROFILE, status: "deprecated" },
      "do x",
      FAKE_REGISTRY,
      {
        env: { GORDON_DYNAMIC_SUBAGENTS: "1" },
        agentFactory: () => fakeAgent("should not be called"),
      },
    );
    expect(result.status).toBe("refused");
    expect(result.error).toContain("deprecated");
  });

  test("empty allowed-tools after filtering is refused", async () => {
    const result = await dispatchSubagentTask(
      { ...VALID_PROFILE, tools: ["nonexistent_tool"] },
      "do x",
      FAKE_REGISTRY,
      {
        env: { GORDON_DYNAMIC_SUBAGENTS: "1" },
        agentFactory: () => fakeAgent("should not be called"),
      },
    );
    expect(result.status).toBe("refused");
    expect(result.toolFilter.unmatched).toEqual(["nonexistent_tool"]);
  });

  test("execution tools are dropped silently from the agent's allowed set", async () => {
    const capturedTools: Record<string, unknown>[] = [];
    const result = await dispatchSubagentTask(
      { ...VALID_PROFILE, tools: ["*"] },
      "do x",
      FAKE_REGISTRY,
      {
        env: { GORDON_DYNAMIC_SUBAGENTS: "1" },
        agentFactory: (config) => {
          capturedTools.push(config.tools);
          return fakeAgent("ok");
        },
      },
    );
    expect(result.status).toBe("completed");
    expect(capturedTools[0]).toHaveProperty("scan_market");
    expect(capturedTools[0]).not.toHaveProperty("place_market_order");
    expect(result.toolFilter.blocked).toContain("place_market_order");
  });

  test("agent generate failure surfaces as 'failed' notification", async () => {
    const registry = new AgentRegistry();
    const result = await dispatchSubagentTask(VALID_PROFILE, "do x", FAKE_REGISTRY, {
      env: { GORDON_DYNAMIC_SUBAGENTS: "1" },
      registry,
      agentFactory: () => failingAgent("network blew up"),
    });
    expect(result.status).toBe("failed");
    expect(result.error).toBe("network blew up");
    expect(registry.list("failed")).toHaveLength(1);
  });

  test("safety preamble prepended to instructions", async () => {
    const capturedInstr: string[] = [];
    await dispatchSubagentTask(VALID_PROFILE, "do x", FAKE_REGISTRY, {
      env: { GORDON_DYNAMIC_SUBAGENTS: "1" },
      agentFactory: (config) => {
        capturedInstr.push(config.instructions);
        return fakeAgent("ok");
      },
    });
    expect(capturedInstr[0]).toContain("READ-ONLY");
    expect(capturedInstr[0]).toContain("NO STATE MUTATIONS");
    expect(capturedInstr[0]).toContain("Do analysis.");
  });

  test("maxSteps capped to profile.maxTurns", async () => {
    const capturedMaxSteps: number[] = [];
    await dispatchSubagentTask(
      { ...VALID_PROFILE, maxTurns: 5 },
      "do x",
      FAKE_REGISTRY,
      {
        env: { GORDON_DYNAMIC_SUBAGENTS: "1" },
        agentFactory: (config) => {
          capturedMaxSteps.push(config.maxSteps);
          return fakeAgent("ok");
        },
      },
    );
    expect(capturedMaxSteps[0]).toBe(5);
  });

  test("default maxSteps is 10", async () => {
    const capturedMaxSteps: number[] = [];
    await dispatchSubagentTask(VALID_PROFILE, "do x", FAKE_REGISTRY, {
      env: { GORDON_DYNAMIC_SUBAGENTS: "1" },
      agentFactory: (config) => {
        capturedMaxSteps.push(config.maxSteps);
        return fakeAgent("ok");
      },
    });
    expect(capturedMaxSteps[0]).toBe(10);
  });

  test("usage info propagates to notification", async () => {
    const result = await dispatchSubagentTask(VALID_PROFILE, "do x", FAKE_REGISTRY, {
      env: { GORDON_DYNAMIC_SUBAGENTS: "1" },
      agentFactory: () => fakeAgent("ok"),
    });
    expect(result.usage?.inputTokens).toBe(100);
    expect(result.usage?.outputTokens).toBe(50);
    expect(result.notification).toContain('input="100"');
    expect(result.notification).toContain('output="50"');
  });

  test("subagent ID is unique per dispatch", async () => {
    const r1 = await dispatchSubagentTask(VALID_PROFILE, "x", FAKE_REGISTRY, {
      env: { GORDON_DYNAMIC_SUBAGENTS: "1" },
      agentFactory: () => fakeAgent("ok"),
    });
    // Use setTimeout to ensure different timestamps
    await new Promise((r) => setTimeout(r, 5));
    const r2 = await dispatchSubagentTask(VALID_PROFILE, "y", FAKE_REGISTRY, {
      env: { GORDON_DYNAMIC_SUBAGENTS: "1" },
      agentFactory: () => fakeAgent("ok"),
    });
    expect(r1.subagentId).not.toBe(r2.subagentId);
  });
});
