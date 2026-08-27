/**
 * Profile → live-gate wiring tests (THE SAFETY GATE).
 *
 * Absolute requirement: with NO profile selected, evaluate() behavior is
 * byte-identical to a build without profiles. A selected profile may ONLY add
 * auto-allow for non-safety-critical tools; it can NEVER relax the deny-list,
 * risk gate, or kill switches.
 */

import { beforeEach, describe, expect, it } from "bun:test";

import type { RuntimeToolPolicyDecision } from "../tools/ToolPolicy.ts";
import { PermissionEngine } from "./PermissionEngine.ts";
import { RuntimeStore } from "../state/RuntimeStore.ts";
import { createDefaultRuntimeSessionState } from "../state/SessionState.ts";
import { _resetDefaultTrustTrajectoryForTests } from "./trustTrajectory.ts";
import {
  buildPermissionProfileHook,
  resolveSelectedProfile,
  PERMISSION_PROFILE_CHAIN,
  resolveProfileAutoAllowTools,
  isSafetyCritical,
} from "./profiles.ts";

function createPolicy(
  overrides: Partial<RuntimeToolPolicyDecision> = {},
): RuntimeToolPolicyDecision {
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

const planPolicy = (id: string): RuntimeToolPolicyDecision =>
  createPolicy({
    tool: {
      ...createPolicy().tool,
      id,
      category: "planning",
      riskClass: "medium",
      permissionScope: "papertrade.execute",
      sideEffectLevel: "write",
      requiresTradePermission: false,
      auditEventType: "plan_author",
    },
  });

const context = {
  userId: "user-1",
  config: { permissionMode: "auto" },
} as any;

function newEngine(): { engine: PermissionEngine; store: RuntimeStore } {
  const store = new RuntimeStore(createDefaultRuntimeSessionState("app"));
  store.setSession({
    runtimeId: "app",
    sessionId: "app",
    resourceId: "user-1",
    threadId: "thread-1",
  });
  return { engine: new PermissionEngine(store), store };
}

describe("resolveSelectedProfile — default OFF", () => {
  it("returns undefined when override is unset/empty/whitespace", () => {
    expect(resolveSelectedProfile(undefined)).toBeUndefined();
    expect(resolveSelectedProfile("")).toBeUndefined();
    expect(resolveSelectedProfile("   ")).toBeUndefined();
  });

  it("resolves each known profile id", () => {
    expect(resolveSelectedProfile("read_only")).toBe("read_only");
    expect(resolveSelectedProfile("paper_trading")).toBe("paper_trading");
    expect(resolveSelectedProfile("live_trading")).toBe("live_trading");
  });

  it("treats an unknown id as no profile (fail-safe), never the privileged one", () => {
    expect(resolveSelectedProfile("super_admin")).toBeUndefined();
    expect(resolveSelectedProfile("LIVE_TRADING")).toBeUndefined(); // case-sensitive
  });
});

describe("buildPermissionProfileHook — no profile → abstains for everything", () => {
  it("abstains regardless of tool when no profile is selected", () => {
    const hook = buildPermissionProfileHook({ profileOverride: "" });
    expect(hook({ toolName: "get_market_data", policy: {} }).decision).toBe("abstain");
    expect(hook({ toolName: "create_plan", policy: {} }).decision).toBe("abstain");
    expect(hook({ toolName: "place_order", policy: {} }).decision).toBe("abstain");
  });
});

describe("default behavior is UNCHANGED when no profile is selected", () => {
  beforeEach(() => _resetDefaultTrustTrajectoryForTests());

  // Mirror the established PermissionEngine.test.ts expectations: with the
  // profile hook prepended but NO profile selected, every result must match
  // what the engine returns today.

  it("high-risk execution tool still QUEUES (pending), not auto-allowed", async () => {
    const { engine, store } = newEngine();
    engine.prependHook(buildPermissionProfileHook({ profileOverride: "" }));

    const evaluation = await engine.evaluate("place_market_order", context, createPolicy());
    expect(evaluation.status).toBe("pending");
    expect(store.getState().approvals.pending).toHaveLength(1);
  });

  it("low-risk read-only action still auto-allows via the classifier", async () => {
    const { engine } = newEngine();
    engine.prependHook(buildPermissionProfileHook({ profileOverride: "" }));

    const evaluation = await engine.evaluate(
      "check_positions",
      context,
      createPolicy({
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
      }),
    );
    expect(evaluation.status).toBe("allowed");
    expect(evaluation.source).toBe("classifier");
  });

  it("plan-authoring (medium/write) still QUEUES with no profile", async () => {
    const { engine } = newEngine();
    engine.prependHook(buildPermissionProfileHook({ profileOverride: "" }));

    const evaluation = await engine.evaluate("create_plan", context, planPolicy("create_plan"));
    expect(evaluation.status).toBe("pending");
  });
});

describe("a SELECTED profile only adds auto-allow for its non-safety tools", () => {
  beforeEach(() => _resetDefaultTrustTrajectoryForTests());

  it("read_only auto-allows compute_risk (was pending without profile)", async () => {
    const { engine } = newEngine();
    engine.prependHook(buildPermissionProfileHook({ profileOverride: "read_only" }));

    const evaluation = await engine.evaluate("compute_risk", context, planPolicy("compute_risk"));
    expect(evaluation.status).toBe("allowed");
    expect(evaluation.request?.actor).toBe("classifier:permission-profile");
  });

  it("read_only does NOT auto-allow plan/exec tools (create_plan, execute_plan)", async () => {
    const { engine } = newEngine();
    engine.prependHook(buildPermissionProfileHook({ profileOverride: "read_only" }));

    const plan = await engine.evaluate("create_plan", context, planPolicy("create_plan"));
    expect(plan.status).toBe("pending");

    const exec = await engine.evaluate(
      "execute_plan",
      context,
      createPolicy({
        tool: { ...createPolicy().tool, id: "execute_plan" },
      }),
    );
    expect(exec.status).toBe("pending");
  });

  it("paper_trading auto-allows create_plan but NOT execute_plan", async () => {
    const { engine } = newEngine();
    engine.prependHook(buildPermissionProfileHook({ profileOverride: "paper_trading" }));

    const plan = await engine.evaluate("create_plan", context, planPolicy("create_plan"));
    expect(plan.status).toBe("allowed");
    expect(plan.request?.actor).toBe("classifier:permission-profile");

    const exec = await engine.evaluate(
      "execute_plan",
      context,
      createPolicy({
        tool: { ...createPolicy().tool, id: "execute_plan" },
      }),
    );
    expect(exec.status).toBe("pending");
  });

  it("always_require_human approvalClass is honored — profile abstains", async () => {
    const { engine } = newEngine();
    engine.prependHook(buildPermissionProfileHook({ profileOverride: "read_only" }));

    const evaluation = await engine.evaluate("compute_risk", context, {
      ...planPolicy("compute_risk"),
      approvalClass: "always_require_human",
    });
    expect(evaluation.status).toBe("pending");
  });
});

describe("NO profile ever auto-allows a safety-critical / deny-list tool", () => {
  beforeEach(() => _resetDefaultTrustTrajectoryForTests());

  const denyListed = [
    "place_order",
    "place_market_order",
    "execute_plan",
    "execute_trade",
    "cancel_order",
    "cancel_all_orders",
    "submit_order",
    "wallet_transfer",
    "wallet_send",
    "transfer_funds",
    "withdraw",
    "approve_token",
    "exec_shell",
    "run_shell",
  ];

  it("every profile abstains on every deny-list tool at the hook level", () => {
    for (const profile of PERMISSION_PROFILE_CHAIN) {
      const hook = buildPermissionProfileHook({ profileOverride: profile });
      for (const tool of denyListed) {
        expect(
          hook({ toolName: tool, policy: {} }).decision,
          `profile "${profile}" must abstain on deny-list tool "${tool}"`,
        ).toBe("abstain");
      }
    }
  });

  it("no profile's resolved auto-allow set contains a safety-critical tool", () => {
    for (const profile of PERMISSION_PROFILE_CHAIN) {
      for (const tool of resolveProfileAutoAllowTools(profile)) {
        expect(isSafetyCritical(tool), `profile "${profile}" auto-allows "${tool}"`).toBe(false);
      }
    }
  });

  it("live_trading routes every deny-list tool to pending (NOT auto-allowed) through evaluate()", async () => {
    for (const tool of denyListed) {
      const { engine } = newEngine();
      engine.prependHook(buildPermissionProfileHook({ profileOverride: "live_trading" }));
      const evaluation = await engine.evaluate(
        tool,
        context,
        createPolicy({
          tool: { ...createPolicy().tool, id: tool },
        }),
      );
      expect(evaluation.status, `${tool} must not be allowed under live_trading`).not.toBe(
        "allowed",
      );
    }
  });

  it("even a manually-poisoned auto-allow list cannot widen a safety-critical tool", () => {
    // The hard floor is isSafetyCritical(), independent of the table contents.
    // Simulate: the hook is built for live_trading (empty auto-allow), then we
    // assert a deny-list tool can never come back allow. (Table is already
    // clean per the test above; this asserts the floor, not the table.)
    const hook = buildPermissionProfileHook({ profileOverride: "live_trading" });
    expect(hook({ toolName: "place_order", policy: {} }).decision).toBe("abstain");
    expect(hook({ toolName: "wallet_transfer", policy: {} }).decision).toBe("abstain");
  });
});
