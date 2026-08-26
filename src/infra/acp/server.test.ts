import { afterEach, beforeEach, describe, it, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GordonAcpAgent,
  ACP_SESSION_MODES,
  type PromptHandler,
} from "./server.ts";
import { PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import { ACP_SESSIONS_PATH_ENV, loadSessionTurns } from "./sessions.ts";
import { clearHooks, registerHook } from "../hooks/engine.ts";
import {
  checkCostBudget,
  resetCostBudgetState,
  setCostBudget,
} from "../platform/costTracker.ts";

let sessionDir: string;
let previousSessionDir: string | undefined;

beforeEach(() => {
  sessionDir = mkdtempSync(join(tmpdir(), "gordon-acp-server-"));
  previousSessionDir = process.env[ACP_SESSIONS_PATH_ENV];
  process.env[ACP_SESSIONS_PATH_ENV] = sessionDir;
});

afterEach(() => {
  clearHooks();
  setCostBudget(null);
  resetCostBudgetState();
  if (previousSessionDir === undefined) delete process.env[ACP_SESSIONS_PATH_ENV];
  else process.env[ACP_SESSIONS_PATH_ENV] = previousSessionDir;
  rmSync(sessionDir, { recursive: true, force: true });
});

// =================== mock SDK connection ===================
//
// The SDK's AgentSideConnection drives the agent on the WIRE side; for
// unit tests we only need to capture sessionUpdate notifications and
// invoke the agent methods directly. We construct a fake that records
// what the agent emits.

interface FakeUpdate {
  sessionId: string;
  update: Record<string, unknown>;
}

class FakeConnection {
  updates: FakeUpdate[] = [];
  permissionRequests: unknown[] = [];

  async sessionUpdate(payload: FakeUpdate): Promise<void> {
    this.updates.push(payload);
  }

  // Stubs for the methods we don't exercise — present so the fake
  // satisfies the interface from the agent's perspective.
  async requestPermission(params: unknown): Promise<{ outcome: { outcome: "selected"; optionId: string } }> {
    this.permissionRequests.push(params);
    return { outcome: { outcome: "selected", optionId: "allow_once" } };
  }
  async readTextFile(): Promise<{ content: string }> { return { content: "" }; }
  async writeTextFile(): Promise<Record<string, never>> { return {}; }
}

function makeAgent(handler?: PromptHandler): { agent: GordonAcpAgent; conn: FakeConnection } {
  const conn = new FakeConnection();
  const defaultHandler: PromptHandler = async ({ sessionId, connection }) => {
    await connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "ok" },
      } as Parameters<typeof connection.sessionUpdate>[0]["update"],
    });
    return { stopReason: "end_turn", assistantText: "ok" };
  };
  const agent = new GordonAcpAgent(conn as unknown as ConstructorParameters<typeof GordonAcpAgent>[0], {
    promptHandler: handler ?? defaultHandler,
  });
  return { agent, conn };
}

// =================== initialize ===================

describe("GordonAcpAgent — initialize", () => {
  it("responds with PROTOCOL_VERSION + agent capabilities", async () => {
    const { agent } = makeAgent();
    const result = await agent.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
      clientInfo: { name: "test-client", title: "Test Client", version: "0.0.1" },
    });
    expect(result.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(result.agentCapabilities).toBeDefined();
    expect(result.agentCapabilities?.loadSession).toBe(true);
    expect(result.agentCapabilities?.promptCapabilities?.embeddedContext).toBe(true);
    expect(result.agentCapabilities?.mcpCapabilities?.http).toBe(true);
    expect(result.agentCapabilities?.mcpCapabilities?.sse).toBe(true);
    expect(result.agentCapabilities?.sessionCapabilities?.close).toEqual({});
    expect(result.authMethods).toEqual([]);
  });
});

// =================== authenticate ===================

describe("GordonAcpAgent — authenticate", () => {
  it("returns empty response (no interactive auth)", async () => {
    const { agent } = makeAgent();
    const result = await agent.authenticate({ methodId: "" });
    expect(result).toEqual({});
  });
});

// =================== sessions ===================

