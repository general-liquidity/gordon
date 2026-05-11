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

describe("CostTracker — snapshot cacheRead visibility", () => {
  beforeEach(() => {
    resetCostBudgetState();
  });

  it("aggregates cacheReadTokens and cacheWriteTokens across models", () => {
    const tracker = new CostTracker("test-cache-1");
    tracker.record({
      modelId: "claude-sonnet-4-5",
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 1000,
      cacheWriteTokens: 200,
    });
    tracker.record({
      modelId: "claude-opus-4-6",
      inputTokens: 50,
      outputTokens: 25,
      cacheReadTokens: 500,
      cacheWriteTokens: 100,
    });

    const snap = tracker.snapshot();
    expect(snap.totalCacheReadTokens).toBe(1500);
    expect(snap.totalCacheWriteTokens).toBe(300);
    expect(snap.totalInputTokens).toBe(150);
    expect(snap.totalOutputTokens).toBe(75);
  });

  it("computes cacheReadPercentage against the grand total", () => {
    const tracker = new CostTracker("test-cache-2");
    // 100 input + 50 output + 850 cacheRead + 0 cacheWrite = 1000 total
    // cacheReadPct = 850 / 1000 = 0.85
    tracker.record({
      modelId: "claude-sonnet-4-5",
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 850,
      cacheWriteTokens: 0,
    });
    const snap = tracker.snapshot();
    expect(snap.cacheReadPercentage).toBeCloseTo(0.85, 4);
  });

  it("cacheReadPercentage is 0 when no tokens recorded", () => {
    const tracker = new CostTracker("test-cache-3");
    const snap = tracker.snapshot();
    expect(snap.cacheReadPercentage).toBe(0);
    expect(snap.totalCacheReadTokens).toBe(0);
  });

  it("formatDisplay shows cacheRead line when cacheRead > 0", () => {
    const tracker = new CostTracker("test-cache-4");
    tracker.record({
      modelId: "claude-sonnet-4-5",
      displayName: "Sonnet 4.5",
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 50,
      cacheWriteTokens: 0,
    });
    const output = tracker.formatDisplay();
    expect(output).toContain("cacheRead:");
    expect(output).toContain("50");
  });

  it("formatDisplay flags >=70% cacheRead as context-bloat suspected", () => {
    const tracker = new CostTracker("test-cache-5");
    // 100 input + 50 output + 850 cacheRead = 1000 total, 85% cacheRead
    tracker.record({
      modelId: "claude-sonnet-4-5",
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 850,
      cacheWriteTokens: 0,
    });
    const output = tracker.formatDisplay();
    expect(output).toContain("context-bloat suspected");
  });

  it("formatDisplay flags 50-70% cacheRead as cache-heavy", () => {
    const tracker = new CostTracker("test-cache-6");
    // 100 input + 50 output + 350 cacheRead = 500 total, 70% cacheRead
    // Actually that's exactly 70%, push slightly under
    // 100 + 50 + 300 = 450, 300/450 = 66.7%
    tracker.record({
      modelId: "claude-sonnet-4-5",
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 300,
      cacheWriteTokens: 0,
    });
    const output = tracker.formatDisplay();
    expect(output).toContain("(cache-heavy)");
    expect(output).not.toContain("context-bloat suspected");
  });

  it("formatDisplay omits cacheRead line when cacheRead is 0", () => {
    const tracker = new CostTracker("test-cache-7");
    tracker.record({
      modelId: "claude-sonnet-4-5",
      inputTokens: 100,
      outputTokens: 50,
    });
    const output = tracker.formatDisplay();
    expect(output).not.toContain("cacheRead:");
  });
});
