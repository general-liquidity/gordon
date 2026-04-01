import { describe, expect, it } from "bun:test";

import { checkToolSecurity } from "../orchestrator.ts";

describe("checkToolSecurity", () => {
  it("surfaces pending runtime approvals in the main tool gate", async () => {
    const result = await checkToolSecurity(
      "Analyst",
      "get_price",
      {
        userId: "user-1",
        config: {
          mode: "SAFE",
          armedUntil: null,
        },
        runtime: {
          runtimeId: "app",
          evaluateToolAccess: async () => ({
            status: "pending",
            reason: "Human approval required for get_price.",
            requestId: "req-123",
          }),
        },
      } as any,
    );

    expect(result.allowed).toBe(false);
    expect(result.approvalRequestId).toBe("req-123");
    expect(result.error).toContain("/runtime-approve req-123");
  });

  it("blocks immediately when runtime access denies the tool", async () => {
    const result = await checkToolSecurity(
      "Analyst",
      "get_price",
      {
        userId: "user-1",
        config: {
          mode: "SAFE",
          armedUntil: null,
        },
        runtime: {
          runtimeId: "app",
          evaluateToolAccess: async () => ({
            status: "blocked",
            reason: "Runtime policy blocked market reads for this session.",
          }),
        },
      } as any,
    );

    expect(result.allowed).toBe(false);
    expect(result.error).toContain("Runtime policy blocked market reads for this session.");
    expect(result.approvalRequestId).toBeUndefined();
  });
});
