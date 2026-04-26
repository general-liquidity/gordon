import { describe, it, expect, beforeEach } from "bun:test";
import { CostTracker, resetCostBudgetState } from "./costTracker.ts";
import { getEventBus } from "../../events/bus.ts";
import type { GordonEvent } from "../../events/types.ts";

describe("CostTracker — cost:turn_delta event", () => {
  beforeEach(() => {
    resetCostBudgetState();
    getEventBus().clearHistory();
  });

  it("emits a cost:turn_delta event on every record() call", async () => {
    const events: GordonEvent[] = [];
    const unsub = getEventBus().on("cost:turn_delta", (e) => {
      events.push(e);
    });

    const tracker = new CostTracker("test-session-1");
    tracker.record({
      modelId: "claude-sonnet-4-5",
      displayName: "Sonnet 4.5",
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 10,
      cacheWriteTokens: 0,
    });

    // Allow the void emit microtask to settle
    await new Promise((r) => setImmediate(r));

    expect(events.length).toBe(1);
    const evt = events[0] as GordonEvent & {
      modelId: string;
      displayName: string;
      callCostUsd: number;
      sessionTotalUsd: number;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      sessionId: string;
    };
    expect(evt.type).toBe("cost:turn_delta");
    expect(evt.modelId).toBe("claude-sonnet-4-5");
    expect(evt.displayName).toBe("Sonnet 4.5");
    expect(evt.inputTokens).toBe(100);
    expect(evt.outputTokens).toBe(50);
    expect(evt.cacheReadTokens).toBe(10);
    expect(evt.sessionId).toBe("test-session-1");
    expect(evt.sessionTotalUsd).toBeGreaterThanOrEqual(0);
    unsub();
  });

  it("call cost reflects only the latest call, not the running total", async () => {
    const deltas: number[] = [];
    const unsub = getEventBus().on("cost:turn_delta", (e) => {
      const evt = e as GordonEvent & { callCostUsd: number };
      deltas.push(evt.callCostUsd);
    });

    const tracker = new CostTracker("test-session-2");
    tracker.record({
      modelId: "claude-sonnet-4-5",
      inputTokens: 1000,
      outputTokens: 500,
    });
    tracker.record({
      modelId: "claude-sonnet-4-5",
      inputTokens: 200,
      outputTokens: 100,
    });

    await new Promise((r) => setImmediate(r));

    expect(deltas.length).toBe(2);
    // Each delta is positive and the second is smaller (fewer tokens).
    expect(deltas[0]).toBeGreaterThan(0);
    expect(deltas[1]).toBeGreaterThan(0);
    expect(deltas[1]).toBeLessThan(deltas[0]!);
    unsub();
  });

  it("fires once per record() call regardless of model identity", async () => {
    const events: GordonEvent[] = [];
    const unsub = getEventBus().on("cost:turn_delta", (e) => {
      events.push(e);
    });

    const tracker = new CostTracker("test-session-3");
    tracker.record({ modelId: "model-a", inputTokens: 10, outputTokens: 5 });
    tracker.record({ modelId: "model-b", inputTokens: 20, outputTokens: 10 });
    tracker.record({ modelId: "model-a", inputTokens: 30, outputTokens: 15 });

    await new Promise((r) => setImmediate(r));

    expect(events.length).toBe(3);
    const modelIds = events.map((e) => (e as GordonEvent & { modelId: string }).modelId);
    expect(modelIds).toEqual(["model-a", "model-b", "model-a"]);
    unsub();
  });
});
