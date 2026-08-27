import { describe, it, expect } from "bun:test";
import { runEventReplay } from "./engine.ts";
import type { HistoricalEvent, OHLCBar, ReplayStrategy, StrategyOrder } from "./types.ts";

function makeEvent(overrides: Partial<HistoricalEvent> = {}): HistoricalEvent {
  return {
    id: "test-event",
    name: "Test event",
    description: "test",
    windowStart: "2026-01-01T00:00:00Z",
    windowEnd: "2026-01-02T00:00:00Z",
    volExpansionStart: "2026-01-01T08:00:00Z",
    primaryAssets: [{ symbol: "TEST", market: "fx" }],
    characteristics: {
      primaryMove: "test",
      gapRisk: false,
      spreadWidening: false,
      sessionsHalted: false,
    },
    ...overrides,
  };
}

function makeBars(
  prices: number[],
  startTime: number = Date.parse("2026-01-01T00:00:00Z"),
): OHLCBar[] {
  return prices.map((close, i) => ({
    time: startTime + i * 60 * 60 * 1000, // 1-hour bars
    open: i === 0 ? close : prices[i - 1]!,
    high: Math.max(close, i === 0 ? close : prices[i - 1]!),
    low: Math.min(close, i === 0 ? close : prices[i - 1]!),
    close,
    volume: 1000,
  }));
}

// Strategy that holds a long position the whole time without managing risk
const holdLongStrategy: ReplayStrategy = {
  init: () => ({ TEST: { qty: 0, avgPrice: 0 } }),
  step: (state, _bar, asset) => {
    if (asset !== "TEST") return [];
    if (state.TEST!.qty === 0) {
      return [{ asset: "TEST", side: "buy", qty: 100, type: "market" }];
    }
    return [];
  },
};

describe("runEventReplay — basic execution", () => {
  it("runs without crashing on a simple long-hold strategy", () => {
    const event = makeEvent();
    const bars = { TEST: makeBars([100, 101, 102, 103, 104, 105]) };
    const metrics = runEventReplay({ event, bars, strategy: holdLongStrategy });
    expect(metrics.eventId).toBe("test-event");
    expect(metrics.trades.length).toBeGreaterThan(0);
    expect(metrics.equityCurve.length).toBeGreaterThan(0);
  });

  it("reports max DD = 0 when equity is monotonically rising", () => {
    const event = makeEvent();
    const bars = { TEST: makeBars([100, 105, 110, 115, 120]) };
    const metrics = runEventReplay({ event, bars, strategy: holdLongStrategy });
    expect(metrics.maxIntradayDrawdown).toBe(0);
  });

  it("reports positive max DD when equity falls", () => {
    const event = makeEvent();
    // Goes up then collapses. Equity = cash + qty*price, so the DD
    // is bounded by the position-to-equity ratio. Just assert any
    // positive drawdown — the bar-level math is what matters.
    const bars = { TEST: makeBars([100, 110, 120, 60, 50]) };
    const metrics = runEventReplay({ event, bars, strategy: holdLongStrategy });
    expect(metrics.maxIntradayDrawdown).toBeGreaterThan(0);
  });

  it("event window filter excludes bars outside [start, end]", () => {
    const event = makeEvent({
      windowStart: "2026-01-01T02:00:00Z",
      windowEnd: "2026-01-01T04:00:00Z",
    });
    const bars = { TEST: makeBars([100, 101, 102, 103, 104, 105]) };
    const metrics = runEventReplay({ event, bars, strategy: holdLongStrategy });
    // Only bars at 02:00 and 03:00 + 04:00 should be in window
    expect(metrics.equityCurve.length).toBeLessThanOrEqual(3);
  });
});