describe("GordonAcpAgent — newSession", () => {
  it("returns a fresh 32-char hex sessionId", async () => {
    const { agent } = makeAgent();
    const result = await agent.newSession({ cwd: "/tmp", mcpServers: [] });
    expect(result.sessionId).toMatch(/^[0-9a-f]{32}$/);
    expect(result.modes?.currentModeId).toBe("default");
    expect(result.modes?.availableModes.map((mode) => mode.id)).toEqual(ACP_SESSION_MODES.map((mode) => mode.id));
  });

  it("returns unique ids across calls", async () => {
    const { agent } = makeAgent();
    const a = await agent.newSession({ cwd: "/tmp", mcpServers: [] });
    const b = await agent.newSession({ cwd: "/tmp", mcpServers: [] });
    expect(a.sessionId).not.toBe(b.sessionId);
  });

  it("loadSession throws when no persisted session exists", async () => {
    const { agent } = makeAgent();
    await expect(agent.loadSession({ sessionId: "00".repeat(16), cwd: "/", mcpServers: [] })).rejects.toThrow(
      /not found on disk/,
    );
  });

  it("loadSession rejects a path-traversal sessionId before touching the filesystem", async () => {
    const { agent } = makeAgent();
    await expect(
      agent.loadSession({ sessionId: "../../x", cwd: "/", mcpServers: [] }),
    ).rejects.toThrow(/Invalid sessionId/);
    // A bare ".." and an absolute-ish id are rejected the same way.
    await expect(
      agent.loadSession({ sessionId: "..", cwd: "/", mcpServers: [] }),
    ).rejects.toThrow(/Invalid sessionId/);
    await expect(
      agent.loadSession({ sessionId: "a/b/c", cwd: "/", mcpServers: [] }),
    ).rejects.toThrow(/Invalid sessionId/);
  });

  it("setSessionMode changes the mode delivered to the production prompt handler", async () => {
    const seen: string[] = [];
    const { agent, conn } = makeAgent(async ({ modeId }) => {
      seen.push(modeId);
      return { stopReason: "end_turn", assistantText: "ok" };
    });
    const session = await agent.newSession({ cwd: "/tmp", mcpServers: [] });
    const result = await agent.setSessionMode({ sessionId: session.sessionId, modeId: "paper" });
    expect(result).toEqual({});
    expect(conn.updates.at(-1)?.update).toEqual({
      sessionUpdate: "current_mode_update",
      currentModeId: "paper",
    });
    await agent.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "test" }] });
    expect(seen).toEqual(["paper"]);
  });

  it("setSessionMode rejects unknown sessions and unsupported modes", async () => {
    const { agent } = makeAgent();
    await expect(agent.setSessionMode({ sessionId: "00".repeat(16), modeId: "paper" })).rejects.toThrow("Unknown sessionId");
    const session = await agent.newSession({ cwd: "/tmp", mcpServers: [] });
    await expect(agent.setSessionMode({ sessionId: session.sessionId, modeId: "live" })).rejects.toThrow("Unsupported");
  });

  it("does not change the in-memory mode when mode persistence fails", async () => {
    const seen: string[] = [];
    const { agent } = makeAgent(async ({ modeId }) => {
      seen.push(modeId);
      return { stopReason: "end_turn", assistantText: "ok" };
    });
    const session = await agent.newSession({ cwd: "/tmp", mcpServers: [] });
    rmSync(sessionDir, { recursive: true, force: true });
    writeFileSync(sessionDir, "not a directory", "utf-8");

    await expect(
      agent.setSessionMode({ sessionId: session.sessionId, modeId: "paper" }),
    ).rejects.toThrow(/Failed to persist/);

    rmSync(sessionDir, { force: true });
    await agent.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "test" }] });
    expect(seen).toEqual(["default"]);
  });

  it("closeSession releases the session", async () => {
    const { agent } = makeAgent();
    const session = await agent.newSession({ cwd: "/tmp", mcpServers: [] });
    expect(await agent.closeSession({ sessionId: session.sessionId })).toEqual({});
    await expect(agent.prompt({ sessionId: session.sessionId, prompt: [{ type: "text", text: "test" }] })).rejects.toThrow("Unknown sessionId");
  });
});

// =================== prompt happy path ===================

