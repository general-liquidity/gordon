import { describe, it, expect, beforeEach } from "bun:test";
import { withResultCache, withResultCacheAll } from "./withResultCache.ts";
import {
  _resetDefaultToolResultCacheForTests,
  getDefaultToolResultCache,
} from "../../tooling/toolResultCache.ts";

interface MockTool {
  id: string;
  execute?: (...args: unknown[]) => Promise<unknown> | unknown;
  [key: string]: unknown;
}

function makeTool(id: string, fn: (args?: Record<string, unknown>) => unknown): MockTool {
  return {
    id,
    execute: async (...args: unknown[]): Promise<unknown> => {
      const argObj = (args[0] ?? {}) as Record<string, unknown>;
      return fn(argObj);
    },
  };
}

async function callTool(t: MockTool, args: unknown, ctx: unknown): Promise<unknown> {
  if (typeof t.execute !== "function") {
    throw new Error(`tool ${t.id} has no execute`);
  }
  return await t.execute(args, ctx);
}

describe("withResultCache", () => {
  beforeEach(() => {
    _resetDefaultToolResultCacheForTests();
  });

  it("returns a cached delta envelope on second call within TTL", async () => {
    let calls = 0;
    const tool = withResultCache(
      makeTool("get_price", () => {
        calls++;
        return { price: 50000 };
      }),
    );
    const first = await callTool(tool, { symbol: "BTC" }, { threadId: "t1" });
    const second = await callTool(tool, { symbol: "BTC" }, { threadId: "t1" });
    expect(calls).toBe(1);
    expect((first as { price: number }).price).toBe(50000);
    expect((second as { status?: string }).status).toBe("unchanged");
  });

  it("session keys isolate cache (different threadId = cache miss)", async () => {
    let calls = 0;
    const tool = withResultCache(
      makeTool("get_price", () => {
        calls++;
        return { price: 50000 };
      }),
    );
    await callTool(tool, { symbol: "BTC" }, { threadId: "thread-a" });
    await callTool(tool, { symbol: "BTC" }, { threadId: "thread-b" });
    expect(calls).toBe(2);
  });

  it("different args isolate cache", async () => {
    let calls = 0;
    const tool = withResultCache(
      makeTool("get_price", (args) => {
        calls++;
        return { price: args?.symbol === "BTC" ? 50000 : 3000 };
      }),
    );
    await callTool(tool, { symbol: "BTC" }, { threadId: "t1" });
    await callTool(tool, { symbol: "ETH" }, { threadId: "t1" });
    expect(calls).toBe(2);
  });

  it("does NOT cache error envelopes", async () => {
    let calls = 0;
    const tool = withResultCache(
      makeTool("get_price", () => {
        calls++;
        return { status: "error", message: "rate limited" };
      }),
    );
    await callTool(tool, { symbol: "BTC" }, { threadId: "t1" });
    await callTool(tool, { symbol: "BTC" }, { threadId: "t1" });
    expect(calls).toBe(2); // both calls actually executed
  });

  it("leaves non-function tools alone", () => {
    const tool = withResultCache({ id: "no_execute" } as { id: string; execute?: undefined });
    expect(tool.execute).toBeUndefined();
  });

  it("withResultCacheAll wraps every tool in a bundle", async () => {
    let priceCalls = 0;
    let tickerCalls = 0;
    const bundle = withResultCacheAll({
      get_price: makeTool("get_price", () => {
        priceCalls++;
        return { price: 1 };
      }),
      get_ticker: makeTool("get_ticker", () => {
        tickerCalls++;
        return { lastPrice: 1 };
      }),
    });
    await callTool(bundle.get_price, { symbol: "X" }, { threadId: "t1" });
    await callTool(bundle.get_price, { symbol: "X" }, { threadId: "t1" });
    await callTool(bundle.get_ticker, { symbol: "X" }, { threadId: "t1" });
    await callTool(bundle.get_ticker, { symbol: "X" }, { threadId: "t1" });
    expect(priceCalls).toBe(1);
    expect(tickerCalls).toBe(1);
  });

  it("falls back to original execute() when cache.lookup throws", async () => {
    const cache = getDefaultToolResultCache();
    const origLookup = cache.lookup.bind(cache);
    cache.lookup = (() => {
      throw new Error("synthetic cache failure");
    }) as typeof cache.lookup;

    let calls = 0;
    const tool = withResultCache(
      makeTool("get_price", () => {
        calls++;
        return { price: 1 };
      }),
    );
    const result = await callTool(tool, { symbol: "BTC" }, { threadId: "t1" });
    expect(calls).toBe(1);
    expect((result as { price: number }).price).toBe(1);
    cache.lookup = origLookup;
  });
});
