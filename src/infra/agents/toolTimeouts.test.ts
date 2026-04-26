import { describe, it, expect } from "bun:test";
import {
  ToolTimeoutError,
  getTimeoutForToolName,
  runWithToolTimeout,
} from "./toolTimeouts.ts";

describe("getTimeoutForToolName", () => {
  it("classifies market reads under 'market' family", () => {
    expect(getTimeoutForToolName("get_price").family).toBe("market");
    expect(getTimeoutForToolName("get_ticker").family).toBe("market");
    expect(getTimeoutForToolName("get_candles").family).toBe("market");
  });

  it("classifies trading paths with longer timeouts", () => {
    const r = getTimeoutForToolName("place_order");
    expect(r.family).toBe("trading");
    expect(r.timeoutMs).toBeGreaterThanOrEqual(10_000);
  });

  it("classifies backtests with the longest timeout", () => {
    expect(getTimeoutForToolName("backtest_strategy").timeoutMs).toBe(120_000);
  });

  it("classifies on-chain reads via prefix family", () => {
    expect(getTimeoutForToolName("solana_get_balance").family).toBe("solana");
    expect(getTimeoutForToolName("polkadot_get_staking_info").family).toBe("polkadot");
    expect(getTimeoutForToolName("agentkit_get_balance").family).toBe("evm");
  });

  it("falls back to 'default' for unknown tools", () => {
    const r = getTimeoutForToolName("totally_made_up_tool_name");
    expect(r.family).toBe("default");
    expect(r.timeoutMs).toBe(10_000);
  });
});

describe("runWithToolTimeout", () => {
  it("returns the executor's result when it completes in time", async () => {
    const result = await runWithToolTimeout("get_price", async () => {
      await new Promise((r) => setTimeout(r, 5));
      return { price: 50000 };
    });
    expect(result).toEqual({ price: 50000 });
  });

  it("rejects with ToolTimeoutError when the executor exceeds the cap", async () => {
    let caught: unknown;
    try {
      await runWithToolTimeout(
        "get_price",
        () => new Promise<unknown>(() => {/* never resolves */}),
        { override: 30 },
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ToolTimeoutError);
    expect((caught as ToolTimeoutError).toolName).toBe("get_price");
    expect((caught as ToolTimeoutError).timeoutMs).toBe(30);
  });

  it("aborts the AbortSignal when the timeout fires", async () => {
    let signalAborted = false;
    try {
      await runWithToolTimeout(
        "get_price",
        async (signal) => {
          signal.addEventListener("abort", () => {
            signalAborted = true;
          });
          await new Promise((r) => setTimeout(r, 200));
          return null;
        },
        { override: 30 },
      );
    } catch {
      // expected
    }
    // Allow the abort listener to run
    await new Promise((r) => setTimeout(r, 5));
    expect(signalAborted).toBe(true);
  });

  it("propagates non-timeout errors from the executor unchanged", async () => {
    let caught: unknown;
    try {
      await runWithToolTimeout("get_price", async () => {
        throw new Error("explicit failure");
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("explicit failure");
    expect(caught).not.toBeInstanceOf(ToolTimeoutError);
  });

  it("uses override when provided", async () => {
    let caught: unknown;
    try {
      await runWithToolTimeout(
        "place_order",
        () => new Promise<unknown>(() => {/* never resolves */}),
        { override: 20 },
      );
    } catch (err) {
      caught = err;
    }
    expect((caught as ToolTimeoutError).timeoutMs).toBe(20);
  });
});
