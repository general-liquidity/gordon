import { describe, expect, it } from "bun:test";
import { completeFirstRunningCall } from "./toolCallTracking.ts";
import type { ToolCallState } from "../components/status/ToolCallInline.tsx";

describe("completeFirstRunningCall", () => {
  it("completes only the first running call for a tool", () => {
    const calls: ToolCallState[] = [
      { id: "1", toolName: "get_price", status: "running", startedAt: 10 },
      { id: "2", toolName: "get_price", status: "running", startedAt: 20 },
    ];
    const next = completeFirstRunningCall(calls, "get_price", { status: "success", duration: 5 });
    expect(next[0]?.status).toBe("success");
    expect(next[1]?.status).toBe("running");
  });

  it("returns the same reference when no running call matches", () => {
    const calls: ToolCallState[] = [
      { id: "1", toolName: "get_price", status: "success", startedAt: 10 },
    ];
    expect(completeFirstRunningCall(calls, "get_price", { status: "error" })).toBe(calls);
  });
});
