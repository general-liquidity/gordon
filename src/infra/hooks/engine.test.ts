import { describe, it, expect, beforeEach } from "bun:test";
import {
  clearHooks,
  registerHook,
  runHooks,
  setHookStatusListener,
  type HookStatusEvent,
} from "./index.ts";

describe("runHooks — sync chain (existing behavior preserved)", () => {
  beforeEach(() => {
    clearHooks();
    setHookStatusListener(null);
  });

  it("returns allow when no hooks are registered", async () => {
    const r = await runHooks("PreToolUse", { toolName: "x", toolCallId: "1", args: {} });
    expect(r.action).toBe("allow");
  });

  it("runs sync hooks in priority order and threads modifications", async () => {
    const log: string[] = [];
    registerHook({
      id: "second",
      point: "PreToolUse",
      priority: 20,
      handler: async (p) => {
        log.push(`second:${(p.args as { v: number }).v}`);
        return { action: "modify", replacement: { args: { v: 3 } } };
      },
    });
    registerHook({
      id: "first",
      point: "PreToolUse",
      priority: 10,
      handler: async (p) => {
        log.push(`first:${(p.args as { v: number }).v}`);
        return { action: "modify", replacement: { args: { v: 2 } } };
      },
    });
    const r = await runHooks("PreToolUse", { toolName: "x", toolCallId: "1", args: { v: 1 } });
    expect(log).toEqual(["first:1", "second:2"]);
    expect((r.metadata!.finalPayload as { args: { v: number } }).args.v).toBe(3);
  });

  it("first sync block stops the chain", async () => {
    const log: string[] = [];
    registerHook({
      id: "blocker",
      point: "PreToolUse",
      priority: 10,
      handler: () => ({ action: "block", reason: "nope" }),
    });
    registerHook({
      id: "after",
      point: "PreToolUse",
      priority: 20,
      handler: () => {
        log.push("ran");
        return { action: "allow" };
      },
    });
    const r = await runHooks("PreToolUse", { toolName: "x", toolCallId: "1", args: {} });
    expect(r.action).toBe("block");
    expect(r.reason).toContain("blocker");
    expect(log).toEqual([]);
  });
});

describe("runHooks — asyncRewake mode", () => {
  beforeEach(() => {
    clearHooks();
    setHookStatusListener(null);
  });

  it("runs rewake hooks in parallel, not serially", async () => {
    let aStart = 0;
    let bStart = 0;
    registerHook({
      id: "a",
      point: "PreToolUse",
      asyncRewake: true,
      handler: async () => {
        aStart = Date.now();
        await new Promise((r) => setTimeout(r, 50));
        return { action: "allow" };
      },
    });
    registerHook({
      id: "b",
      point: "PreToolUse",
      asyncRewake: true,
      handler: async () => {
        bStart = Date.now();
        await new Promise((r) => setTimeout(r, 50));
        return { action: "allow" };
      },
    });
    const t0 = Date.now();
    await runHooks("PreToolUse", { toolName: "x", toolCallId: "1", args: {} });
    const elapsed = Date.now() - t0;
    // Both started within ~10ms of each other (parallel, not 50ms apart).
    expect(Math.abs(aStart - bStart)).toBeLessThan(15);
    // Total elapsed bounded by slowest, not sum.
    expect(elapsed).toBeLessThan(100);
  });

  it("a rewake-hook block surfaces in the final result", async () => {
    registerHook({
      id: "compliance",
      point: "PreOrderPlacement",
      asyncRewake: true,
      handler: async () => {
        await new Promise((r) => setTimeout(r, 5));
        return { action: "block", reason: "external API said no" };
      },
    });
    const r = await runHooks("PreOrderPlacement", {
      symbol: "BTC",
      side: "buy",
      quantity: 1,
      orderType: "MARKET",
      notionalUsd: 50000,
    });
    expect(r.action).toBe("block");
    expect(r.reason).toContain("compliance (asyncRewake)");
  });

  it("sync hooks still gate the chain even with rewake hooks pending", async () => {
    let rewakeRan = false;
    registerHook({
      id: "rewake",
      point: "PreToolUse",
      asyncRewake: true,
      handler: async () => {
        await new Promise((r) => setTimeout(r, 30));
        rewakeRan = true;
        return { action: "allow" };
      },
    });
    registerHook({
      id: "sync-block",
      point: "PreToolUse",
      priority: 10,
      handler: () => ({ action: "block", reason: "no" }),
    });
    const r = await runHooks("PreToolUse", { toolName: "x", toolCallId: "1", args: {} });
    expect(r.action).toBe("block");
    expect(r.reason).toContain("sync-block");
    // Engine still awaits rewake promises so they complete cleanly.
    expect(rewakeRan).toBe(true);
  });

  it("a rewake hook that THROWS fails closed with block", async () => {
    // The engine and HookDefinition docstrings both promise a failing rewake
    // hook yields a block "so compliance / audit gates don't lose teeth".
    // It used to swallow the throw and return allow — a gate that reports
    // itself as installed while never denying anything.
    registerHook({
      id: "compliance-down",
      point: "PreOrderPlacement",
      asyncRewake: true,
      handler: async () => {
        throw new Error("compliance API unreachable");
      },
    });
    const r = await runHooks("PreOrderPlacement", {
      symbol: "BTC",
      side: "buy",
      quantity: 1,
      orderType: "MARKET",
      notionalUsd: 50000,
    });
    expect(r.action).toBe("block");
    expect(r.reason).toContain("compliance-down");
    expect(r.reason).toContain("compliance API unreachable");
  });

  it("a rewake hook cannot silently discard a concurrent modification", async () => {
    registerHook({
      id: "invalid-parallel-mutator",
      point: "PreToolUse",
      asyncRewake: true,
      handler: async () => ({ action: "modify", replacement: { args: { quantity: 0 } } }),
    });
    const r = await runHooks("PreToolUse", {
      toolName: "x",
      toolCallId: "1",
      args: { quantity: 1 },
    });
    expect(r.action).toBe("block");
    expect(r.reason).toContain("modify is unsupported");
  });

  it("a sync hook that throws fails closed without escaping the agent loop", async () => {
    registerHook({
      id: "sync-thrower",
      point: "PreToolUse",
      handler: () => {
        throw new Error("boom");
      },
    });
    const r = await runHooks("PreToolUse", { toolName: "x", toolCallId: "1", args: {} });
    expect(r.action).toBe("block");
    expect(r.reason).toContain("sync-thrower");
    expect(r.reason).toContain("boom");
  });

  it("rewake hooks can be mixed with sync hooks under the same point", async () => {
    registerHook({
      id: "sync-allow",
      point: "PreToolUse",
      priority: 5,
      handler: () => ({ action: "allow" }),
    });
    registerHook({
      id: "rewake-allow",
      point: "PreToolUse",
      asyncRewake: true,
      handler: async () => ({ action: "allow" }),
    });
    const r = await runHooks("PreToolUse", { toolName: "x", toolCallId: "1", args: {} });
    expect(r.action).toBe("allow");
  });
});

