import { describe, it, expect, beforeEach } from "bun:test";
import {
  recordAgentStart,
  recordAgentEnd,
  recordAgentProgress,
  captureContextTimeline,
  resetContextTimeline,
  estimateTokensFromChars,
  estimateTokensFromMessages,
  formatContextTimeline,
} from "./contextTimeline.ts";

beforeEach(() => {
  resetContextTimeline();
});

describe("estimateTokensFromChars + estimateTokensFromMessages", () => {
  it("rough chars/4 heuristic", () => {
    expect(estimateTokensFromChars(0)).toBe(0);
    expect(estimateTokensFromChars(4)).toBe(1);
    expect(estimateTokensFromChars(100)).toBe(25);
  });

  it("estimates tokens across an array of messages", () => {
    expect(
      estimateTokensFromMessages([
        { content: "1234" }, // 4 chars
        { content: "12345678" }, // 8 chars
      ]),
    ).toBe(3); // 12 chars / 4 = 3
  });

  it("handles empty input", () => {
    expect(estimateTokensFromMessages([])).toBe(0);
  });
});

describe("recordAgentStart", () => {
  it("registers a new agent", () => {
    recordAgentStart({
      agentId: "a1",
      agentName: "main",
      agentType: "main",
      contextTokenEstimate: 1000,
    });
    const snap = captureContextTimeline();
    expect(snap.agents.length).toBe(1);
    expect(snap.agents[0]!.agentName).toBe("main");
    expect(snap.agents[0]!.isActive).toBe(true);
    expect(snap.agents[0]!.contextTokenEstimate).toBe(1000);
    expect(snap.activeCount).toBe(1);
  });

  it("is idempotent on agentId (updates existing)", () => {
    recordAgentStart({
      agentId: "a1",
      agentName: "main",
      agentType: "main",
      contextTokenEstimate: 500,
    });
    recordAgentStart({
      agentId: "a1",
      agentName: "main",
      agentType: "main",
      contextTokenEstimate: 1200,
    });
    const snap = captureContextTimeline();
    expect(snap.agents.length).toBe(1);
    expect(snap.agents[0]!.contextTokenEstimate).toBe(1200);
  });

  it("preserves insertion order across multiple agents", () => {
    recordAgentStart({ agentId: "a", agentName: "first", agentType: "main", contextTokenEstimate: 100 });
    recordAgentStart({ agentId: "b", agentName: "second", agentType: "investigation", contextTokenEstimate: 100 });
    recordAgentStart({ agentId: "c", agentName: "third", agentType: "fork", contextTokenEstimate: 100 });
    const snap = captureContextTimeline();
    expect(snap.agents.map((a) => a.agentName)).toEqual(["first", "second", "third"]);
  });

  it("records parent agent id when supplied", () => {
    recordAgentStart({ agentId: "parent", agentName: "main", agentType: "main", contextTokenEstimate: 1000 });
    recordAgentStart({
      agentId: "child",
      agentName: "inv",
      agentType: "investigation",
      contextTokenEstimate: 200,
      parentAgentId: "parent",
    });
    const snap = captureContextTimeline();
    const child = snap.agents.find((a) => a.agentId === "child")!;
    expect(child.parentAgentId).toBe("parent");
  });
});

describe("recordAgentEnd", () => {
  it("marks an active agent as completed", () => {
    recordAgentStart({ agentId: "a", agentName: "x", agentType: "main", contextTokenEstimate: 100 });
    recordAgentEnd("a");
    const snap = captureContextTimeline();
    expect(snap.agents[0]!.isActive).toBe(false);
    expect(snap.agents[0]!.endedAt).toBeDefined();
    expect(snap.activeCount).toBe(0);
  });

  it("is idempotent (calling end twice is a no-op)", () => {
    recordAgentStart({ agentId: "a", agentName: "x", agentType: "main", contextTokenEstimate: 100 });
    recordAgentEnd("a");
    const firstSnap = captureContextTimeline();
    const firstEnd = firstSnap.agents[0]!.endedAt;
    recordAgentEnd("a");
    const secondSnap = captureContextTimeline();
    expect(secondSnap.agents[0]!.endedAt).toBe(firstEnd!);
  });

  it("ignores unknown agent ids", () => {
    expect(() => recordAgentEnd("nonexistent")).not.toThrow();
    const snap = captureContextTimeline();
    expect(snap.agents.length).toBe(0);
  });
});