describe("GordonAcpAgent — prompt", () => {
  it("streams handler chunks as agent_message_chunk updates + returns end_turn", async () => {
    const handler: PromptHandler = async ({ sessionId, connection }) => {
      for (const text of ["Hello ", "world"]) {
        await connection.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text },
          } as Parameters<typeof connection.sessionUpdate>[0]["update"],
        });
      }
      return { stopReason: "end_turn", assistantText: "Hello world" };
    };
    const { agent, conn } = makeAgent(handler);
    const session = await agent.newSession({ cwd: "/tmp", mcpServers: [] });
    const result = await agent.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "Hi" }],
    });
    expect(result.stopReason).toBe("end_turn");
    expect(conn.updates).toHaveLength(2);
    expect(conn.updates[0]!.update.sessionUpdate).toBe("agent_message_chunk");
    expect((conn.updates[0]!.update.content as { text: string }).text).toBe("Hello ");
    expect((conn.updates[1]!.update.content as { text: string }).text).toBe("world");
  });

  it("rejects unknown sessionId", async () => {
    const { agent } = makeAgent();
    await expect(
      agent.prompt({
        sessionId: "00".repeat(16),
        prompt: [{ type: "text", text: "Hi" }],
      }),
    ).rejects.toThrow(/Unknown sessionId/);
  });

  it("returns refusal when handler reports refusal stop reason", async () => {
    const handler: PromptHandler = async ({ sessionId, connection }) => {
      await connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "[gordon error] upstream LLM exploded" },
        } as Parameters<typeof connection.sessionUpdate>[0]["update"],
      });
      return { stopReason: "refusal", assistantText: "" };
    };
    const { agent, conn } = makeAgent(handler);
    const session = await agent.newSession({ cwd: "/tmp", mcpServers: [] });
    const result = await agent.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "Hi" }],
    });
    expect(result.stopReason).toBe("refusal");
    const errChunk = conn.updates[conn.updates.length - 1];
    expect((errChunk!.update.content as { text: string }).text).toContain("upstream LLM exploded");
  });

  it("accumulates conversation history across prompts", async () => {
    const received: Array<Array<{ role: string; content: string }>> = [];
    const handler: PromptHandler = async ({ history }) => {
      received.push(history.map((h) => ({ role: h.role, content: h.content })));
      return { stopReason: "end_turn", assistantText: "ack" };
    };
    const { agent } = makeAgent(handler);
    const session = await agent.newSession({ cwd: "/tmp", mcpServers: [] });
    await agent.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "first" }],
    });
    await agent.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "second" }],
    });
    expect(received[0]).toEqual([]);
    expect(received[1]).toEqual([
      { role: "user", content: "first" },
      { role: "assistant", content: "ack" },
    ]);
  });

  it("extracts text from multi-item prompt arrays", async () => {
    const received: string[] = [];
    const handler: PromptHandler = async ({ prompt }) => {
      received.push(prompt);
      return { stopReason: "end_turn", assistantText: "k" };
    };
    const { agent } = makeAgent(handler);
    const session = await agent.newSession({ cwd: "/tmp", mcpServers: [] });
    await agent.prompt({
      sessionId: session.sessionId,
      prompt: [
        { type: "text", text: "line 1" },
        { type: "text", text: "line 2" },
      ],
    });
    expect(received[0]).toBe("line 1\nline 2");
  });

  it("surfaces resource_link items as [file: <uri>] tokens", async () => {
    const received: string[] = [];
    const handler: PromptHandler = async ({ prompt }) => {
      received.push(prompt);
      return { stopReason: "end_turn", assistantText: "k" };
    };
    const { agent } = makeAgent(handler);
    const session = await agent.newSession({ cwd: "/tmp", mcpServers: [] });
    await agent.prompt({
      sessionId: session.sessionId,
      prompt: [
        { type: "text", text: "look at this:" },
        { type: "resource_link", uri: "file:///tmp/x.ts", name: "x.ts" },
      ],
    });
    expect(received[0]).toContain("[file: file:///tmp/x.ts]");
  });

  it("does not persist cancelled turns to history", async () => {
    const seenHistories: Array<Array<{ role: string; content: string }>> = [];
    const handler: PromptHandler = async ({ history }) => {
      seenHistories.push(history.map((h) => ({ role: h.role, content: h.content })));
      // First call returns cancelled, second returns end_turn
      if (seenHistories.length === 1) {
        return { stopReason: "cancelled", assistantText: "partial" };
      }
      return { stopReason: "end_turn", assistantText: "complete" };
    };
    const { agent } = makeAgent(handler);
    const session = await agent.newSession({ cwd: "/tmp", mcpServers: [] });
    await agent.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "first" }],
    });
    await agent.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "second" }],
    });
    // Second call's history should be empty because first was cancelled
    expect(seenHistories[1]).toEqual([]);
  });

  it("cleans up a pre-turn budget stop so a later prompt can run", async () => {
    let calls = 0;
    const { agent } = makeAgent(async () => {
      calls += 1;
      return { stopReason: "end_turn", assistantText: "ok" };
    });
    const session = await agent.newSession({ cwd: "/tmp", mcpServers: [] });
    setCostBudget({ sessionUsd: 0.01, action: "halt", warnThresholds: [] });
    checkCostBudget(0.02, 0.02);

    const stopped = await agent.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "blocked by budget" }],
    });
    expect(stopped.stopReason).toBe("max_tokens");
    expect(calls).toBe(0);

    setCostBudget(null);
    const resumed = await agent.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "now run" }],
    });
    expect(resumed.stopReason).toBe("end_turn");
    expect(calls).toBe(1);
  });
});