describe("runEventReplay — gap-through-stop", () => {
  it("fills a stop at the worse-side open when bar gaps through", () => {
    // Strategy: enter long at first bar, set sell-stop at 95
    const stopStrategy: ReplayStrategy = {
      init: () => ({ TEST: { qty: 0, avgPrice: 0 } }),
      step: (state, _bar, asset) => {
        if (asset !== "TEST") return [];
        const orders: StrategyOrder[] = [];
        if (state.TEST!.qty === 0) {
          orders.push({ asset: "TEST", side: "buy", qty: 100, type: "market" });
          orders.push({ asset: "TEST", side: "sell", qty: 100, type: "stop", price: 95 });
        }
        return orders;
      },
    };
    const event = makeEvent({
      characteristics: {
        primaryMove: "gap",
        gapRisk: true,
        spreadWidening: false,
        sessionsHalted: false,
      },
    });
    // Price goes 100 → 100 → GAP TO 80 (open 80, well below stop at 95)
    const t0 = Date.parse("2026-01-01T00:00:00Z");
    const bars = {
      TEST: [
        { time: t0, open: 100, high: 100, low: 100, close: 100 },
        { time: t0 + 3600_000, open: 100, high: 100, low: 100, close: 100 },
        { time: t0 + 7200_000, open: 80, high: 82, low: 75, close: 78 },
        { time: t0 + 10800_000, open: 78, high: 79, low: 76, close: 77 },
      ],
    };
    const metrics = runEventReplay({ event, bars, strategy: stopStrategy });
    const stopFill = metrics.trades.find((t) => t.orderType === "stop");
    expect(stopFill).toBeDefined();
    expect(stopFill!.gappedThroughStop).toBe(true);
    expect(stopFill!.filledPrice).toBe(80); // bar open, not stop price (95)
    expect(stopFill!.slippageBps).toBeGreaterThan(1000); // huge gap
  });

  it("normal stop fill (no gap) reports modest slippage", () => {
    const stopStrategy: ReplayStrategy = {
      init: () => ({ TEST: { qty: 0, avgPrice: 0 } }),
      step: (state, _bar, asset) => {
        if (asset !== "TEST") return [];
        const orders: StrategyOrder[] = [];
        if (state.TEST!.qty === 0) {
          orders.push({ asset: "TEST", side: "buy", qty: 100, type: "market" });
          orders.push({ asset: "TEST", side: "sell", qty: 100, type: "stop", price: 95 });
        }
        return orders;
      },
    };
    const event = makeEvent();
    const t0 = Date.parse("2026-01-01T00:00:00Z");
    // Price hits 95 within the bar but opens above
    const bars = {
      TEST: [
        { time: t0, open: 100, high: 100, low: 100, close: 100 },
        { time: t0 + 3600_000, open: 100, high: 100, low: 100, close: 100 },
        { time: t0 + 7200_000, open: 99, high: 99, low: 94, close: 96 }, // dips to 94, stop at 95 triggers
      ],
    };
    const metrics = runEventReplay({ event, bars, strategy: stopStrategy });
    const stopFill = metrics.trades.find((t) => t.orderType === "stop");
    expect(stopFill).toBeDefined();
    expect(stopFill!.gappedThroughStop).toBeUndefined();
    expect(stopFill!.filledPrice).toBe(95);
    expect(stopFill!.slippageBps).toBe(0);
  });
});

describe("runEventReplay — risk response time", () => {
  it("reports null when strategy never reduces exposure", () => {
    const event = makeEvent();
    const bars = { TEST: makeBars([100, 101, 102, 103]) };
    const metrics = runEventReplay({ event, bars, strategy: holdLongStrategy });
    expect(metrics.riskResponseTimeSeconds).toBeNull();
  });

  it("measures lag from volExpansionStart to first reducing trade", () => {
    // Strategy that reduces after entering
    const reducingStrategy: ReplayStrategy = {
      init: () => ({ TEST: { qty: 0, avgPrice: 0 } }),
      step: (state, _bar, asset) => {
        if (asset !== "TEST") return [];
        const orders: StrategyOrder[] = [];
        if (state.TEST!.qty === 0) {
          orders.push({ asset: "TEST", side: "buy", qty: 100, type: "market" });
        } else if (state.TEST!.qty === 100) {
          // After volExpansionStart, close the position
          orders.push({ asset: "TEST", side: "close", qty: 100, type: "market" });
        }
        return orders;
      },
    };
    const event = makeEvent({
      windowStart: "2026-01-01T00:00:00Z",
      windowEnd: "2026-01-01T10:00:00Z",
      volExpansionStart: "2026-01-01T03:00:00Z",
    });
    const bars = { TEST: makeBars([100, 101, 102, 103, 104, 105, 106, 107]) };
    const metrics = runEventReplay({ event, bars, strategy: reducingStrategy });
    expect(metrics.riskResponseTimeSeconds).not.toBeNull();
    expect(metrics.riskResponseTimeSeconds!).toBeGreaterThanOrEqual(0);
  });
});

describe("runEventReplay — spread widening", () => {
  it("applies spread-widening multiplier when event flag is set", () => {
    const eventNoWidening = makeEvent();
    const eventWithWidening = makeEvent({
      characteristics: {
        primaryMove: "test",
        gapRisk: false,
        spreadWidening: true,
        sessionsHalted: false,
      },
    });
    const bars = { TEST: makeBars([100, 101]) };
    const metricsNoWiden = runEventReplay({
      event: eventNoWidening,
      bars,
      strategy: holdLongStrategy,
      slippage: { baseMarketBps: 10, spreadWideningMultiplier: 5 },
    });
    const metricsWiden = runEventReplay({
      event: eventWithWidening,
      bars,
      strategy: holdLongStrategy,
      slippage: { baseMarketBps: 10, spreadWideningMultiplier: 5 },
    });
    expect(metricsWiden.maxSingleTradeSlippage).toBeGreaterThan(
      metricsNoWiden.maxSingleTradeSlippage,
    );
  });
});
