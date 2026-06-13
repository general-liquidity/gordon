/**
 * Background dispatch — safety-invariant + re-injection tests.
 *
 * The load-bearing assertion is (b): a deny-listed execution tool flagged
 * `backgroundEligible: true` MUST still run foreground. The deny-list wins over
 * the flag, always — this is the non-negotiable safety invariant for a money
 * agent.
 */

import { describe, expect, test } from "bun:test";

import {
  BackgroundDispatchManager,
  decideDispatch,
  isBackgroundDenied,
  shouldRunInBackground,
  type BackgroundEligibleTool,
} from "./backgroundDispatch.ts";

const flagged: BackgroundEligibleTool = { id: "run_backtest", backgroundEligible: true };
const unflagged: BackgroundEligibleTool = { id: "get_market_data" };

/** A tool a misconfiguration flagged eligible that is actually an order tool. */
const flaggedDenied: BackgroundEligibleTool = { id: "place_order", backgroundEligible: true };

describe("isBackgroundDenied — deny-list is authoritative", () => {
  test("execution / money tools are denied", () => {
    for (const id of [
      "place_order",
      "place_market_order",
      "place_bracket_order",
      "execute_trade",
      "cancel_order",
      "cancel_all_orders",
      "wallet_transfer",
      "execute_plan",
    ]) {
      expect(isBackgroundDenied(id)).toBe(true);
    }
  });

  test("approve_plan (control-flow authority) is denied even though it isn't on the trust list", () => {
    expect(isBackgroundDenied("approve_plan")).toBe(true);
  });

  test("read / compute tools are not denied", () => {
    expect(isBackgroundDenied("run_backtest")).toBe(false);
    expect(isBackgroundDenied("parallel_deep_analysis")).toBe(false);
    expect(isBackgroundDenied("get_market_data")).toBe(false);
  });
});

describe("shouldRunInBackground — flag AND not-denied", () => {
  test("(a) flagged read tool is eligible for background", () => {
    expect(shouldRunInBackground("run_backtest", flagged)).toBe(true);
  });

  test("(b) deny-listed tool flagged eligible is STILL refused (deny-list wins)", () => {
    expect(shouldRunInBackground("place_order", flaggedDenied)).toBe(false);
  });

  test("(c) unflagged tool is not eligible", () => {
    expect(shouldRunInBackground("get_market_data", unflagged)).toBe(false);
    expect(shouldRunInBackground("get_market_data", undefined)).toBe(false);
  });
});

describe("decideDispatch — folds in deny-list, flag, and concurrency cap", () => {
  const cap = { inFlight: 0, maxConcurrent: 4 };

  test("flagged read tool → background", () => {
    expect(decideDispatch("run_backtest", flagged, cap).mode).toBe("background");
  });

  test("deny-listed + flagged → foreground, with deny-list reason", () => {
    const decision = decideDispatch("place_order", flaggedDenied, cap);
    expect(decision.mode).toBe("foreground");
    expect(decision.reason).toContain("deny-list");
  });

  test("unflagged → foreground", () => {
    expect(decideDispatch("get_market_data", unflagged, cap).mode).toBe("foreground");
  });

  test("eligible tool runs foreground when the pool is full", () => {
    const full = { inFlight: 4, maxConcurrent: 4 };
    expect(decideDispatch("run_backtest", flagged, full).mode).toBe("foreground");
  });
});

