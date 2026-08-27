import { afterEach, describe, expect, test } from "bun:test";

import { clearHooks, registerHook } from "./engine.ts";
import {
  beginSubagentHook,
  endSubagentHook,
  resetSubagentHookBridgeForTests,
} from "./subagentHookBridge.ts";

afterEach(() => {
  clearHooks();
  resetSubagentHookBridgeForTests();
});

describe("subagent hook bridge", () => {
  test("pairs start and stop with one stable id", async () => {
    const seen: unknown[] = [];
    registerHook({
      id: "start",
      point: "SubagentStart",
      handler: (payload) => {
        seen.push(payload);
        return { action: "allow" };
      },
    });
    registerHook({
      id: "stop",
      point: "SubagentStop",
      handler: (payload) => {
        seen.push(payload);
        return { action: "allow" };
      },
    });
    const start = await beginSubagentHook({
      key: "k",
      id: "run-1",
      type: "researcher",
      parent: "Gordon",
    });
    expect(start.allowed).toBe(true);
    await endSubagentHook({ key: "k", type: "researcher", parent: "Gordon", status: "completed" });
    expect(seen).toHaveLength(2);
    expect((seen[0] as { subagentId: string }).subagentId).toBe("run-1");
    expect((seen[1] as { subagentId: string }).subagentId).toBe("run-1");
  });

  test("a start block prevents activation and therefore emits no stop", async () => {
    let stopped = 0;
    registerHook({
      id: "deny",
      point: "SubagentStart",
      handler: () => ({ action: "block", reason: "disabled" }),
    });
    registerHook({
      id: "stop",
      point: "SubagentStop",
      handler: () => {
        stopped += 1;
        return { action: "allow" };
      },
    });
    expect((await beginSubagentHook({ key: "k", type: "executor" })).allowed).toBe(false);
    await endSubagentHook({ key: "k", type: "executor", status: "aborted" });
    expect(stopped).toBe(0);
  });
});
