import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";

// Stub the scan coordinator so cycles are deterministic and offline. The
// returned coins drive the opportunity loop; tests override `nextCoins`.
let nextCoins: Array<Record<string, unknown>> = [];
mock.module("../lifecycle/market-data-coordinator.ts", () => ({
  runSharedScan: async () => ({
    timestamp: new Date().toISOString(),
    universe: "test",
    timeframes: ["1h"],
    coins: nextCoins,
  }),
}));

// Stub session persistence so cycles never touch disk.
mock.module("../lifecycle/session-persistence.ts", () => ({
  saveSessionState: () => {},
  updateHeartbeat: () => {},
  saveMandateState: () => {},
  clearMandateState: () => {},
}));

import {
  startAutonomousLoop,
  stopAutonomousLoop,
  runAutonomousCycleOnce,
  getAutonomousLoopStatus,
  type AutonomousLoopConfig,
} from "./autonomous-loop.ts";
import { createMandate, type SwingMandate } from "../safety/swing-mandate.ts";
import type { Exchange } from "../../infra/exchange/index.ts";

function makeExchange(equitySequence: number[]): Exchange {
  let call = 0;
  return {
    exchangeId: "test-exchange",
    getFullAccountDetails: async () => {
      const idx = Math.min(call, equitySequence.length - 1);
      call += 1;
      return { totalUsdtValue: equitySequence[idx] } as never;
    },
  } as unknown as Exchange;
}

function makeMandate(overrides: Partial<SwingMandate> = {}): SwingMandate {
  return createMandate({
    symbols: [],
    timeframe: "1h",
    scanIntervalMinutes: 60,
    minConfidence: 0.5,
    maxDrawdown: 5,
    requireApproval: false,
    signalOnly: false,
    ...overrides,
  });
}

function opportunityCoin(symbol: string): Record<string, unknown> {
  return {
    symbol,
    price: 100,
    change24h: 1,
    volume24h: 1000,
    indicators: { rsi: 50, macd: null, volumeMA: null, volumeRatio: null },
    levels: [],
    trend: "up",
    setupDetected: true,
    setupConfidence: 0.9,
    bias: "bullish",
    risk: "low",
  };
}

async function driveCycles(n: number): Promise<void> {
  for (let i = 0; i < n; i += 1) {
    await runAutonomousCycleOnce();
    await new Promise((r) => setImmediate(r));
  }
}

describe("autonomous-loop hard caps", () => {
  beforeEach(() => {
    nextCoins = [];
    delete process.env.GORDON_MAX_LOOP_CYCLES;
  });

  afterEach(() => {
    if (getAutonomousLoopStatus().isRunning) {
      stopAutonomousLoop("test cleanup");
    }
    delete process.env.GORDON_MAX_LOOP_CYCLES;
  });

  it("stops when MAX_CYCLES is reached", async () => {
    // Re-import after setting the env so MAX_CYCLES picks it up would require
    // module reset; instead this test relies on the default ceiling being
    // bounded. Drive enough cycles that the ceiling cannot be exceeded.
    const exchange = makeExchange([10_000]);
    const config: AutonomousLoopConfig = { exchange, mandate: makeMandate() };

    const started = startAutonomousLoop(config);
    expect(started.success).toBe(true);

    // Drive many cycles; cycleCount must never exceed the ceiling and the
    // loop must terminate on its own once the ceiling is hit.
    await driveCycles(205);

    const status = getAutonomousLoopStatus();
    expect(status.cycleCount).toBeLessThanOrEqual(200);
    expect(status.isRunning).toBe(false);
  });

  it("hard-stops (not pauses) on a mandate drawdown breach", async () => {
    // Cycle 1 captures the baseline equity; cycle 2 sees a >maxDrawdown drop,
    // which folds a negative PnL into the mandate and breaches it.
    const exchange = makeExchange([10_000, 9_000]); // -10% > 5% maxDrawdown
    const config: AutonomousLoopConfig = {
      exchange,
      mandate: makeMandate({ maxDrawdown: 5 }),
    };

    const started = startAutonomousLoop(config);
    expect(started.success).toBe(true);

    await driveCycles(4);

    const status = getAutonomousLoopStatus();
    // Hard stop terminates the loop entirely — it does not stay running/paused.
    expect(status.isRunning).toBe(false);
    expect(status.isPaused).toBe(false);
  });

  it("stops when the per-symbol trade cap is reached", async () => {
    nextCoins = [opportunityCoin("BTC/USDT")];
    const exchange = makeExchange([10_000]);
    const config: AutonomousLoopConfig = {
      exchange,
      mandate: makeMandate({
        maxTradesPerSessionPerSymbol: 1,
        requireApproval: false,
        signalOnly: false,
      }),
      onOpportunityFound: async () => true, // simulate an autonomous fill
    };

    const started = startAutonomousLoop(config);
    expect(started.success).toBe(true);

    await driveCycles(3);

    const status = getAutonomousLoopStatus();
    expect(status.isRunning).toBe(false);
  });

  it("does NOT count an approval-required opportunity as a fill", async () => {
    nextCoins = [opportunityCoin("ETH/USDT")];
    const exchange = makeExchange([10_000]);
    const config: AutonomousLoopConfig = {
      exchange,
      mandate: makeMandate({
        maxTradesPerSessionPerSymbol: 1,
        requireApproval: true, // approval-gated → true result is not a fill
        signalOnly: false,
      }),
      onOpportunityFound: async () => true,
    };

    const started = startAutonomousLoop(config);
    expect(started.success).toBe(true);

    await driveCycles(2);

    // Cap is never hit because no autonomous fills occurred; loop still runs.
    const status = getAutonomousLoopStatus();
    expect(status.isRunning).toBe(true);
  });
});
