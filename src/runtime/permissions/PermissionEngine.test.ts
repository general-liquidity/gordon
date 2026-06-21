import { beforeEach, describe, expect, it } from "bun:test";

import type { RuntimeToolPolicyDecision } from "../tools/ToolPolicy.ts";
import { PermissionEngine } from "./PermissionEngine.ts";
import { RuntimeStore } from "../state/RuntimeStore.ts";
import { createDefaultRuntimeSessionState } from "../state/SessionState.ts";
import {
  _resetDefaultTrustTrajectoryForTests,
  getDefaultTrustTrajectory,
} from "./trustTrajectory.ts";

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
});