// =================== cancel ===================

describe("GordonAcpAgent — cancel", () => {
  it("cancel aborts an in-flight prompt → stopReason cancelled", async () => {
    let abortObserved = false;
    const handler: PromptHandler = async ({ signal }) => {
      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => {
          abortObserved = true;
          resolve();
        });
        setTimeout(resolve, 5000);
      });
      return { stopReason: signal.aborted ? "cancelled" : "end_turn", assistantText: "" };
    };
    const { agent } = makeAgent(handler);
    const session = await agent.newSession({ cwd: "/tmp", mcpServers: [] });
    const promptPromise = agent.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "long task" }],
    });
    setTimeout(() => {
      agent.cancel({ sessionId: session.sessionId });
    }, 50);
    const result = await promptPromise;
    expect(result.stopReason).toBe("cancelled");
    expect(abortObserved).toBe(true);
  });

  it("cancel on unknown session is a no-op", async () => {
    const { agent } = makeAgent();
    await expect(agent.cancel({ sessionId: "ff".repeat(16) })).resolves.toBeUndefined();
  });

  it("an abort remains authoritative when a handler returns end_turn late", async () => {
    let release!: () => void;
    let started!: () => void;
    const running = new Promise<void>((resolve) => { started = resolve; });
    const finish = new Promise<void>((resolve) => { release = resolve; });
    const { agent } = makeAgent(async () => {
      started();
      await finish;
      // Deliberately violates the handler contract to prove the ACP boundary
      // cannot persist a cancelled completion as a successful turn.
      return { stopReason: "end_turn", assistantText: "late answer" };
    });
    const session = await agent.newSession({ cwd: "/tmp", mcpServers: [] });
    const prompt = agent.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "cancel me" }],
    });
    await running;
    await agent.cancel({ sessionId: session.sessionId });
    release();

    expect((await prompt).stopReason).toBe("cancelled");
    expect(loadSessionTurns(session.sessionId)).toEqual([]);
  });

  it("re-prompting the same session aborts the prior pending prompt", async () => {
    let firstAborted = false;
    const handler: PromptHandler = async ({ prompt, signal }) => {
      if (prompt === "first") {
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => {
            firstAborted = true;
            resolve();
          });
          setTimeout(resolve, 5000);
        });
        return { stopReason: signal.aborted ? "cancelled" : "end_turn", assistantText: "" };
      }
      return { stopReason: "end_turn", assistantText: prompt };
    };
    const { agent } = makeAgent(handler);
    const session = await agent.newSession({ cwd: "/tmp", mcpServers: [] });
    const first = agent.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "first" }],
    });
    // Brief delay to let the first prompt's handler actually start
    await new Promise((r) => setTimeout(r, 30));
    const second = await agent.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "second" }],
    });
    expect(second.stopReason).toBe("end_turn");
    const firstResult = await first;
    expect(firstResult.stopReason).toBe("cancelled");
    expect(firstAborted).toBe(true);
  });

  it("waits for the aborted prompt to settle before starting its replacement", async () => {
    let releaseFirst!: () => void;
    let firstStarted!: () => void;
    const firstIsRunning = new Promise<void>((resolve) => { firstStarted = resolve; });
    const release = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let secondStarted = false;
    const handler: PromptHandler = async ({ prompt, signal }) => {
      if (prompt === "first") {
        firstStarted();
        await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
        await release;
        return { stopReason: "cancelled", assistantText: "late partial" };
      }
      secondStarted = true;
      return { stopReason: "end_turn", assistantText: "second answer" };
    };
    const { agent } = makeAgent(handler);
    const session = await agent.newSession({ cwd: "/tmp", mcpServers: [] });
    const first = agent.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "first" }],
    });
    await firstIsRunning;
    const second = agent.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "second" }],
    });
    await Promise.resolve();
    expect(secondStarted).toBe(false);
    releaseFirst();
    expect((await first).stopReason).toBe("cancelled");
    expect((await second).stopReason).toBe("end_turn");
    expect(loadSessionTurns(session.sessionId).map((turn) => turn.content)).toEqual([
      "second",
      "second answer",
    ]);
  });

  it("runs only the newest of two replacements queued behind an active prompt", async () => {
    let releaseFirst!: () => void;
    let firstStarted!: () => void;
    const firstIsRunning = new Promise<void>((resolve) => { firstStarted = resolve; });
    const release = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const entered: string[] = [];
    const { agent } = makeAgent(async ({ prompt, signal }) => {
      entered.push(prompt);
      if (prompt === "first") {
        firstStarted();
        await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
        await release;
        return { stopReason: "cancelled", assistantText: "discarded" };
      }
      return { stopReason: "end_turn", assistantText: `${prompt} answer` };
    });
    const session = await agent.newSession({ cwd: "/tmp", mcpServers: [] });
    const first = agent.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "first" }],
    });
    await firstIsRunning;
    const second = agent.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "second" }],
    });
    const third = agent.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "third" }],
    });
    releaseFirst();

    expect((await first).stopReason).toBe("cancelled");
    expect((await second).stopReason).toBe("cancelled");
    expect((await third).stopReason).toBe("end_turn");
    expect(entered).toEqual(["first", "third"]);
    expect(loadSessionTurns(session.sessionId).map((turn) => turn.content)).toEqual([
      "third",
      "third answer",
    ]);
  });
});

