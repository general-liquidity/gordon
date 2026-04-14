import { describe, expect, it } from "bun:test";

import { checkToolSecurity } from "../orchestrator.ts";

describe("checkToolSecurity", () => {
  it("keeps static preflight decoupled from runtime approval state", async () => {
    const result = await checkToolSecurity(
      "Analyst",
      "get_price",
      {
        userId: "user-1",
        config: {
          permissionMode: "ask",
          
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

    expect(result.allowed).toBe(true);
    expect(result.approvalRequestId).toBeUndefined();
    expect(result.error).toBeUndefined();
  });

  it("still blocks static execution tools in SAFE mode", async () => {
    const result = await checkToolSecurity(
      "Executor",
      "execute_plan",
      {
        userId: "user-1",
        config: {
          permissionMode: "strict",
        },
      } as any,
    );

    expect(result.allowed).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.approvalRequestId).toBeUndefined();
  });
});
