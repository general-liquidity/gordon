import { describe, expect, it } from "bun:test";

import {
  buildVisibleThreadPolicy,
  formatHiddenMessageNotice,
  formatHiddenNewerNotice,
  getVisibleMessageLimit,
} from "./threadDensity.ts";

describe("thread density policy", () => {
  it("keeps a denser window when the app is idle", () => {
    const messages = Array.from({ length: 90 }, (_, index) => ({ content: `message-${index}` }));
    const limit = getVisibleMessageLimit({
      messages,
      isStreaming: false,
      hasTaskTree: false,
      hasBackgroundTasks: false,
    });

    expect(limit).toBeGreaterThanOrEqual(90);
  });

  it("shrinks the window under active streaming and heavy recent content", () => {
    const messages = Array.from({ length: 120 }, () => ({ content: "x".repeat(500) }));
    const policy = buildVisibleThreadPolicy({
      messages,
      isStreaming: true,
      hasTaskTree: true,
      hasBackgroundTasks: true,
    });

    expect(policy.visibleLimit).toBeLessThan(90);
    expect(policy.hiddenBefore).toBeGreaterThan(0);
    expect(formatHiddenMessageNotice(policy.hiddenBefore, policy.visibleLimit)).toContain("showing last");
  });

  it("supports reader offsets without losing pinned-bottom semantics", () => {
    const messages = Array.from({ length: 220 }, (_, index) => ({ content: `message-${index}` }));
    const idleLimit = getVisibleMessageLimit({
      messages,
      isStreaming: false,
      hasTaskTree: false,
      hasBackgroundTasks: false,
    });
    const policy = buildVisibleThreadPolicy({
      messages,
      isStreaming: false,
      hasTaskTree: false,
      hasBackgroundTasks: false,
      bottomOffset: 12,
    });

    expect(policy.visibleLimit).toBe(idleLimit);
    expect(policy.bottomOffset).toBe(12);
    expect(policy.hiddenAfter).toBe(12);
    expect(policy.isPinnedBottom).toBe(false);
    expect(policy.endIndex).toBe(messages.length - 12);
    expect(policy.startIndex).toBe(Math.max(0, policy.endIndex - idleLimit));
    expect(formatHiddenNewerNotice(policy.hiddenAfter)).toContain("newer messages below");
  });
});
