import { describe, it, expect, beforeEach } from "bun:test";
import {
  emitUsageUpdate,
  getSessionUsage,
  resetSessionUsage,
  dropSessionUsage,
} from "./usage-tracker.ts";
import type { AgentSideConnection } from "@agentclientprotocol/sdk";

interface Captured {
  sessionId: string;
  update: Record<string, unknown>;
}

function makeFakeConnection(): { connection: AgentSideConnection; updates: Captured[] } {
  const updates: Captured[] = [];
  const fake = {
    sessionUpdate: async (payload: Captured) => {
      updates.push(payload);
    },
  } as unknown as AgentSideConnection;
  return { connection: fake, updates };
}

beforeEach(() => {
  // Clear session state between tests
  dropSessionUsage("s1");
  dropSessionUsage("s2");
});

describe("usage tracker — accumulation", () => {
  it("starts at zero after reset", () => {
    resetSessionUsage("s1");
    const state = getSessionUsage("s1");
    expect(state).toEqual({ promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 });
  });

  it("accumulates across multiple emitUsageUpdate calls", async () => {
    const { connection } = makeFakeConnection();
    await emitUsageUpdate(connection, "s1", { promptTokens: 100, completionTokens: 50 });
    await emitUsageUpdate(connection, "s1", { promptTokens: 200, completionTokens: 75 });
    const state = getSessionUsage("s1")!;
    expect(state.promptTokens).toBe(300);
    expect(state.completionTokens).toBe(125);
    expect(state.totalTokens).toBe(425);
  });

  it("respects explicit totalTokens delta when provided", async () => {
    const { connection } = makeFakeConnection();
    await emitUsageUpdate(connection, "s1", {
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 200, // explicit override (different from sum)
    });
    expect(getSessionUsage("s1")!.totalTokens).toBe(200);
  });

  it("accumulates costUsd when provided", async () => {
    const { connection } = makeFakeConnection();
    await emitUsageUpdate(connection, "s1", {
      promptTokens: 100,
      completionTokens: 50,
      costUsd: 0.05,
    });
    await emitUsageUpdate(connection, "s1", {
      promptTokens: 100,
      completionTokens: 50,
      costUsd: 0.03,
    });
    expect(getSessionUsage("s1")!.costUsd).toBeCloseTo(0.08, 4);
  });

  it("isolates state per sessionId", async () => {
    const { connection } = makeFakeConnection();
    await emitUsageUpdate(connection, "s1", { promptTokens: 100, completionTokens: 50 });
    await emitUsageUpdate(connection, "s2", { promptTokens: 999, completionTokens: 999 });
    expect(getSessionUsage("s1")!.promptTokens).toBe(100);
    expect(getSessionUsage("s2")!.promptTokens).toBe(999);
  });

  it("emits sessionUpdate with cumulative totals", async () => {
    const { connection, updates } = makeFakeConnection();
    await emitUsageUpdate(connection, "s1", { promptTokens: 50, completionTokens: 25 });
    await emitUsageUpdate(connection, "s1", { promptTokens: 30, completionTokens: 15 });
    expect(updates).toHaveLength(2);
    expect(updates[1]!.update.sessionUpdate).toBe("usage_update");
    const usage = updates[1]!.update.usage as {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
    expect(usage.promptTokens).toBe(80);
    expect(usage.completionTokens).toBe(40);
    expect(usage.totalTokens).toBe(120);
  });

  it("omits costUsd from emitted payload when total is zero", async () => {
    const { connection, updates } = makeFakeConnection();
    await emitUsageUpdate(connection, "s1", { promptTokens: 100, completionTokens: 50 });
    const usage = updates[0]!.update.usage as { costUsd?: number };
    expect(usage.costUsd).toBeUndefined();
  });

  it("includes costUsd when accumulated > 0", async () => {
    const { connection, updates } = makeFakeConnection();
    await emitUsageUpdate(connection, "s1", {
      promptTokens: 100,
      completionTokens: 50,
      costUsd: 0.01,
    });
    const usage = updates[0]!.update.usage as { costUsd?: number };
    expect(usage.costUsd).toBeCloseTo(0.01, 4);
  });
});

describe("usage tracker — lifecycle", () => {
  it("dropSessionUsage clears state", () => {
    resetSessionUsage("s1");
    dropSessionUsage("s1");
    expect(getSessionUsage("s1")).toBeNull();
  });

  it("emitUsageUpdate auto-initializes when called without reset", async () => {
    const { connection } = makeFakeConnection();
    dropSessionUsage("s1");
    await emitUsageUpdate(connection, "s1", { promptTokens: 10, completionTokens: 5 });
    expect(getSessionUsage("s1")!.totalTokens).toBe(15);
  });
});
