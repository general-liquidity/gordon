import { describe, expect, test } from "bun:test";
import {
  HandoffCoordinator,
  type FilterableMessage,
} from "./HandoffCoordinator.ts";
import {
  isNativeSupervisorEnabled,
  shouldBlockDelegation,
  buildNativeSupervisorDelegation,
  type SupervisorDelegationState,
} from "./nativeSupervisor.ts";

describe("isNativeSupervisorEnabled", () => {
  test("default (unset) is off", () => {
    expect(isNativeSupervisorEnabled({})).toBe(false);
  });

  test("accepts 1 / true / yes (case-insensitive)", () => {
    expect(isNativeSupervisorEnabled({ GORDON_NATIVE_SUPERVISOR: "1" })).toBe(true);
    expect(isNativeSupervisorEnabled({ GORDON_NATIVE_SUPERVISOR: "TRUE" })).toBe(true);
    expect(isNativeSupervisorEnabled({ GORDON_NATIVE_SUPERVISOR: " Yes " })).toBe(true);
  });

  test("rejects other values", () => {
    expect(isNativeSupervisorEnabled({ GORDON_NATIVE_SUPERVISOR: "0" })).toBe(false);
    expect(isNativeSupervisorEnabled({ GORDON_NATIVE_SUPERVISOR: "off" })).toBe(false);
  });
});

describe("messageFilter preserves the permission-scoped split", () => {
  const messages: FilterableMessage[] = [
    { role: "user", content: "balance: 12,345.67 USDT and equity: $250,000" },
    { role: "assistant", content: "API key EXAMPLEFAKETOKEN0123456789abcdef0123456789abcdef" },
  ];

  function runFilter(primitiveId: string) {
    const coordinator = new HandoffCoordinator();
    const state: SupervisorDelegationState = { currentAgent: undefined };
    const delegation = buildNativeSupervisorDelegation(state, coordinator);
    const filter = delegation.messageFilter as (ctx: any) => FilterableMessage[];
    return filter({ primitiveId, messages });
  }

  test("researcher (no execution) loses account financials AND secrets", () => {
    const out = runFilter("researcher");
    const text = JSON.stringify(out);
    expect(text).not.toContain("12,345.67");
    expect(text).not.toContain("250,000");
    expect(text).toContain("[REDACTED_BALANCE]");
    expect(text).toContain("[REDACTED_EQUITY]");
    // secrets stripped for every sub-agent
    expect(text).not.toContain("EXAMPLEFAKETOKEN0123456789abcdef0123456789abcdef");
  });

  test("executor keeps account financials (needs them to size) but loses secrets", () => {
    const out = runFilter("executor");
    const text = JSON.stringify(out);
    // balances survive for the executor
    expect(text).toContain("12,345.67");
    // but raw credentials never reach any sub-agent
    expect(text).not.toContain("EXAMPLEFAKETOKEN0123456789abcdef0123456789abcdef");
    expect(text).toContain("[REDACTED_SECRET]");
  });

  test("input messages are never mutated", () => {
    const before = JSON.stringify(messages);
    runFilter("researcher");
    expect(JSON.stringify(messages)).toBe(before);
  });
});

describe("onDelegationStart", () => {
  test("sets currentAgent and proceeds for the researcher", async () => {
    const coordinator = new HandoffCoordinator();
    const state: SupervisorDelegationState = { currentAgent: undefined };
    const delegation = buildNativeSupervisorDelegation(state, coordinator);
    const onStart = delegation.onDelegationStart as (ctx: any) => Promise<any>;

    const res = await onStart({ primitiveId: "researcher", toolCallId: "tc1" });
    expect(state.currentAgent).toBe("researcher");
    expect(res.proceed).toBe(true);
  });

  test("proceeds for the executor (known worker, no loop)", async () => {
    const coordinator = new HandoffCoordinator();
    const state: SupervisorDelegationState = { currentAgent: undefined };
    const delegation = buildNativeSupervisorDelegation(state, coordinator);
    const onStart = delegation.onDelegationStart as (ctx: any) => Promise<any>;

    const res = await onStart({ primitiveId: "executor", toolCallId: "tc2" });
    expect(res.proceed).toBe(true);
    expect(state.currentAgent).toBe("executor");
  });
});

describe("shouldBlockDelegation loop-safety", () => {
  test("blocks a circular Gordon <-> Executor loop", () => {
    const coordinator = new HandoffCoordinator();
    // Seed 3 consecutive Executor -> Gordon round-trips so the next
    // Gordon -> Executor validate() trips the circular guard.
    const history = (coordinator as unknown as { history: unknown[] }).history;
    for (let i = 0; i < 3; i++) {
      history.push({
        handoffId: `h${i}`,
        fromAgent: "Executor",
        toAgent: "Gordon",
        timestamp: Date.now(),
        validated: true,
      });
    }
    const decision = shouldBlockDelegation("executor", coordinator);
    expect(decision.block).toBe(true);
    expect(decision.reason).toMatch(/circular/i);
  });

  test("does not block the unknown researcher role (advisory only)", () => {
    const coordinator = new HandoffCoordinator();
    const decision = shouldBlockDelegation("researcher", coordinator);
    expect(decision.block).toBe(false);
  });
});

describe("onDelegationComplete", () => {
  test("returns recovery feedback on delegation error", async () => {
    const coordinator = new HandoffCoordinator();
    const state: SupervisorDelegationState = { currentAgent: undefined };
    const delegation = buildNativeSupervisorDelegation(state, coordinator);
    const onComplete = delegation.onDelegationComplete as (ctx: any) => Promise<any>;

    const res = await onComplete({ primitiveId: "researcher", error: new Error("boom") });
    expect(res.feedback).toContain("researcher");
    expect(res.feedback).toContain("failed");
  });

  test("drains queued supervisor feedback into the next iteration", async () => {
    const coordinator = new HandoffCoordinator();
    coordinator.recordDelegationFeedback("Gordon", "researcher", "no risk section — revise");
    const state: SupervisorDelegationState = { currentAgent: undefined };
    const delegation = buildNativeSupervisorDelegation(state, coordinator);
    const onComplete = delegation.onDelegationComplete as (ctx: any) => Promise<any>;

    const res = await onComplete({ primitiveId: "researcher" });
    expect(res.feedback).toContain("no risk section");
    // drained exactly once
    const second = await onComplete({ primitiveId: "researcher" });
    expect(second.feedback).toBeUndefined();
  });
});
