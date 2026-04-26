import { describe, it, expect, beforeEach } from "bun:test";
import {
  AgentRegistry,
  DEFAULT_FORK_CONFIG,
  buildForkConfig,
  buildSendMessageEnvelope,
  buildTaskNotification,
} from "./subagentCoordination.ts";

describe("buildForkConfig", () => {
  it("applies defaults (model=inherit, permissionMode=bubble, maxTurns=20)", () => {
    const c = buildForkConfig({
      task: "analyze BTC",
      subagentId: "fork:1",
      parentAgent: "gordon",
    });
    expect(c.model).toBe("inherit");
    expect(c.permissionMode).toBe("bubble");
    expect(c.maxTurns).toBe(20);
  });

  it("lets caller override defaults", () => {
    const c = buildForkConfig({
      task: "scan",
      subagentId: "fork:2",
      parentAgent: "gordon",
      model: "claude-haiku-4-5",
      permissionMode: "inherit",
      maxTurns: 5,
    });
    expect(c.model).toBe("claude-haiku-4-5");
    expect(c.permissionMode).toBe("inherit");
    expect(c.maxTurns).toBe(5);
  });

  it("DEFAULT_FORK_CONFIG is exported with sane values", () => {
    expect(DEFAULT_FORK_CONFIG.model).toBe("inherit");
    expect(DEFAULT_FORK_CONFIG.permissionMode).toBe("bubble");
    expect(DEFAULT_FORK_CONFIG.maxTurns).toBeGreaterThan(0);
  });
});

describe("AgentRegistry", () => {
  let r: AgentRegistry;
  beforeEach(() => {
    r = new AgentRegistry();
  });

  it("registers + retrieves entries", () => {
    r.register({
      subagentId: "exec-1",
      subagentType: "executor",
      parentAgent: "gordon",
      startedAt: 1700000000000,
      task: "place order",
    });
    const got = r.get("exec-1");
    expect(got?.state).toBe("starting");
    expect(got?.task).toBe("place order");
  });

  it("transitions through lifecycle states", () => {
    r.register({
      subagentId: "x",
      subagentType: "fork",
      parentAgent: "gordon",
      startedAt: 1,
    });
    r.setState("x", "running");
    expect(r.get("x")?.state).toBe("running");
    r.setState("x", "completed", { result: { ok: true }, endedAt: 100 });
    const e = r.get("x");
    expect(e?.state).toBe("completed");
    expect(e?.endedAt).toBe(100);
    expect(e?.result).toEqual({ ok: true });
  });

  it("setState on unknown id returns undefined and does not throw", () => {
    expect(r.setState("ghost", "running")).toBeUndefined();
  });

  it("list filters by state", () => {
    r.register({ subagentId: "a", subagentType: "fork", parentAgent: "g", startedAt: 1 });
    r.register({ subagentId: "b", subagentType: "fork", parentAgent: "g", startedAt: 2 });
    r.setState("b", "completed", { endedAt: 3 });
    expect(r.list("starting").map((e) => e.subagentId)).toEqual(["a"]);
    expect(r.list("completed").map((e) => e.subagentId)).toEqual(["b"]);
    expect(r.list().length).toBe(2);
  });

  it("prune removes terminal entries past the cutoff", () => {
    r.register({ subagentId: "old", subagentType: "fork", parentAgent: "g", startedAt: 0 });
    r.setState("old", "completed", { endedAt: 100 });
    r.register({ subagentId: "fresh", subagentType: "fork", parentAgent: "g", startedAt: 0 });
    r.setState("fresh", "completed", { endedAt: 500 });
    r.register({ subagentId: "running", subagentType: "fork", parentAgent: "g", startedAt: 0 });
    r.setState("running", "running");

    // cutoff: now=600, olderThanMs=200 → entries with endedAt+200 <= 600 prune
    const removed = r.prune(200, 600);
    expect(removed).toBe(1);
    expect(r.get("old")).toBeUndefined();
    expect(r.get("fresh")).toBeDefined();
    expect(r.get("running")).toBeDefined(); // running entries are never pruned
  });
});

describe("buildSendMessageEnvelope", () => {
  it("stamps sentAt when not provided", () => {
    const e = buildSendMessageEnvelope({
      fromAgent: "gordon",
      toAgent: "exec-1",
      kind: "instruction",
      body: "stop after this trade",
    });
    expect(e.sentAt).toBeDefined();
    expect(new Date(e.sentAt).toString()).not.toBe("Invalid Date");
  });

  it("preserves explicit sentAt", () => {
    const e = buildSendMessageEnvelope({
      fromAgent: "gordon",
      toAgent: "exec-1",
      kind: "shutdown_request",
      body: "halt",
      sentAt: "2026-04-26T12:00:00Z",
    });
    expect(e.sentAt).toBe("2026-04-26T12:00:00Z");
  });

  it("supports structured body payloads", () => {
    const e = buildSendMessageEnvelope({
      fromAgent: "gordon",
      toAgent: "exec-1",
      kind: "plan_approval_response",
      body: { decision: "approved", planId: "p-7" },
    });
    expect((e.body as Record<string, unknown>).decision).toBe("approved");
  });
});

describe("buildTaskNotification", () => {
  it("emits the canonical XML envelope", () => {
    const xml = buildTaskNotification({
      subagentId: "exec-1",
      status: "completed",
      summary: "BTC long opened",
      result: { orderId: "o-7" },
      usage: { input: 1000, output: 500 },
    });
    expect(xml).toContain("<task_notification>");
    expect(xml).toContain("<subagent_id>exec-1</subagent_id>");
    expect(xml).toContain("<status>completed</status>");
    expect(xml).toContain("<summary>BTC long opened</summary>");
    expect(xml).toContain('<usage input="1000" output="500"');
    expect(xml.endsWith("</task_notification>")).toBe(true);
  });

  it("escapes XML metacharacters in summary + ids", () => {
    const xml = buildTaskNotification({
      subagentId: "x<>&\"'",
      status: "failed",
      summary: "bad <script>alert(1)</script>",
    });
    expect(xml).toContain("&lt;script&gt;");
    expect(xml).toContain("&lt;&gt;&amp;&quot;&apos;");
  });

  it("omits result and usage blocks when not provided", () => {
    const xml = buildTaskNotification({
      subagentId: "x",
      status: "aborted",
      summary: "user halted",
    });
    expect(xml).not.toContain("<result>");
    expect(xml).not.toContain("<usage");
  });

  it("renders string results without JSON wrapping", () => {
    const xml = buildTaskNotification({
      subagentId: "x",
      status: "completed",
      summary: "done",
      result: "simple text result",
    });
    expect(xml).toContain("simple text result");
    expect(xml).not.toContain('"simple text result"'); // not JSON-wrapped
  });
});
