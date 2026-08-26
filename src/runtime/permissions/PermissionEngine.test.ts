import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import type { RuntimeToolPolicyDecision } from "../tools/ToolPolicy.ts";
import { CapabilityRegistry } from "../tools/CapabilityRegistry.ts";
import { PermissionEngine } from "./PermissionEngine.ts";
import { RuntimeStore } from "../state/RuntimeStore.ts";
import { createDefaultRuntimeSessionState } from "../state/SessionState.ts";
import {
  _resetDefaultTrustTrajectoryForTests,
  getDefaultTrustTrajectory,
} from "./trustTrajectory.ts";
import { clearHooks, registerHook } from "../../infra/hooks/engine.ts";

afterEach(() => clearHooks());

function createPolicy(overrides: Partial<RuntimeToolPolicyDecision> = {}): RuntimeToolPolicyDecision {
  return {
    allowed: true,
    approvalClass: "per_action",
    tool: {
      id: "place_market_order",
      category: "execution",
      riskClass: "high",
      permissionScope: "livetrade.execute",
      sideEffectLevel: "execution",
      requiresTradePermission: true,
      supportsStreaming: false,
      supportsBackground: false,
      idempotent: false,
      workerRole: "Executor",
      auditEventType: "trade_execute",
      origin: "builtin",
    },
    ...overrides,
  };
}

const context = {
  userId: "user-1",
  config: {
    permissionMode: "auto",
  },
} as any;

