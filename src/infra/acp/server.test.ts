import { describe, it, expect } from "bun:test";
import {
  GordonAcpAgent,
  type PromptHandler,
} from "./server.ts";
import { PROTOCOL_VERSION } from "@agentclientprotocol/sdk";

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

  it("setSessionMode returns empty (v1 no-op)", async () => {
    const { agent } = makeAgent();
    const result = await agent.setSessionMode({ sessionId: "00".repeat(16), modeId: "default" });
    expect(result).toEqual({});
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
});
