import { describe, expect, it } from "bun:test";

import type { RuntimeToolPolicyDecision } from "../tools/ToolPolicy.ts";
import { PermissionEngine } from "./PermissionEngine.ts";
import { RuntimeStore } from "../state/RuntimeStore.ts";
import { createDefaultRuntimeSessionState } from "../state/SessionState.ts";

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
      requiresArmedMode: true,
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
    mode: "ARMED",
  },
} as any;

describe("PermissionEngine", () => {
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
        requiresArmedMode: false,
        idempotent: true,
        auditEventType: "portfolio_read",
      },
    }));

    expect(evaluation.status).toBe("allowed");
    expect(evaluation.source).toBe("classifier");
  });
});
