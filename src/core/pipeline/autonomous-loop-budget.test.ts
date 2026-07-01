import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";

// Stub the scan coordinator so cycles are deterministic and offline.
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

async function driveCycles(n: number): Promise<void> {
  for (let i = 0; i < n; i += 1) {
    await runAutonomousCycleOnce();
    await new Promise((r) => setImmediate(r));
  }
}

describe("autonomous-loop live budget ceiling (LB1)", () => {
  beforeEach(() => {
    nextCoins = [];
  });

  afterEach(() => {
    if (getAutonomousLoopStatus().isRunning) {
      stopAutonomousLoop("test cleanup");
    }
  });

  it("continues while reported cost stays under the ceiling", async () => {
    const exchange = makeExchange([10_000]);
    const config: AutonomousLoopConfig = {
      exchange,
      mandate: makeMandate(),
      budgetCeilingUsd: 5.0,
      getCostSoFarUsd: () => 1.0, // well under ceiling
    };

    const started = startAutonomousLoop(config);
    expect(started.success).toBe(true);

    await driveCycles(3);

    const status = getAutonomousLoopStatus();
    expect(status.isRunning).toBe(true);
    expect(status.cycleCount).toBeGreaterThan(0);
  });

  it("stops with budget_exceeded once cost reaches the ceiling", async () => {
    // Cost climbs each call; crosses the $5 ceiling on the third read.
    let cost = 0;
    const exchange = makeExchange([10_000]);
    const config: AutonomousLoopConfig = {
      exchange,
      mandate: makeMandate(),
      budgetCeilingUsd: 5.0,
      getCostSoFarUsd: () => {
        cost += 2.5;
        return cost;
      },
    };

    const started = startAutonomousLoop(config);
    expect(started.success).toBe(true);

    await driveCycles(6);

    const status = getAutonomousLoopStatus();
    // Budget stop terminates the loop entirely (hard stop, not a pause).
    expect(status.isRunning).toBe(false);
    expect(status.isPaused).toBe(false);
  });

  it("stops immediately when cost is already over the ceiling", async () => {
    const exchange = makeExchange([10_000]);
    const config: AutonomousLoopConfig = {
      exchange,
      mandate: makeMandate(),
      budgetCeilingUsd: 5.0,
      getCostSoFarUsd: () => 42.0, // already blown
    };

    const started = startAutonomousLoop(config);
    expect(started.success).toBe(true);

    // The startup cycle should budget-stop before any scan work.
    await driveCycles(2);

    const status = getAutonomousLoopStatus();
    expect(status.isRunning).toBe(false);
  });

  it("never budget-stops when no ceiling is configured (unchanged behavior)", async () => {
    const exchange = makeExchange([10_000]);
    // No budgetCeilingUsd / getCostSoFarUsd — identical to today.
    const config: AutonomousLoopConfig = { exchange, mandate: makeMandate() };

    const started = startAutonomousLoop(config);
    expect(started.success).toBe(true);

    await driveCycles(5);

    const status = getAutonomousLoopStatus();
    expect(status.isRunning).toBe(true);
  });

  it("never budget-stops when a ceiling is set but no cost provider is injected", async () => {
    const exchange = makeExchange([10_000]);
    const config: AutonomousLoopConfig = {
      exchange,
      mandate: makeMandate(),
      budgetCeilingUsd: 5.0, // ceiling but no getCostSoFarUsd
    };

    const started = startAutonomousLoop(config);
    expect(started.success).toBe(true);

    await driveCycles(5);

    const status = getAutonomousLoopStatus();
    expect(status.isRunning).toBe(true);
  });

  it("still fires the existing per-symbol trade cap stop", async () => {
    // Confirms the additive budget check does not disturb existing stops.
    nextCoins = [
      {
        symbol: "BTC/USDT",
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
      },
    ];
    const exchange = makeExchange([10_000]);
    const config: AutonomousLoopConfig = {
      exchange,
      mandate: makeMandate({ maxTradesPerSessionPerSymbol: 1 }),
      onOpportunityFound: async () => true,
      budgetCeilingUsd: 1000, // high enough that budget never trips
      getCostSoFarUsd: () => 1.0,
    };

    const started = startAutonomousLoop(config);
    expect(started.success).toBe(true);

    await driveCycles(3);

    const status = getAutonomousLoopStatus();
    expect(status.isRunning).toBe(false);
  });
});
