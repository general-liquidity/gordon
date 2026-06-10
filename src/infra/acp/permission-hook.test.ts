import { beforeEach, describe, it, expect } from "bun:test";
import { installAcpPermissionHook } from "./permission-hook.ts";
import type { AgentSideConnection } from "@agentclientprotocol/sdk";
import type { PermissionEngine } from "../../runtime/permissions/PermissionEngine.ts";
import { _resetDefaultTrustTrajectoryForTests } from "../../runtime/permissions/trustTrajectory.ts";

// Mock PermissionEngine that records prepended hooks
class FakePermissionEngine {
  hooks: Array<(input: { toolName: string; policy: any }) => unknown> = [];
  prependHook(hook: (input: { toolName: string; policy: any }) => unknown): () => void {
    this.hooks.unshift(hook);
    return () => {
      const idx = this.hooks.indexOf(hook);
      if (idx >= 0) this.hooks.splice(idx, 1);
    };
  }
  // Call the first hook for testing
  async invokeHook(toolName: string, policy: any = defaultPolicy()): Promise<unknown> {
    const hook = this.hooks[0];
    if (!hook) return null;
    return hook({ toolName, policy });
  }
}

function defaultPolicy(overrides: any = {}): any {
  return {
    approvalClass: "per_action",
    ...overrides,
    tool: {
      id: "get_market_data",
      permissionScope: "market.read",
      riskClass: "medium",
      sideEffectLevel: "write",
      ...(overrides.tool ?? {}),
    },
  };
}

function fakeConnection(
  responder: () => unknown,
): { connection: AgentSideConnection; calls: Array<{ toolName?: string }> } {
  const calls: Array<{ toolName?: string }> = [];
  const fake = {
    requestPermission: async (req: unknown) => {
      const r = req as { toolCall?: { title?: string } };
      calls.push({ toolName: r.toolCall?.title });
      return responder();
    },
  } as unknown as AgentSideConnection;
  return { connection: fake, calls };
}

describe("installAcpPermissionHook", () => {
  beforeEach(() => {
    _resetDefaultTrustTrajectoryForTests();
  });

  it("safety-critical tools abstain (no editor prompt)", async () => {
    const engine = new FakePermissionEngine();
    const { connection, calls } = fakeConnection(() => ({
      outcome: { outcome: "selected", optionId: "allow_once" },
    }));
    installAcpPermissionHook(engine as unknown as PermissionEngine, {
      sessionId: "s1",
      connection,
    });
    const result = await engine.invokeHook("place_order");
    expect(result).toEqual({ decision: "abstain" });
    expect(calls).toHaveLength(0);
  });

  it("already-safe read-only tools abstain so the default classifier can allow them", async () => {
    const engine = new FakePermissionEngine();
    const { connection, calls } = fakeConnection(() => ({
      outcome: { outcome: "selected", optionId: "allow_once" },
    }));
    installAcpPermissionHook(engine as unknown as PermissionEngine, {
      sessionId: "safe",
      connection,
    });
    const result = await engine.invokeHook("get_market_data", defaultPolicy({
      approvalClass: "none",
      tool: { riskClass: "low", sideEffectLevel: "read" },
    }));
    expect(result).toEqual({ decision: "abstain" });
    expect(calls).toHaveLength(0);
  });

  it("non-critical tools emit request_permission + allow_once → allow", async () => {
    const engine = new FakePermissionEngine();
    const { connection, calls } = fakeConnection(() => ({
      outcome: { outcome: "selected", optionId: "allow_once" },
    }));
    installAcpPermissionHook(engine as unknown as PermissionEngine, {
      sessionId: "s2",
      connection,
    });
    const result = await engine.invokeHook("get_market_data");
    expect(calls).toHaveLength(1);
    expect((result as { decision: string }).decision).toBe("allow");
  });

  it("reject_once → deny", async () => {
    const engine = new FakePermissionEngine();
    const { connection } = fakeConnection(() => ({
      outcome: { outcome: "selected", optionId: "reject_once" },
    }));
    installAcpPermissionHook(engine as unknown as PermissionEngine, {
      sessionId: "s3",
      connection,
    });
    const result = await engine.invokeHook("get_market_data");
    expect((result as { decision: string }).decision).toBe("deny");
  });

  it("allow_always returns a persistent scoped allow rule request", async () => {
    const engine = new FakePermissionEngine();
    const { connection } = fakeConnection(() => ({
      outcome: { outcome: "selected", optionId: "allow_always" },
    }));
    installAcpPermissionHook(engine as unknown as PermissionEngine, {
      sessionId: "s-always",
      connection,
    });
    const result = await engine.invokeHook("get_market_data");
    expect(result).toMatchObject({
      decision: "allow",
      actor: "acp-editor",
      persist: true,
      scope: "persistent",
    });
  });

  it("reject_always returns a persistent scoped deny rule request", async () => {
    const engine = new FakePermissionEngine();
    const { connection } = fakeConnection(() => ({
      outcome: { outcome: "selected", optionId: "reject_always" },
    }));
    installAcpPermissionHook(engine as unknown as PermissionEngine, {
      sessionId: "s-deny-always",
      connection,
    });
    const result = await engine.invokeHook("get_market_data");
    expect(result).toMatchObject({
      decision: "deny",
      actor: "acp-editor",
      persist: true,
      scope: "persistent",
    });
  });

  it("cancelled outcome → deny (operator dismissed prompt)", async () => {
    const engine = new FakePermissionEngine();
    const { connection } = fakeConnection(() => ({ outcome: { outcome: "cancelled" } }));
    installAcpPermissionHook(engine as unknown as PermissionEngine, {
      sessionId: "s4",
      connection,
    });
    const result = await engine.invokeHook("get_market_data");
    expect((result as { decision: string }).decision).toBe("deny");
  });

  it("connection error falls through to abstain (default classifier runs)", async () => {
    const engine = new FakePermissionEngine();
    const fake = {
      requestPermission: async () => {
        throw new Error("editor disconnected");
      },
    } as unknown as AgentSideConnection;
    installAcpPermissionHook(engine as unknown as PermissionEngine, {
      sessionId: "s5",
      connection: fake,
    });
    const result = await engine.invokeHook("get_market_data");
    expect(result).toEqual({ decision: "abstain" });
  });

  it("uninstaller removes the hook", async () => {
    const engine = new FakePermissionEngine();
    const { connection } = fakeConnection(() => ({
      outcome: { outcome: "selected", optionId: "allow_once" },
    }));
    const uninstall = installAcpPermissionHook(engine as unknown as PermissionEngine, {
      sessionId: "s6",
      connection,
    });
    expect(engine.hooks.length).toBe(1);
    uninstall();
    expect(engine.hooks.length).toBe(0);
  });
});
