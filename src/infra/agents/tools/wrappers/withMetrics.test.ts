import { afterEach, describe, expect, it } from "bun:test";
import { RequestContext } from "@mastra/core/request-context";
import { z } from "zod";

import { withToolMetrics } from "./withMetrics.ts";
import { clearHooks, registerHook } from "../../../hooks/engine.ts";

afterEach(() => clearHooks());

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
      error:
        "Human approval required for place_order. Use /runtime-approve req-123 or /runtime-deny req-123.",
      approvalRequestId: "req-123",
      runtimeStatus: "pending",
      toolId: "place_order",
    });
  });

  it("runs PreToolUse before execution and threads modified arguments", async () => {
    let received: unknown;
    registerHook({
      id: "cap-quantity",
      point: "PreToolUse",
      handler: (payload) => ({
        action: "modify",
        replacement: { args: { ...(payload.args as object), qty: 1 } },
      }),
    });
    const tool = withToolMetrics({
      id: "test_tool",
      execute: async (input: unknown) => {
        received = input;
        return { ok: true };
      },
    }) as { execute: (input: unknown) => Promise<unknown> };
    await tool.execute({ qty: 10 });
    expect(received).toEqual({ qty: 1 });
  });

  it("re-validates arguments modified by PreToolUse before calling the body", async () => {
    let calls = 0;
    registerHook({
      id: "break-schema",
      point: "PreToolUse",
      handler: () => ({ action: "modify", replacement: { args: { qty: -1 } } }),
    });
    const tool = withToolMetrics({
      id: "sized_tool",
      inputSchema: z.object({ qty: z.number().positive() }),
      execute: async () => {
        calls += 1;
        return { ok: true };
      },
    }) as { execute: (input: unknown) => Promise<unknown> };

    expect(await tool.execute({ qty: 2 })).toMatchObject({
      runtimeStatus: "blocked",
      toolId: "sized_tool",
    });
    expect(calls).toBe(0);
  });

  it("blocks before the tool body and lets PostToolUse transform results", async () => {
    let calls = 0;
    const tool = withToolMetrics({
      id: "test_tool",
      execute: async () => {
        calls += 1;
        return { raw: true };
      },
    }) as { execute: (input: unknown) => Promise<unknown> };

    registerHook({
      id: "deny",
      point: "PreToolUse",
      handler: () => ({ action: "block", reason: "policy" }),
    });
    expect(await tool.execute({})).toMatchObject({ runtimeStatus: "blocked" });
    expect(calls).toBe(0);

    clearHooks();
    registerHook({
      id: "redact",
      point: "PostToolUse",
      handler: () => ({ action: "modify", replacement: { result: { redacted: true } } }),
    });
    expect(await tool.execute({})).toEqual({ redacted: true });
    expect(calls).toBe(1);
  });

  it("emits PostToolUse with success=false when the tool body throws", async () => {
    let observed: { success: boolean; result: unknown } | undefined;
    registerHook({
      id: "audit-failure",
      point: "PostToolUse",
      handler: (payload) => {
        observed = { success: payload.success, result: payload.result };
        return { action: "allow" };
      },
    });
    const tool = withToolMetrics({
      id: "throwing_tool",
      execute: async () => {
        throw new Error("body failed");
      },
    }) as { execute: (input: unknown) => Promise<unknown> };

    await expect(tool.execute({})).rejects.toThrow("body failed");
    expect(observed?.success).toBe(false);
    expect(observed?.result).toEqual({ error: "body failed" });
  });
});
