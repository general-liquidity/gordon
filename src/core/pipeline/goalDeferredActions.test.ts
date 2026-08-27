import { describe, it, expect } from "bun:test";
import {
  buildDeferredAction,
  filterDeferredActions,
  serializeForJsonl,
  parseFromJsonl,
  deferredActionToPayload,
  isGoalDeferredActionsEnabled,
  GOAL_DEFERRED_ACTIONS_FLAG_ENV,
  type DeferredAction,
} from "./goalDeferredActions.ts";

describe("isGoalDeferredActionsEnabled", () => {
  it("respects the flag", () => {
    expect(isGoalDeferredActionsEnabled({})).toBe(false);
    expect(isGoalDeferredActionsEnabled({ [GOAL_DEFERRED_ACTIONS_FLAG_ENV]: "1" })).toBe(true);
  });
});

describe("buildDeferredAction — validation", () => {
  it("rejects empty goalId", () => {
    expect(() =>
      buildDeferredAction({
        goalId: "",
        action: "longer action",
        rationale: "longer rationale",
      }),
    ).toThrow();
  });

  it("rejects too-short action", () => {
    expect(() =>
      buildDeferredAction({
        goalId: "g1",
        action: "no",
        rationale: "longer rationale",
      }),
    ).toThrow();
  });

  it("rejects too-short rationale", () => {
    expect(() =>
      buildDeferredAction({
        goalId: "g1",
        action: "longer action",
        rationale: "no",
      }),
    ).toThrow();
  });

  it("rejects invalid timestamp", () => {
    expect(() =>
      buildDeferredAction({
        goalId: "g1",
        action: "longer action",
        rationale: "longer rationale",
        recordedAt: "not-a-date",
      }),
    ).toThrow();
  });
});

describe("buildDeferredAction — defaults", () => {
  it("defaults category to 'other'", () => {
    const r = buildDeferredAction({
      goalId: "g1",
      action: "longer action",
      rationale: "longer rationale",
    });
    expect(r.category).toBe("other");
  });

  it("defaults recordedAt to now-ish", () => {
    const r = buildDeferredAction({
      goalId: "g1",
      action: "longer action",
      rationale: "longer rationale",
    });
    expect(Number.isNaN(Date.parse(r.recordedAt))).toBe(false);
  });

  it("omits tags when empty", () => {
    const r = buildDeferredAction({
      goalId: "g1",
      action: "longer action",
      rationale: "longer rationale",
    });
    expect(r.tags).toBeUndefined();
  });

  it("preserves non-empty tags", () => {
    const r = buildDeferredAction({
      goalId: "g1",
      action: "longer action",
      rationale: "longer rationale",
      tags: ["a", "b"],
    });
    expect(r.tags).toEqual(["a", "b"]);
  });
});

describe("filterDeferredActions", () => {
  const ts = (h: number) => new Date(2026, 0, 1, h).toISOString();
  const actions: DeferredAction[] = [
    {
      goalId: "g1",
      action: "do thing one",
      rationale: "reason A",
      category: "feature",
      recordedAt: ts(0),
      tags: ["alpha"],
    },
    {
      goalId: "g1",
      action: "do thing two",
      rationale: "reason B",
      category: "investigation",
      recordedAt: ts(1),
    },
    {
      goalId: "g2",
      action: "do thing three",
      rationale: "reason C",
      category: "feature",
      recordedAt: ts(2),
      tags: ["alpha", "beta"],
    },
  ];

  it("filters by goalId", () => {
    const r = filterDeferredActions(actions, { goalId: "g1" });
    expect(r.length).toBe(2);
  });

  it("filters by category", () => {
    const r = filterDeferredActions(actions, { category: "feature" });
    expect(r.length).toBe(2);
  });

  it("filters by sinceMs", () => {
    const r = filterDeferredActions(actions, {
      sinceMs: Date.parse(ts(1)),
    });
    expect(r.length).toBe(2);
  });

  it("filters by untilMs", () => {
    const r = filterDeferredActions(actions, {
      untilMs: Date.parse(ts(0)),
    });
    expect(r.length).toBe(1);
  });

  it("filters by anyTag", () => {
    const r = filterDeferredActions(actions, { anyTag: ["beta"] });
    expect(r.length).toBe(1);
    expect(r[0]!.goalId).toBe("g2");
  });

  it("multi-filter AND semantics", () => {
    const r = filterDeferredActions(actions, {
      goalId: "g1",
      category: "feature",
    });
    expect(r.length).toBe(1);
    expect(r[0]!.action).toBe("do thing one");
  });

  it("empty filter returns all", () => {
    expect(filterDeferredActions(actions, {}).length).toBe(3);
  });
});

describe("JSONL round-trip", () => {
  it("serialize → parse preserves the record", () => {
    const original = buildDeferredAction({
      goalId: "g1",
      action: "investigate stale cache",
      rationale: "would help reduce latency",
      category: "investigation",
      tags: ["perf", "infra"],
    });
    const line = serializeForJsonl(original);
    const parsed = parseFromJsonl(line);
    expect(parsed.goalId).toBe(original.goalId);
    expect(parsed.action).toBe(original.action);
    expect(parsed.rationale).toBe(original.rationale);
    expect(parsed.category).toBe(original.category);
    expect(parsed.tags).toEqual(original.tags);
    expect(parsed.recordedAt).toBe(original.recordedAt);
  });

  it("parseFromJsonl re-validates structure", () => {
    // Missing rationale → should fail in build path
    const badLine = JSON.stringify({
      goalId: "g1",
      action: "longer action",
      rationale: "",
      category: "other",
      recordedAt: new Date().toISOString(),
    });
    expect(() => parseFromJsonl(badLine)).toThrow();
  });
});

describe("deferredActionToPayload", () => {
  it("emits stable shape with action preview", () => {
    const a = buildDeferredAction({
      goalId: "g1",
      action: "do a longer action".repeat(20),
      rationale: "long enough rationale",
      category: "feature",
    });
    const p = deferredActionToPayload(a) as {
      kind: string;
      goalId: string;
      actionPreview: string;
    };
    expect(p.kind).toBe("goal_deferred_action.recorded");
    expect(p.goalId).toBe("g1");
    expect(p.actionPreview.length).toBeLessThanOrEqual(80);
    expect(p.actionPreview.endsWith("...")).toBe(true);
  });
});
