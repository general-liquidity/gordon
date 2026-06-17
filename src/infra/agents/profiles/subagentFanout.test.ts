import { afterEach, describe, expect, test } from "bun:test";
import {
  fanoutSubagentTasks,
  MAX_FANOUT_TASKS,
  type FanoutTask,
} from "./subagentFanout.ts";
import {
  AgentRegistry,
  _resetDefaultAgentRegistryForTests,
} from "../harness/subagentCoordination.ts";
import type { DispatchableAgent } from "./subagentDispatcher.ts";
import type { SubagentProfile } from "./subagentProfile.ts";

const PROFILES = new Map<string, SubagentProfile>([
  ["scout", { name: "scout", description: "Recon", instructions: "Recon.", tools: ["scan_market", "list_skills"] }],
  ["wide", { name: "wide", description: "Broad", instructions: "Broad.", tools: ["*"] }],
]);

const FAKE_REGISTRY: Record<string, unknown> = {
  scan_market: { id: "scan_market" },
  list_skills: { id: "list_skills" },
  place_market_order: { id: "place_market_order" },
};

const ENABLED = { GORDON_DYNAMIC_SUBAGENTS: "1" } as NodeJS.ProcessEnv;

function fakeAgent(text: string): DispatchableAgent {
  return { generate: async () => ({ text, usage: { inputTokens: 100, outputTokens: 50 } }) };
}

function failingAgent(msg: string): DispatchableAgent {
  return {
    generate: async () => {
      throw new Error(msg);
    },
  };
}

/** Agent that records peak concurrency while it "runs". */
function trackingAgent(tracker: { inFlight: number; max: number }): DispatchableAgent {
  return {
    generate: async () => {
      tracker.inFlight += 1;
      tracker.max = Math.max(tracker.max, tracker.inFlight);
      await new Promise((r) => setTimeout(r, 10));
      tracker.inFlight -= 1;
      return { text: "ok", usage: { inputTokens: 10, outputTokens: 5 } };
    },
  };
}

afterEach(() => _resetDefaultAgentRegistryForTests());

