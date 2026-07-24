import { describe, it, expect, beforeEach } from "bun:test";
import { z } from "zod";

import {
  validateStructuredOutput,
  createPostToolOutputSchemaHook,
  createPreToolInputSchemaHook,
} from "./structuredOutputEnforcement.ts";
import { registerHook, runHooks, clearHooks } from "./engine.ts";

beforeEach(() => {
  clearHooks();
});

const planSchema = z.object({
  symbol: z.string().min(1),
  side: z.enum(["buy", "sell"]),
  notionalUsd: z.number().positive(),
});

describe("validateStructuredOutput", () => {
  it("ok=true on valid input", () => {
    const r = validateStructuredOutput(
      { symbol: "BTC", side: "buy", notionalUsd: 1000 },
      planSchema,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.symbol).toBe("BTC");
  });

  it("ok=false on missing required field", () => {
    const r = validateStructuredOutput({ symbol: "BTC" }, planSchema);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.length).toBeGreaterThan(0);
      expect(r.reprompt).toContain("schema");
    }
  });

  it("ok=false on wrong type", () => {
    const r = validateStructuredOutput(
      { symbol: "BTC", side: "hold", notionalUsd: 1000 },
      planSchema,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.some((i) => i.includes("side"))).toBe(true);
    }
  });

  it("includes tool name in reprompt when provided", () => {
    const r = validateStructuredOutput({}, planSchema, {
      toolName: "build_plan",
    });
    if (!r.ok) {
      expect(r.reprompt).toContain("build_plan");
    } else {
      throw new Error("expected validation to fail");
    }
  });
});

describe("createPostToolOutputSchemaHook", () => {
  it("allows when result matches schema", async () => {
    const hook = createPostToolOutputSchemaHook({
      id: "plan-validator",
      schema: planSchema,
      toolFilter: "build_plan",
    });
    registerHook(hook);
    const result = await runHooks("PostToolUse", {
      toolName: "build_plan",
      toolCallId: "t1",
      args: {},
      result: { symbol: "BTC", side: "buy", notionalUsd: 1000 },
      durationMs: 10,
      success: true,
    });
    expect(result.action).toBe("allow");
  });

  it("blocks when result fails schema", async () => {
    const hook = createPostToolOutputSchemaHook({
      id: "plan-validator",
      schema: planSchema,
      toolFilter: "build_plan",
    });
    registerHook(hook);
    const result = await runHooks("PostToolUse", {
      toolName: "build_plan",
      toolCallId: "t1",
      args: {},
      result: { symbol: "BTC" },
      durationMs: 10,
      success: true,
    });
    expect(result.action).toBe("block");
    expect(result.reason).toContain("schema");
    expect(result.metadata?.issues).toBeDefined();
  });

  it("modifies with reprompt when repromptInsteadOfBlock is set", async () => {
    const hook = createPostToolOutputSchemaHook({
      id: "plan-validator",
      schema: planSchema,
      toolFilter: "build_plan",
      repromptInsteadOfBlock: true,
    });
    registerHook(hook);
    const result = await runHooks("PostToolUse", {
      toolName: "build_plan",
      toolCallId: "t1",
      args: {},
      result: { symbol: "BTC" },
      durationMs: 10,
      success: true,
    });
    // Engine merges modify replacements into finalPayload and returns "allow".
    expect(result.action).toBe("allow");
    const finalPayload = result.metadata?.finalPayload as {
      __structuredOutputReprompt?: string;
    };
    expect(finalPayload.__structuredOutputReprompt).toBeDefined();
    expect(finalPayload.__structuredOutputReprompt).toContain("schema");
  });

  it("skips validation when tool errored", async () => {
    const hook = createPostToolOutputSchemaHook({
      id: "plan-validator",
      schema: planSchema,
      toolFilter: "build_plan",
    });
    registerHook(hook);
    const result = await runHooks("PostToolUse", {
      toolName: "build_plan",
      toolCallId: "t1",
      args: {},
      result: undefined,
      durationMs: 10,
      success: false,
    });
    expect(result.action).toBe("allow");
  });

  it("supports custom extractor for nested results", async () => {
    const hook = createPostToolOutputSchemaHook({
      id: "plan-validator",
      schema: planSchema,
      toolFilter: "build_plan",
      extract: (r: unknown) =>
        (r as { plan: unknown } | undefined)?.plan,
    });
    registerHook(hook);
    const result = await runHooks("PostToolUse", {
      toolName: "build_plan",
      toolCallId: "t1",
      args: {},
      result: { plan: { symbol: "BTC", side: "buy", notionalUsd: 1000 } },
      durationMs: 10,
      success: true,
    });
    expect(result.action).toBe("allow");
  });

  it("calls onFailure observer when validation fails", async () => {
    let captured: string[] | null = null;
    const hook = createPostToolOutputSchemaHook({
      id: "plan-validator",
      schema: planSchema,
      toolFilter: "build_plan",
      onFailure: (_payload, r) => {
        captured = r.issues;
      },
    });
    registerHook(hook);
    await runHooks("PostToolUse", {
      toolName: "build_plan",
      toolCallId: "t1",
      args: {},
      result: { symbol: "BTC" },
      durationMs: 10,
      success: true,
    });
    expect(captured).not.toBeNull();
    expect(captured!.length).toBeGreaterThan(0);
  });
});

describe("createPreToolInputSchemaHook", () => {
  it("allows when input matches schema", async () => {
    const hook = createPreToolInputSchemaHook({
      id: "place-order-input",
      schema: planSchema,
      toolFilter: "place_order",
    });
    registerHook(hook);
    const result = await runHooks("PreToolUse", {
      toolName: "place_order",
      toolCallId: "t1",
      args: { symbol: "BTC", side: "buy", notionalUsd: 1000 },
    });
    expect(result.action).toBe("allow");
  });

  it("blocks malformed inputs", async () => {
    const hook = createPreToolInputSchemaHook({
      id: "place-order-input",
      schema: planSchema,
      toolFilter: "place_order",
    });
    registerHook(hook);
    const result = await runHooks("PreToolUse", {
      toolName: "place_order",
      toolCallId: "t1",
      args: { symbol: "BTC", side: "buy", notionalUsd: -50 },
    });
    expect(result.action).toBe("block");
    expect(result.reason).toContain("input");
  });
});

describe("toolFilter scoping", () => {
  it("does not fire on unrelated tools", async () => {
    const hook = createPostToolOutputSchemaHook({
      id: "plan-validator",
      schema: planSchema,
      toolFilter: "build_plan",
    });
    registerHook(hook);
    const result = await runHooks("PostToolUse", {
      toolName: "get_balance",
      toolCallId: "t1",
      args: {},
      result: { not_a_plan: true },
      durationMs: 10,
      success: true,
    });
    expect(result.action).toBe("allow");
  });

  it("regex filter matches multiple tools", async () => {
    const hook = createPostToolOutputSchemaHook({
      id: "any-build",
      schema: planSchema,
      toolFilter: /^build_/,
    });
    registerHook(hook);
    const r1 = await runHooks("PostToolUse", {
      toolName: "build_plan",
      toolCallId: "t1",
      args: {},
      result: { symbol: "BTC" },
      durationMs: 10,
      success: true,
    });
    expect(r1.action).toBe("block");
  });
});