describe("GordonAcpAgent — close lifecycle", () => {
  it("keeps a session open when a Stop hook vetoes closure", async () => {
    const unregister = registerHook({
      id: "test-stop-veto",
      point: "Stop",
      handler: () => ({ action: "block", reason: "operator policy" }),
    });
    const { agent } = makeAgent();
    const session = await agent.newSession({ cwd: "/tmp", mcpServers: [] });
    await expect(agent.closeSession({ sessionId: session.sessionId })).rejects.toThrow(/operator policy/);
    unregister();
    expect((await agent.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "still open" }],
    })).stopReason).toBe("end_turn");
  });

  it("waits for an aborted prompt before deleting session state", async () => {
    let releasePrompt!: () => void;
    let promptStarted!: () => void;
    const started = new Promise<void>((resolve) => { promptStarted = resolve; });
    const release = new Promise<void>((resolve) => { releasePrompt = resolve; });
    const { agent } = makeAgent(async ({ signal }) => {
      promptStarted();
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
      await release;
      return { stopReason: "cancelled", assistantText: "late" };
    });
    const session = await agent.newSession({ cwd: "/tmp", mcpServers: [] });
    const prompt = agent.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "long" }],
    });
    await started;
    let closed = false;
    const close = agent.closeSession({ sessionId: session.sessionId }).then(() => { closed = true; });
    await Promise.resolve();
    expect(closed).toBe(false);
    releasePrompt();
    expect((await prompt).stopReason).toBe("cancelled");
    await close;
    expect(loadSessionTurns(session.sessionId)).toEqual([]);
    await expect(agent.prompt({
      sessionId: session.sessionId,
      prompt: [{ type: "text", text: "too late" }],
    })).rejects.toThrow(/Unknown sessionId/);
  });
});
