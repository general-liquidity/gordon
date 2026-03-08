import { describe, expect, it } from "bun:test";

import {
  buildVisibleThreadPolicy,
  formatHiddenMessageNotice,
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
    expect(policy.hiddenCount).toBeGreaterThan(0);
    expect(formatHiddenMessageNotice(policy.hiddenCount, policy.visibleLimit)).toContain("showing last");
  });
});