describe("recordAgentProgress", () => {
  it("updates token estimate", () => {
    recordAgentStart({ agentId: "a", agentName: "x", agentType: "main", contextTokenEstimate: 100 });
    recordAgentProgress("a", { contextTokenEstimate: 500 });
    const snap = captureContextTimeline();
    expect(snap.agents[0]!.contextTokenEstimate).toBe(500);
  });

  it("updates tool call count", () => {
    recordAgentStart({ agentId: "a", agentName: "x", agentType: "main", contextTokenEstimate: 100 });
    recordAgentProgress("a", { toolCallCount: 7 });
    const snap = captureContextTimeline();
    expect(snap.agents[0]!.toolCallCount).toBe(7);
  });

  it("is a no-op for unknown agent id", () => {
    expect(() => recordAgentProgress("nope", { toolCallCount: 5 })).not.toThrow();
  });
});

describe("captureContextTimeline", () => {
  it("rolls up active + total + largest", () => {
    recordAgentStart({ agentId: "main", agentName: "Main", agentType: "main", contextTokenEstimate: 1000 });
    recordAgentStart({ agentId: "inv1", agentName: "Inv1", agentType: "investigation", contextTokenEstimate: 200 });
    recordAgentStart({ agentId: "inv2", agentName: "Inv2", agentType: "investigation", contextTokenEstimate: 5000 });
    recordAgentEnd("inv1");

    const snap = captureContextTimeline();
    expect(snap.activeCount).toBe(2);
    expect(snap.totalActiveContextTokens).toBe(1000 + 5000);
    expect(snap.largestContext!.agentId).toBe("inv2");
  });

  it("rolls up by type", () => {
    recordAgentStart({ agentId: "1", agentName: "a", agentType: "main", contextTokenEstimate: 1 });
    recordAgentStart({ agentId: "2", agentName: "b", agentType: "investigation", contextTokenEstimate: 1 });
    recordAgentStart({ agentId: "3", agentName: "c", agentType: "investigation", contextTokenEstimate: 1 });
    recordAgentStart({ agentId: "4", agentName: "d", agentType: "fork", contextTokenEstimate: 1 });

    const snap = captureContextTimeline();
    expect(snap.byType.main).toBe(1);
    expect(snap.byType.investigation).toBe(2);
    expect(snap.byType.fork).toBe(1);
    expect(snap.byType.thinking).toBe(0);
  });

  it("returns null largestContext when no agents active", () => {
    const snap = captureContextTimeline();
    expect(snap.largestContext).toBeNull();
    expect(snap.activeCount).toBe(0);
  });

  it("returned snapshot is a shallow copy (callers cannot mutate registry)", () => {
    recordAgentStart({ agentId: "a", agentName: "x", agentType: "main", contextTokenEstimate: 100 });
    const snap1 = captureContextTimeline();
    snap1.agents[0]!.contextTokenEstimate = 99999;
    const snap2 = captureContextTimeline();
    expect(snap2.agents[0]!.contextTokenEstimate).toBe(100);
  });
});

describe("resetContextTimeline", () => {
  it("clears all recorded agents", () => {
    recordAgentStart({ agentId: "a", agentName: "x", agentType: "main", contextTokenEstimate: 1 });
    recordAgentStart({ agentId: "b", agentName: "y", agentType: "main", contextTokenEstimate: 1 });
    resetContextTimeline();
    const snap = captureContextTimeline();
    expect(snap.agents.length).toBe(0);
  });
});

describe("formatContextTimeline", () => {
  it("renders empty case cleanly", () => {
    const text = formatContextTimeline(captureContextTimeline());
    expect(text).toContain("(no agents recorded)");
  });

  it("renders headers + per-agent lines", () => {
    recordAgentStart({ agentId: "main", agentName: "Main", agentType: "main", contextTokenEstimate: 1000 });
    recordAgentStart({ agentId: "inv", agentName: "Investigation", agentType: "investigation", contextTokenEstimate: 200, parentAgentId: "main" });
    const text = formatContextTimeline(captureContextTimeline());
    expect(text).toContain("Context Timeline");
    expect(text).toContain("Main");
    expect(text).toContain("Investigation");
    expect(text).toContain("parent: main");
  });

  it("shows status markers for active vs completed", () => {
    recordAgentStart({ agentId: "a", agentName: "Active", agentType: "main", contextTokenEstimate: 100 });
    recordAgentStart({ agentId: "b", agentName: "Done", agentType: "main", contextTokenEstimate: 100 });
    recordAgentEnd("b");
    const text = formatContextTimeline(captureContextTimeline());
    // Active uses ●, completed uses ○
    expect(text).toContain("●");
    expect(text).toContain("○");
  });
});