describe("Subagent lifecycle hooks", () => {
  beforeEach(() => {
    clearHooks();
    setHookStatusListener(null);
  });

  it("fires SubagentStart hooks with the typed payload", async () => {
    const seen: Array<{ subagentId: string; subagentType: string; task?: string }> = [];
    registerHook({
      id: "log-start",
      point: "SubagentStart",
      handler: (p) => {
        seen.push({ subagentId: p.subagentId, subagentType: p.subagentType, task: p.task });
        return { action: "allow" };
      },
    });
    await runHooks("SubagentStart", {
      subagentId: "exec-1",
      subagentType: "executor",
      parentAgent: "gordon",
      task: "place BTC long",
      startedAt: 1700000000000,
    });
    expect(seen).toEqual([
      { subagentId: "exec-1", subagentType: "executor", task: "place BTC long" },
    ]);
  });

  it("fires SubagentStop hooks and lets them block on bad outcomes", async () => {
    registerHook({
      id: "veto-on-failure",
      point: "SubagentStop",
      handler: (p) =>
        p.status === "failed"
          ? { action: "block", reason: `subagent ${p.subagentId} failed: ${p.error}` }
          : { action: "allow" },
    });
    const ok = await runHooks("SubagentStop", {
      subagentId: "exec-2",
      subagentType: "executor",
      stoppedAt: 1700000000010,
      status: "completed",
      durationMs: 10,
    });
    expect(ok.action).toBe("allow");

    const bad = await runHooks("SubagentStop", {
      subagentId: "exec-3",
      subagentType: "executor",
      stoppedAt: 1700000000010,
      status: "failed",
      durationMs: 10,
      error: "timeout reaching broker",
    });
    expect(bad.action).toBe("block");
    expect(bad.reason).toContain("timeout reaching broker");
  });
});

describe("statusMessage listener", () => {
  beforeEach(() => {
    clearHooks();
    setHookStatusListener(null);
  });

  it("emits start + end events for hooks with statusMessage", async () => {
    const events: HookStatusEvent[] = [];
    setHookStatusListener((e) => events.push(e));
    registerHook({
      id: "logged",
      point: "PreToolUse",
      statusMessage: "Checking limits…",
      handler: async () => ({ action: "allow" }),
    });
    await runHooks("PreToolUse", { toolName: "x", toolCallId: "1", args: {} });
    expect(events.length).toBe(2);
    expect(events[0]?.phase).toBe("start");
    expect(events[0]?.message).toBe("Checking limits…");
    expect(events[1]?.phase).toBe("end");
  });

  it("does not emit events for hooks without statusMessage", async () => {
    const events: HookStatusEvent[] = [];
    setHookStatusListener((e) => events.push(e));
    registerHook({
      id: "silent",
      point: "PreToolUse",
      handler: async () => ({ action: "allow" }),
    });
    await runHooks("PreToolUse", { toolName: "x", toolCallId: "1", args: {} });
    expect(events.length).toBe(0);
  });

  it("survives a throwing listener — engine never crashes", async () => {
    setHookStatusListener(() => {
      throw new Error("listener bug");
    });
    registerHook({
      id: "h",
      point: "PreToolUse",
      statusMessage: "x",
      handler: async () => ({ action: "allow" }),
    });
    const r = await runHooks("PreToolUse", { toolName: "x", toolCallId: "1", args: {} });
    expect(r.action).toBe("allow");
  });
});
