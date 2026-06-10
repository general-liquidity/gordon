import { describe, expect, it } from "bun:test";
import { RequestContext } from "@mastra/core/request-context";

import { withToolMetrics } from "./withMetrics.ts";

describe("withToolMetrics", () => {
  it("enforces runtime approvals at actual tool execution time", async () => {
    const requestContext = new RequestContext();
    requestContext.set("exchange", null);
    requestContext.set("broker", null);
    requestContext.set("llm", {});
    requestContext.set("config", { permissionMode: "ask" });
    requestContext.set("runtime", {
      runtimeId: "app",
      evaluateToolAccess: async () => ({
        status: "pending",
        reason: "Human approval required for place_order.",
        requestId: "req-123",
      }),
    });

    const tool = withToolMetrics({
      id: "place_order",
      execute: async () => ({ ok: true }),
    }) as {
      execute: (input: unknown, context: { requestContext: RequestContext }) => Promise<unknown>;
    };

    const result = await tool.execute({}, { requestContext });
    expect(result).toEqual({
      error: "Human approval required for place_order. Use /runtime-approve req-123 or /runtime-deny req-123.",
      approvalRequestId: "req-123",
      runtimeStatus: "pending",
      toolId: "place_order",
    });
  });
});
