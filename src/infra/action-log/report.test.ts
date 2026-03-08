import { describe, expect, it } from "bun:test";

import {
  buildCompactionSummary,
  buildThreadSummaryReport,
  formatActionLogEntries,
} from "./report.ts";
import type { ActionLogEntry } from "./types.ts";
import type { ThreadInfo } from "../agents/threadManager.ts";

const SAMPLE_ENTRIES: ActionLogEntry[] = [
  {
    id: "entry-12345678",
    threadId: "thread-user-1",
    resourceId: "user-1",
    sessionId: "thread-user-1",
    entryType: "tool_call",
    title: "scan_market",
    content: "Started market scan for BTC and ETH",
    payload: {},
    bookmarked: false,
    createdAt: "2026-03-08T10:00:00.000Z",
  },
  {
    id: "entry-abcdef12",
    threadId: "thread-user-1",
    resourceId: "user-1",
    sessionId: "thread-user-1",
    entryType: "assistant_message",
    title: "Assistant response",
    content: "No high-confidence opportunities were found.",
    payload: {},
    bookmarked: true,
    createdAt: "2026-03-08T10:01:00.000Z",
  },
];

const SAMPLE_THREAD: ThreadInfo = {
  threadId: "thread-user-1",
  resourceId: "user-1",
  createdAt: "2026-03-08T09:00:00.000Z",
  clonedFrom: null,
  label: "Main Thread",
  messageCount: 12,
  lastActiveAt: "2026-03-08T10:01:00.000Z",
  isActive: true,
};

describe("action-log report formatting", () => {
  it("formats action-log entries as a markdown table", () => {
    const report = formatActionLogEntries(SAMPLE_ENTRIES, "Current thread action log");

    expect(report).toContain("Current thread action log");
    expect(report).toContain("| ID | Time | Type | Title |");
    expect(report).toContain("tool_call");
    expect(report).toContain("assistant_message");
  });

  it("builds a thread summary with counts and highlights", () => {
    const summary = buildThreadSummaryReport(SAMPLE_THREAD, SAMPLE_ENTRIES);

    expect(summary).toContain('Thread summary for "Main Thread"');
    expect(summary).toContain("Top activity types:");
    expect(summary).toContain("Recent highlights:");
  });

  it("builds a compaction summary from recent entries", () => {
    const summary = buildCompactionSummary(SAMPLE_ENTRIES, "Keep only decision-critical history.");

    expect(summary).toContain("Thread compaction summary");
    expect(summary).toContain("Operator note: Keep only decision-critical history.");
    expect(summary).toContain("[tool_call]");
  });
});
