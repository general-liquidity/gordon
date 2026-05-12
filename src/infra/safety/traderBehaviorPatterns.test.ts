import { describe, expect, it } from "bun:test";

import {
  isTraderBehaviorEnabled,
  _detectPatternsForTest,
} from "./traderBehaviorPatterns.ts";
import type { ActionLogEntry } from "../action-log/types.ts";

function entry(
  overrides: Partial<ActionLogEntry> & Pick<ActionLogEntry, "entryType" | "title">,
): ActionLogEntry {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    entryType: overrides.entryType,
    title: overrides.title,
    content: overrides.content ?? "",
    payload: overrides.payload ?? {},
    bookmarked: overrides.bookmarked ?? false,
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    threadId: overrides.threadId,
    sessionId: overrides.sessionId,
  };
}

describe("isTraderBehaviorEnabled", () => {
  it("respects the flag", () => {
    expect(isTraderBehaviorEnabled({})).toBe(false);
    expect(isTraderBehaviorEnabled({ GORDON_TRADER_BEHAVIOR_PATTERNS: "1" })).toBe(true);
    expect(isTraderBehaviorEnabled({ GORDON_TRADER_BEHAVIOR_PATTERNS: "true" })).toBe(true);
  });
});

describe("detectStopReversal", () => {
  it("surfaces when >=3 cancels mention stop-reversal language", () => {
    const entries: ActionLogEntry[] = [
      entry({
        entryType: "execution_result",
        title: "cancel",
        payload: { kind: "cancel", rationale: "moved stop wider for breathing room" },
      }),
      entry({
        entryType: "execution_result",
        title: "cancel",
        payload: { kind: "cancel", rationale: "changed my mind, want to keep it running" },
      }),
      entry({
        entryType: "execution_result",
        title: "cancel",
        payload: { kind: "cancel", rationale: "gave it room — widened the stop" },
      }),
    ];
    const patterns = _detectPatternsForTest(entries);
    const found = patterns.find((p) => p.kind === "frequent_stop_reversal");
    expect(found).toBeDefined();
    expect(found?.evidenceCount).toBe(3);
    expect(found?.severity).toBeGreaterThan(0);
    expect(found?.headline).toContain("stop-loss reversal");
  });

  it("does not surface below the threshold", () => {
    const entries: ActionLogEntry[] = [
      entry({
        entryType: "execution_result",
        title: "cancel",
        payload: { kind: "cancel", rationale: "moved stop wider" },
      }),
      entry({
        entryType: "execution_result",
        title: "cancel",
        payload: { kind: "cancel", rationale: "changed my mind" },
      }),
    ];
    const patterns = _detectPatternsForTest(entries);
    expect(patterns.find((p) => p.kind === "frequent_stop_reversal")).toBeUndefined();
  });
});

describe("detectMandateOverride", () => {
  it("surfaces when >=3 strategy-mandate-violation blocks appear", () => {
    const entries: ActionLogEntry[] = [
      entry({ entryType: "execution_result", title: "Execution blocked: strategy_mandate_violation" }),
      entry({ entryType: "execution_attempt", title: "blocked", content: "strategy mandate violated" }),
      entry({ entryType: "execution_result", title: "strategy mandate violation occurred" }),
    ];
    const patterns = _detectPatternsForTest(entries);
    const found = patterns.find((p) => p.kind === "frequent_mandate_override");
    expect(found).toBeDefined();
    expect(found?.evidenceCount).toBe(3);
  });
});

describe("detectCancelRecurrence", () => {
  it("surfaces the top recurring cancel theme", () => {
    // The bucket algorithm uses the first 3 significant words (>2 chars)
    // of the rationale, so test fixtures must share that prefix.
    const entries: ActionLogEntry[] = [
      entry({
        entryType: "execution_result",
        title: "cancel",
        payload: { kind: "cancel", rationale: "wrong size again going to retry" },
      }),
      entry({
        entryType: "execution_result",
        title: "cancel",
        payload: { kind: "cancel", rationale: "wrong size again - too big" },
      }),
      entry({
        entryType: "execution_result",
        title: "cancel",
        payload: { kind: "cancel", rationale: "wrong size again for this regime" },
      }),
      entry({
        entryType: "execution_result",
        title: "cancel",
        payload: { kind: "cancel", rationale: "some other unrelated reason here" },
      }),
    ];
    const patterns = _detectPatternsForTest(entries);
    const found = patterns.find((p) => p.kind === "cancel_recurrence_theme");
    expect(found).toBeDefined();
    expect(found?.headline).toContain("wrong size again");
  });

  it("requires at least 3 cancellations in the bucket", () => {
    const entries: ActionLogEntry[] = [
      entry({
        entryType: "execution_result",
        title: "cancel",
        payload: { kind: "cancel", rationale: "wrong size" },
      }),
      entry({
        entryType: "execution_result",
        title: "cancel",
        payload: { kind: "cancel", rationale: "wrong size again" },
      }),
    ];
    const patterns = _detectPatternsForTest(entries);
    expect(patterns.find((p) => p.kind === "cancel_recurrence_theme")).toBeUndefined();
  });
});

describe("detectThesisDrift", () => {
  it("surfaces when many plan events accumulate since the last thesis update", () => {
    const now = Date.now();
    const oldThesisTs = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
    const entries: ActionLogEntry[] = [
      entry({
        entryType: "custom",
        title: "execution.thesis_set",
        createdAt: oldThesisTs,
      }),
    ];
    for (let i = 0; i < 12; i++) {
      entries.push(
        entry({
          entryType: "execution_result",
          title: "executed",
          createdAt: new Date(now - i * 60_000).toISOString(),
        }),
      );
    }
    const patterns = _detectPatternsForTest(entries);
    const found = patterns.find((p) => p.kind === "thesis_drift_no_match");
    expect(found).toBeDefined();
    expect(found?.evidenceCount).toBeGreaterThanOrEqual(10);
  });

  it("does not surface without a prior thesis event", () => {
    const entries: ActionLogEntry[] = [];
    for (let i = 0; i < 12; i++) {
      entries.push(entry({ entryType: "execution_result", title: "executed" }));
    }
    const patterns = _detectPatternsForTest(entries);
    expect(patterns.find((p) => p.kind === "thesis_drift_no_match")).toBeUndefined();
  });
});

describe("severity ordering", () => {
  it("sorts patterns by severity descending", () => {
    const entries: ActionLogEntry[] = [];
    // 5 stop reversals → higher severity
    for (let i = 0; i < 5; i++) {
      entries.push(
        entry({
          entryType: "execution_result",
          title: "cancel",
          payload: { kind: "cancel", rationale: "moved stop wider" },
        }),
      );
    }
    // 3 mandate violations → lower severity
    for (let i = 0; i < 3; i++) {
      entries.push(
        entry({
          entryType: "execution_result",
          title: "Execution blocked: strategy_mandate_violation",
        }),
      );
    }
    const patterns = _detectPatternsForTest(entries);
    expect(patterns.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < patterns.length; i++) {
      expect(patterns[i - 1]!.severity).toBeGreaterThanOrEqual(patterns[i]!.severity);
    }
  });
});