describe("FW7 — fanoutSubagentTasks", () => {
  test("flag off ⇒ every task returns 'disabled' without spawning", async () => {
    const tasks: FanoutTask[] = [
      { role: "scout", task: "a" },
      { role: "scout", task: "b" },
    ];
    const rep = await fanoutSubagentTasks(PROFILES, tasks, FAKE_REGISTRY, {
      env: {},
      agentFactory: () => fakeAgent("should not run"),
    });
    expect(rep.disabled).toBe(2);
    expect(rep.completed).toBe(0);
  });

  test("gathers concurrent completions in original task order with summed usage", async () => {
    const registry = new AgentRegistry();
    const tasks: FanoutTask[] = [
      { role: "scout", task: "one", label: "btc" },
      { role: "scout", task: "two", label: "eth" },
      { role: "scout", task: "three", label: "sol" },
    ];
    const rep = await fanoutSubagentTasks(PROFILES, tasks, FAKE_REGISTRY, {
      env: ENABLED,
      registry,
      agentFactory: () => fakeAgent("found edge"),
    });
    expect(rep.completed).toBe(3);
    expect(rep.total).toBe(3);
    expect(rep.items.map((i) => i.index)).toEqual([0, 1, 2]); // order preserved
    expect(rep.items.map((i) => i.label)).toEqual(["btc", "eth", "sol"]);
    expect(rep.usage.inputTokens).toBe(300);
    expect(rep.usage.outputTokens).toBe(150);
    expect(rep.digest).toContain("found edge");
    expect(registry.size()).toBe(3);
  });

  test("respects the concurrency pool (peak in-flight ≤ pool size)", async () => {
    const tracker = { inFlight: 0, max: 0 };
    const tasks: FanoutTask[] = Array.from({ length: 6 }, (_, i) => ({ role: "scout", task: `t${i}` }));
    const rep = await fanoutSubagentTasks(PROFILES, tasks, FAKE_REGISTRY, {
      env: ENABLED,
      registry: new AgentRegistry(),
      concurrency: 3,
      agentFactory: () => trackingAgent(tracker),
    });
    expect(rep.concurrency).toBe(3);
    expect(rep.completed).toBe(6);
    expect(tracker.max).toBe(3); // never more than 3 subagents at once
  });

  test("concurrency is clamped to MAX_FANOUT_CONCURRENCY and the task count", async () => {
    const tasks: FanoutTask[] = Array.from({ length: 2 }, (_, i) => ({ role: "scout", task: `t${i}` }));
    const rep = await fanoutSubagentTasks(PROFILES, tasks, FAKE_REGISTRY, {
      env: ENABLED,
      registry: new AgentRegistry(),
      concurrency: 100,
      agentFactory: () => fakeAgent("ok"),
    });
    expect(rep.concurrency).toBe(2); // min(100, MAX=8, tasks=2)
  });

  test("one bad task never sinks the batch (unknown role + throw isolate to their items)", async () => {
    const tasks: FanoutTask[] = [
      { role: "scout", task: "ok-1" },
      { role: "nonexistent", task: "bad-role" },
      { role: "scout", task: "ok-2" },
    ];
    let call = 0;
    const rep = await fanoutSubagentTasks(PROFILES, tasks, FAKE_REGISTRY, {
      env: ENABLED,
      registry: new AgentRegistry(),
      agentFactory: () => (call++ === 0 ? failingAgent("boom") : fakeAgent("recovered")),
    });
    expect(rep.refused).toBe(1); // the unknown role
    expect(rep.items[1]!.result.status).toBe("refused");
    expect(rep.items[1]!.result.error).toContain("Unknown role");
    // the two scout tasks: one threw (failed), one completed — batch survived
    expect(rep.failed).toBe(1);
    expect(rep.completed).toBe(1);
  });

  test("read-only invariant flows through: execution tools stay blocked per item", async () => {
    const captured: Record<string, unknown>[] = [];
    const rep = await fanoutSubagentTasks(PROFILES, [{ role: "wide", task: "scan everything" }], FAKE_REGISTRY, {
      env: ENABLED,
      registry: new AgentRegistry(),
      agentFactory: (cfg) => {
        captured.push(cfg.tools);
        return fakeAgent("ok");
      },
    });
    expect(rep.items[0]!.result.toolFilter.blocked).toContain("place_market_order");
    expect(captured[0]).toHaveProperty("scan_market");
    expect(captured[0]).not.toHaveProperty("place_market_order");
  });

  test("caps at MAX_FANOUT_TASKS and surfaces the dropped count (no silent truncation)", async () => {
    const tasks: FanoutTask[] = Array.from({ length: MAX_FANOUT_TASKS + 3 }, (_, i) => ({ role: "scout", task: `t${i}` }));
    const rep = await fanoutSubagentTasks(PROFILES, tasks, FAKE_REGISTRY, {
      env: ENABLED,
      registry: new AgentRegistry(),
      agentFactory: () => fakeAgent("ok"),
    });
    expect(rep.total).toBe(MAX_FANOUT_TASKS);
    expect(rep.dropped).toBe(3);
    expect(rep.digest).toContain("dropped");
  });

  test("concurrent same-role dispatches get unique subagent ids (no Date.now collision)", async () => {
    const tasks: FanoutTask[] = Array.from({ length: 6 }, (_, i) => ({ role: "scout", task: `t${i}` }));
    const rep = await fanoutSubagentTasks(PROFILES, tasks, FAKE_REGISTRY, {
      env: ENABLED,
      registry: new AgentRegistry(),
      concurrency: 6,
      agentFactory: () => fakeAgent("ok"),
    });
    const ids = rep.items.map((i) => i.result.subagentId);
    expect(new Set(ids).size).toBe(6); // all unique
  });

  test("empty task list returns an empty report", async () => {
    const rep = await fanoutSubagentTasks(PROFILES, [], FAKE_REGISTRY, { env: ENABLED });
    expect(rep.total).toBe(0);
    expect(rep.items).toHaveLength(0);
    expect(rep.digest).toContain("0 task");
  });
});
