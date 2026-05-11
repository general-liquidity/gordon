import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { withOutputFiltering, withOutputFilteringAll } from "./withOutputFiltering.ts";

const FLAG = "GORDON_TOOL_OUTPUT_FILTERS";

function makeCandlesPayload(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    open: 100 + i * 0.5,
    high: 101 + i * 0.5,
    low: 99 + i * 0.5,
    close: 100.5 + i * 0.5,
    volume: 1000 + i,
    timestamp: 1_700_000_000_000 + i * 60_000,
  }));
}

interface MockTool {
  id: string;
  execute?: (...args: unknown[]) => Promise<unknown> | unknown;
  [key: string]: unknown;
}

function makeTool(id: string, payload: unknown): MockTool {
  return {
    id,
    execute: async (..._args: unknown[]): Promise<unknown> => payload,
  };
}

describe("withOutputFiltering", () => {
  const prev = process.env[FLAG];
  beforeEach(() => {
    delete process.env[FLAG];
  });
  afterEach(() => {
    if (prev === undefined) delete process.env[FLAG];
    else process.env[FLAG] = prev;
  });

  it("passes through unchanged when flag is off", async () => {
    const payload = makeCandlesPayload(200);
    const tool = withOutputFiltering(makeTool("get_candles", payload));
    const result = await tool.execute!();
    expect(result).toBe(payload);
  });

  it("applies the registered filter when flag is on", async () => {
    process.env[FLAG] = "1";
    const payload = makeCandlesPayload(200);
    const tool = withOutputFiltering(makeTool("get_candles", payload));
    const result = await tool.execute!();
    expect(result).not.toBe(payload);
    expect((result as { summary: unknown }).summary).toBeDefined();
  });

  it("does NOT mutate tools that have no registered filter", async () => {
    process.env[FLAG] = "1";
    const payload = { whatever: "data" };
    const tool = withOutputFiltering(makeTool("unknown_tool", payload));
    const result = await tool.execute!();
    expect(result).toBe(payload);
  });

  it("falls back to raw result when filter would not shrink output", async () => {
    process.env[FLAG] = "1";
    // Small candle array — filter passes through anyway, so identity is preserved.
    const payload = makeCandlesPayload(10);
    const tool = withOutputFiltering(makeTool("get_candles", payload));
    const result = await tool.execute!();
    expect(result).toBe(payload);
  });

  it("falls back to raw result on filter exception", async () => {
    process.env[FLAG] = "1";
    // Pass a value that confuses the filter; dispatcher should passthrough
    // (defensive default — never throw to the agent).
    const payload = { broken: "shape", but: "valid" };
    const tool = withOutputFiltering(makeTool("get_candles", payload));
    const result = await tool.execute!();
    expect(result).toBe(payload);
  });

  it("leaves non-function tools alone", () => {
    const tool = withOutputFiltering({ id: "no_execute" } as { id: string; execute?: undefined });
    expect(tool.execute).toBeUndefined();
  });

  it("withOutputFilteringAll wraps every tool in a bundle", async () => {
    process.env[FLAG] = "1";
    const bundle = {
      get_candles: makeTool("get_candles", makeCandlesPayload(200)),
      foo: makeTool("foo", { x: 1 }),
    };
    const wrapped = withOutputFilteringAll(bundle);
    const candlesResult = await wrapped.get_candles.execute!();
    expect((candlesResult as { summary: unknown }).summary).toBeDefined();
    const fooResult = await wrapped.foo.execute!();
    expect(fooResult).toEqual({ x: 1 });
  });
});
