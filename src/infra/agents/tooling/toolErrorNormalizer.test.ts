import { describe, it, expect } from "bun:test";
import { normalizeToolError, wrapToolExecute } from "./toolErrorNormalizer.ts";

describe("normalizeToolError", () => {
  it("converts a thrown Error into a structured result", () => {
    const r = normalizeToolError(new Error("boom"), { toolName: "get_chart" });
    expect(r.status).toBe("error");
    expect(r.message).toContain("get_chart");
    expect(r.message).toContain("boom");
    expect(typeof r.code).toBe("string");
  });

  it("classifies HTTP-shaped errors via retryPolicy", () => {
    const err = { statusCode: 429, errorType: "rate_limit_error", message: "rate limited" };
    const r = normalizeToolError(err, { toolName: "place_order" });
    expect(r.code).toBe("rate_limit");
    expect(r.retryable).toBe(true);
  });

  it("flags terminal errors as non-retryable", () => {
    const err = { statusCode: 401 };
    const r = normalizeToolError(err);
    expect(r.code).toBe("auth");
    expect(r.retryable).toBe(false);
  });

  it("recognises zod-style validation issues and emits structured details", () => {
    const validationErr = {
      name: "ZodError",
      issues: [
        { path: ["symbol"], message: "Required" },
        { path: ["quantity"], message: "Expected number" },
      ],
    };
    const r = normalizeToolError(validationErr, { toolName: "place_order" });
    expect(r.code).toBe("validation_failed");
    expect(r.retryable).toBe(false);
    expect(r.message).toContain("place_order");
    expect(r.details?.issues).toBeDefined();
    expect(Array.isArray(r.details?.issues)).toBe(true);
  });

  it("classifies AbortError as tool_aborted (non-retryable)", () => {
    const err = Object.assign(new Error("aborted"), { name: "AbortError" });
    const r = normalizeToolError(err, { toolName: "scan_market" });
    expect(r.code).toBe("tool_aborted");
    expect(r.retryable).toBe(false);
  });

  it("handles null / undefined / non-Error inputs without throwing", () => {
    expect(normalizeToolError(null).status).toBe("error");
    expect(normalizeToolError(undefined).status).toBe("error");
    expect(normalizeToolError("just a string").message).toContain("just a string");
    expect(normalizeToolError(42).message).toContain("42");
  });

  it("respects classificationOverride", () => {
    const r = normalizeToolError(new Error("nope"), {
      toolName: "x",
      classificationOverride: "permission_denied",
    });
    expect(r.code).toBe("permission_denied");
    expect(r.retryable).toBe(false);
  });

  it("truncates long messages to maxMessageChars", () => {
    const longMessage = "x".repeat(2000);
    const r = normalizeToolError(new Error(longMessage), {
      toolName: "x",
      maxMessageChars: 100,
    });
    expect(r.message.length).toBeLessThanOrEqual(100);
    expect(r.message.endsWith("…")).toBe(true);
  });

  it("serializes plain object errors as JSON", () => {
    const r = normalizeToolError({ foo: "bar", code: 7 });
    expect(r.message).toContain("foo");
    expect(r.message).toContain("bar");
  });
});

describe("wrapToolExecute", () => {
  it("passes through successful results unchanged", async () => {
    const tool = wrapToolExecute("get_price", async (args: { symbol: string }) => {
      return { price: 50000, symbol: args.symbol };
    });
    const result = await tool({ symbol: "BTC" });
    expect(result).toEqual({ price: 50000, symbol: "BTC" });
  });

  it("converts thrown errors into structured ToolErrorResult", async () => {
    const tool = wrapToolExecute("place_order", async () => {
      throw new Error("simulated failure");
    });
    const result = await tool({});
    const err = result as { status: string; code: string; message: string };
    expect(err.status).toBe("error");
    expect(err.message).toContain("place_order");
    expect(err.message).toContain("simulated failure");
  });

  it("wraps validation errors as code=validation_failed", async () => {
    const tool = wrapToolExecute("strict_tool", async () => {
      const e = new Error("bad shape") as Error & { issues: Array<{ path: string[]; message: string }> };
      e.issues = [{ path: ["x"], message: "Required" }];
      throw e;
    });
    const result = await tool({});
    const err = result as { code: string; retryable: boolean };
    expect(err.code).toBe("validation_failed");
    expect(err.retryable).toBe(false);
  });
});
