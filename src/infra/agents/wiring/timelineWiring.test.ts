import { describe, it, expect, beforeEach } from "bun:test";
import {
  withTimelineEntry,
  generateTimelineAgentId,
  reportTimelineProgress,
  estimateTokensFromMessages,
} from "./timelineWiring.ts";
import {
  captureContextTimeline,
  resetContextTimeline,
} from "../contextTimeline.ts";

beforeEach(() => {
  resetContextTimeline();
});

describe("withTimelineEntry", () => {
  it("registers + ends the agent around the wrapped work", async () => {
    const result = await withTimelineEntry(
      { agentId: "a1", agentName: "test", agentType: "investigation", initialTokens: 100 },
      async () => "synthesis text",
    );
    expect(result).toBe("synthesis text");
    const snap = captureContextTimeline();
    expect(snap.agents.length).toBe(1);
    expect(snap.agents[0]!.isActive).toBe(false);
    expect(snap.agents[0]!.agentName).toBe("test");
    expect(snap.agents[0]!.contextTokenEstimate).toBe(100);
  });

  it("marks agent as ended even when work throws", async () => {
    await expect(
      withTimelineEntry(
        { agentId: "a1", agentName: "fails", agentType: "investigation" },
        async () => {
          throw new Error("boom");
        },
      ),
    ).rejects.toThrow("boom");
    const snap = captureContextTimeline();
    expect(snap.agents.length).toBe(1);
    expect(snap.agents[0]!.isActive).toBe(false);
    expect(snap.agents[0]!.endedAt).toBeDefined();
  });

  it("threads parentAgentId through", async () => {
    await withTimelineEntry(
      { agentId: "p", agentName: "parent", agentType: "main" },
      async () =>
        withTimelineEntry(
          {
            agentId: "c",
            agentName: "child",
            agentType: "investigation",
            parentAgentId: "p",
          },
          async () => "x",
        ),
    );
    const snap = captureContextTimeline();
    const child = snap.agents.find((a) => a.agentId === "c")!;
    expect(child.parentAgentId).toBe("p");
  });
});

describe("generateTimelineAgentId", () => {
  it("includes the base + a unique suffix", () => {
    const id = generateTimelineAgentId("test");
    expect(id.startsWith("test-")).toBe(true);
    expect(id.length).toBeGreaterThan("test-".length);
  });

  it("produces different ids on repeated calls", () => {
    const ids = new Set([
      generateTimelineAgentId("a"),
      generateTimelineAgentId("a"),
      generateTimelineAgentId("a"),
    ]);
    expect(ids.size).toBeGreaterThanOrEqual(2); // probabilistic; should be 3
  });
});

describe("reportTimelineProgress", () => {
  it("updates token estimate + tool count mid-run", async () => {
    await withTimelineEntry(
      { agentId: "p", agentName: "progress-test", agentType: "investigation" },
      async () => {
        reportTimelineProgress("p", { tokenEstimate: 500, toolCallCount: 3 });
        const snap = captureContextTimeline();
        expect(snap.agents[0]!.contextTokenEstimate).toBe(500);
        expect(snap.agents[0]!.toolCallCount).toBe(3);
      },
    );
  });

  it("re-exports estimateTokensFromMessages", () => {
    expect(estimateTokensFromMessages([{ content: "hello" }])).toBe(2);
  });
});