describe("BackgroundDispatchManager.dispatch", () => {
  test("(a) flagged read tool dispatches async; result becomes available for re-injection", async () => {
    const manager = new BackgroundDispatchManager();
    let resolveRun!: (v: unknown) => void;
    const gate = new Promise<unknown>((resolve) => {
      resolveRun = resolve;
    });

    const decision = await manager.dispatch({
      toolName: "run_backtest",
      tool: flagged,
      agent: "Researcher",
      run: () => gate,
    });

    // Returns immediately in background mode — the loop is NOT blocked.
    expect(decision.mode).toBe("background");
    expect(decision.taskId).toBeDefined();
    expect(manager.inFlightCount).toBe(1);
    // Nothing to re-inject yet — the task is still running.
    expect(manager.hasCompleted()).toBe(false);
    expect(manager.takeCompleted()).toEqual([]);

    // Complete the background work.
    resolveRun({ sharpe: 1.4 });
    const completed = await manager.settleAll();

    expect(manager.inFlightCount).toBe(0);
    expect(completed).toHaveLength(1);
    expect(completed[0]?.toolName).toBe("run_backtest");
    expect(completed[0]?.agent).toBe("Researcher");
    expect(completed[0]?.error).toBeUndefined();
    expect(completed[0]?.result).toEqual({ sharpe: 1.4 });
  });

  test("(b) deny-listed tool flagged backgroundEligible STILL runs foreground (guard refuses to background it)", async () => {
    const manager = new BackgroundDispatchManager();
    let ran = false;

    const decision = await manager.dispatch({
      toolName: "place_order",
      tool: flaggedDenied,
      run: async () => {
        ran = true;
        return { orderId: "abc" };
      },
    });

    // The hard guard forces foreground: result is returned INLINE, the work
    // already executed synchronously, and nothing was registered as in-flight.
    expect(decision.mode).toBe("foreground");
    expect(decision.reason).toContain("deny-list");
    expect(decision.result).toEqual({ orderId: "abc" });
    expect(ran).toBe(true);
    expect(manager.inFlightCount).toBe(0);
    expect(manager.hasCompleted()).toBe(false);
  });

  test("(c) unflagged tool runs foreground", async () => {
    const manager = new BackgroundDispatchManager();
    const decision = await manager.dispatch({
      toolName: "get_market_data",
      tool: unflagged,
      run: async () => ({ price: 100 }),
    });

    expect(decision.mode).toBe("foreground");
    expect(decision.result).toEqual({ price: 100 });
    expect(manager.inFlightCount).toBe(0);
  });

  test("a failed background task is buffered with an error string for attribution", async () => {
    const manager = new BackgroundDispatchManager();
    await manager.dispatch({
      toolName: "run_backtest",
      tool: flagged,
      run: async () => {
        throw new Error("history fetch timed out");
      },
    });

    const completed = await manager.settleAll();
    expect(completed).toHaveLength(1);
    expect(completed[0]?.error).toBe("history fetch timed out");
    expect(completed[0]?.result).toBe("history fetch timed out");
  });

  test("concurrency cap forces overflow dispatches foreground", async () => {
    const manager = new BackgroundDispatchManager({ maxConcurrent: 1 });
    let resolveFirst!: (v: unknown) => void;
    const firstGate = new Promise<unknown>((resolve) => {
      resolveFirst = resolve;
    });

    const first = await manager.dispatch({
      toolName: "run_backtest",
      tool: flagged,
      run: () => firstGate,
    });
    expect(first.mode).toBe("background");
    expect(manager.inFlightCount).toBe(1);

    // Pool is full (cap 1) — a second eligible call must run foreground.
    let secondRan = false;
    const second = await manager.dispatch({
      toolName: "run_backtest",
      tool: flagged,
      run: async () => {
        secondRan = true;
        return { ok: true };
      },
    });
    expect(second.mode).toBe("foreground");
    expect(second.result).toEqual({ ok: true });
    expect(secondRan).toBe(true);

    resolveFirst({ ok: true });
    await manager.settleAll();
  });

  test("takeCompleted drains exactly once (re-injected results aren't double-counted)", async () => {
    const manager = new BackgroundDispatchManager();
    await manager.dispatch({
      toolName: "parallel_deep_analysis",
      tool: { id: "parallel_deep_analysis", backgroundEligible: true },
      run: async () => ({ consensus: "bullish" }),
    });
    await manager.settleAll().then((r) => expect(r).toHaveLength(1));
    // Already drained by settleAll → nothing left.
    expect(manager.takeCompleted()).toEqual([]);
    expect(manager.hasCompleted()).toBe(false);
  });
});