describe("PermissionEngine", () => {
  beforeEach(() => {
    _resetDefaultTrustTrajectoryForTests();
  });

  it("queues high-risk approvals and resolves them via explicit approval", async () => {
    const store = new RuntimeStore(createDefaultRuntimeSessionState("app"));
    store.setSession({ runtimeId: "app", sessionId: "app", resourceId: "user-1", threadId: "thread-1" });
    const engine = new PermissionEngine(store);

    const evaluation = await engine.evaluate("place_market_order", context, createPolicy());
    expect(evaluation.status).toBe("pending");
    expect(store.getState().approvals.pending).toHaveLength(1);

    const approved = engine.approve(evaluation.request!.id, { actor: "operator", persist: true });
    expect(approved?.status).toBe("approved");
    expect(store.getState().approvals.pending).toHaveLength(0);
    expect(store.getState().approvals.rules).toHaveLength(1);

    const followUp = await engine.evaluate("place_market_order", context, createPolicy());
    expect(followUp.status).toBe("allowed");
    expect(followUp.source).toBe("rule");
  });

  it("runs PreApproval before queueing and PostApproval after a human decision", async () => {
    const events: string[] = [];
    const observedArgs: unknown[] = [];
    registerHook({
      id: "pre",
      point: "PreApproval",
      handler: (payload) => {
        events.push(`pre:${payload.action}`);
        observedArgs.push(payload.args);
        return { action: "modify", replacement: { rationale: "reviewed rationale" } };
      },
    });
    registerHook({
      id: "post",
      point: "PostApproval",
      handler: (payload) => {
        events.push(`post:${payload.decision}`);
        observedArgs.push(payload.args);
        return { action: "allow" };
      },
    });
    const store = new RuntimeStore(createDefaultRuntimeSessionState("app"));
    const engine = new PermissionEngine(store);
    const args = { symbol: "BTCUSDT", quantity: 0.25 };
    const evaluation = await engine.evaluate("place_market_order", context, createPolicy(), args);
    expect(evaluation.request?.reason).toBe("reviewed rationale");
    engine.approve(evaluation.request!.id, { actor: "operator" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toEqual(["pre:place_market_order", "post:once"]);
    expect(observedArgs).toEqual([args, args]);
  });

  it("does not collapse approvals for the same tool with different arguments", async () => {
    const store = new RuntimeStore(createDefaultRuntimeSessionState("app"));
    const engine = new PermissionEngine(store);

    const first = await engine.evaluate(
      "place_market_order",
      context,
      createPolicy(),
      { symbol: "BTCUSDT", side: "buy", quantity: 1 },
    );
    const reorderedSame = await engine.evaluate(
      "place_market_order",
      context,
      createPolicy(),
      { quantity: 1, side: "buy", symbol: "BTCUSDT" },
    );
    const different = await engine.evaluate(
      "place_market_order",
      context,
      createPolicy(),
      { symbol: "BTCUSDT", side: "buy", quantity: 2 },
    );

    expect(reorderedSame.request?.id).toBe(first.request?.id);
    expect(different.request?.id).not.toBe(first.request?.id);
    expect(store.getState().approvals.pending).toHaveLength(2);
  });

  it("keeps argument identity on approvals resolved directly by a permission hook", async () => {
    const store = new RuntimeStore(createDefaultRuntimeSessionState("app"));
    const engine = new PermissionEngine(store);
    engine.prependHook(() => ({ decision: "allow", actor: "test-policy" }));

    const first = await engine.evaluate(
      "place_market_order",
      context,
      createPolicy(),
      { symbol: "BTCUSDT", quantity: 1 },
    );
    const second = await engine.evaluate(
      "place_market_order",
      context,
      createPolicy(),
      { symbol: "BTCUSDT", quantity: 2 },
    );

    expect(first.request?.fingerprint).not.toBe(second.request?.fingerprint);
  });

  it("emits PostApproval with each request's own arguments when a denial cascades", async () => {
    const observed: Array<{ action: string; args: unknown }> = [];
    registerHook({
      id: "post-cascade",
      point: "PostApproval",
      handler: (payload) => {
        observed.push({ action: payload.action, args: payload.args });
        return { action: "allow" };
      },
    });
    const store = new RuntimeStore(createDefaultRuntimeSessionState("app"));
    const engine = new PermissionEngine(store);
    const firstArgs = { symbol: "BTCUSDT", quantity: 1 };
    const secondArgs = { symbol: "ETHUSDT", quantity: 2 };
    const first = await engine.evaluate("place_market_order", context, createPolicy(), firstArgs);
    await engine.evaluate(
      "rebalance_portfolio",
      context,
      createPolicy({ tool: { ...createPolicy().tool, id: "rebalance_portfolio" } }),
      secondArgs,
    );

    engine.deny(first.request!.id, { actor: "operator", cascade: true });
    await Bun.sleep(0);

    expect(observed).toEqual([
      { action: "place_market_order", args: firstArgs },
      { action: "rebalance_portfolio", args: secondArgs },
    ]);
    expect(store.getState().approvals.pending).toHaveLength(0);
  });

  it("a PreApproval block prevents a pending request from being created", async () => {
    registerHook({ id: "deny", point: "PreApproval", handler: () => ({ action: "block", reason: "closed" }) });
    const store = new RuntimeStore(createDefaultRuntimeSessionState("app"));
    const engine = new PermissionEngine(store);
    const evaluation = await engine.evaluate("place_market_order", context, createPolicy());
    expect(evaluation).toMatchObject({ status: "blocked", source: "hook", reason: "deny: closed" });
    expect(store.getState().approvals.pending).toHaveLength(0);
  });

  it("fails closed when PreApproval replaces the rationale with an invalid value", async () => {
    registerHook({
      id: "malformed",
      point: "PreApproval",
      handler: () => ({ action: "modify", replacement: { rationale: { unsafe: true } } }),
    });
    const store = new RuntimeStore(createDefaultRuntimeSessionState("app"));
    const engine = new PermissionEngine(store);

    const evaluation = await engine.evaluate("place_market_order", context, createPolicy());

    expect(evaluation).toMatchObject({
      status: "blocked",
      source: "hook",
      reason: "PreApproval hook produced an invalid rationale.",
    });
    expect(store.getState().approvals.pending).toHaveLength(0);
  });

  it("records human decisions into trust trajectory with permission scope", async () => {
    const store = new RuntimeStore(createDefaultRuntimeSessionState("app"));
    store.setSession({ runtimeId: "app", sessionId: "app", resourceId: "user-1", threadId: "thread-1" });
    const engine = new PermissionEngine(store);

    const evaluation = await engine.evaluate("rebalance_portfolio", context, createPolicy({
      tool: {
        ...createPolicy().tool,
        id: "rebalance_portfolio",
        permissionScope: "papertrade.execute",
      },
    }));
    expect(evaluation.status).toBe("pending");

    engine.approve(evaluation.request!.id, { actor: "operator" });

    expect(getDefaultTrustTrajectory().listEvents()).toMatchObject([{
      toolName: "rebalance_portfolio",
      permissionScope: "papertrade.execute",
      decision: "approved",
    }]);
  });

  it("a wildcard allow rule does NOT auto-allow a deny-listed tool, but does allow a benign one", async () => {
    const store = new RuntimeStore(createDefaultRuntimeSessionState("app"));
    store.setSession({ runtimeId: "app", sessionId: "app", resourceId: "user-1", threadId: "thread-1" });
    // Broad, scope-less wildcard allow rule (matches any tool name / scope).
    store.setApprovalState({
      rules: [{
        id: "wildcard-allow",
        decision: "allow",
        scope: "persistent",
        createdAt: new Date().toISOString(),
        createdBy: "operator",
      }],
    });
    const engine = new PermissionEngine(store);

    // Safety-critical tool: the wildcard allow must be suppressed; it routes
    // to the human/confirmation queue instead of auto-allowing.
    const denyListed = await engine.evaluate("place_order", context, createPolicy({
      tool: { ...createPolicy().tool, id: "place_order" },
    }));
    expect(denyListed.status).toBe("pending");
    expect(denyListed.source).not.toBe("rule");

    // Non-safety-critical tool under the same wildcard rule IS allowed by it.
    const benign = await engine.evaluate("get_portfolio", context, createPolicy({
      tool: {
        ...createPolicy().tool,
        id: "get_portfolio",
        category: "monitoring",
        riskClass: "low",
        permissionScope: "portfolio.read",
        sideEffectLevel: "read",
        requiresTradePermission: false,
        idempotent: true,
        auditEventType: "portfolio_read",
      },
    }));
    expect(benign.status).toBe("allowed");
    expect(benign.source).toBe("rule");
  });

  it("auto-allows low-risk read-only actions via the classifier", async () => {
    const store = new RuntimeStore(createDefaultRuntimeSessionState("app"));
    const engine = new PermissionEngine(store);

    const evaluation = await engine.evaluate("check_positions", context, createPolicy({
      approvalClass: "none",
      tool: {
        ...createPolicy().tool,
        id: "check_positions",
        category: "monitoring",
        riskClass: "low",
        permissionScope: "portfolio.read",
        sideEffectLevel: "read",
        requiresTradePermission: false,
        idempotent: true,
        auditEventType: "portfolio_read",
      },
    }));

    expect(evaluation.status).toBe("allowed");
    expect(evaluation.source).toBe("classifier");
  });

  it("requires human approval for manage_flags", async () => {
    const store = new RuntimeStore(createDefaultRuntimeSessionState("app"));
    const engine = new PermissionEngine(store);

    // Spec comes from the live registry, so this asserts the declaration, not a
    // fixture. Approval class matches ToolPolicy's mapping for system.mode.write.
    const spec = new CapabilityRegistry().resolveToolSpec("manage_flags");
    const evaluation = await engine.evaluate("manage_flags", context, createPolicy({
      approvalClass: "per_tool",
      tool: spec,
    }));

    expect(evaluation.status).toBe("pending");
    expect(store.getState().approvals.pending).toHaveLength(1);
  });

  it("queues an undeclared, unrecognized tool instead of auto-allowing it", async () => {
    const store = new RuntimeStore(createDefaultRuntimeSessionState("app"));
    const engine = new PermissionEngine(store);

    const spec = new CapabilityRegistry().resolveToolSpec("zzz_unrecognized_widget");
    const evaluation = await engine.evaluate("zzz_unrecognized_widget", context, createPolicy({
      approvalClass: "per_tool",
      tool: spec,
    }));

    expect(evaluation.status).toBe("pending");
  });
});
