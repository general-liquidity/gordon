import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import type { Mt5Bar } from "../../../src/infra/broker/mt5/bridgeClient.ts";
import { CompetitionLiveTrader, type SignalFn, type ContractSpec } from "../../../src/infra/trading/competition/liveTrader.ts";
import { COMPETITION_RISK_AGGRESSIVE } from "../../../src/core/risk-management/competition-risk-preset.ts";
import { ReplayMt5, type ReplaySymbolData } from "./rehearsal.ts";

/** Build a flat bar at a given price, with a small symmetric range. */
function bar(time: number, close: number, range = 1): Mt5Bar {
  return {
    time,
    open: close,
    high: close + range,
    low: close - range,
    close,
    tickVolume: 1,
    spread: 0,
    realVolume: 0,
  };
}

function makeReplay(bars: Mt5Bar[], opts?: { contractSize?: number; halfSpread?: number; startingEquity?: number }): ReplayMt5 {
  const sym: ReplaySymbolData = {
    symbol: "TEST",
    bars,
    contractSize: opts?.contractSize ?? 1,
    halfSpread: opts?.halfSpread ?? 0,
  };
  return new ReplayMt5({ startingEquity: opts?.startingEquity ?? 100_000, symbols: [sym] });
}

describe("ReplayMt5", () => {
  it("placeOrder opens a position reflected in positions()", async () => {
    const replay = makeReplay([bar(1000, 100), bar(2000, 101)]);
    const before = await replay.positions();
    expect(before).toHaveLength(0);

    const res = await replay.placeOrder({ symbol: "TEST", side: "buy", type: "market", volume: 2 });
    expect(res.executed).toBe(true);
    expect(res.order).toBeGreaterThan(0);

    const after = await replay.positions();
    expect(after).toHaveLength(1);
    expect(after[0]!.symbol).toBe("TEST");
    expect(after[0]!.sideLabel).toBe("long");
    expect(after[0]!.volume).toBe(2);
    // market buy fills at ask = close (halfSpread 0)
    expect(after[0]!.price_open).toBeCloseTo(100, 6);
  });

  it("a bar that hits the stop closes the position with the right PnL sign", async () => {
    // Long at 100 with stop at 95. Cursor 0 = 100, cursor 1 = bar whose low touches 95.
    const replay = makeReplay([bar(1000, 100), bar(2000, 96, /*range*/ 2)]); // low = 94 ≤ 95
    await replay.placeOrder({ symbol: "TEST", side: "buy", type: "market", volume: 1, sl: 95 });
    expect(await replay.positions()).toHaveLength(1);

    const equityBefore = replay.equityNow();
    const advanced = replay.step(); // lands on bar(2000) — low 94 ≤ stop 95 → exit at 95
    expect(advanced).toBe(true);

    expect(await replay.positions()).toHaveLength(0); // closed
    // Realized loss: (95 - 100) * 1 unit = -5 → equity below start.
    const equityAfter = replay.equityNow();
    expect(equityAfter).toBeLessThan(equityBefore);
    expect(equityAfter).toBeCloseTo(100_000 - 5, 6);
  });

  it("a short whose stop is hit realizes a loss (mirrored sign)", async () => {
    const replay = makeReplay([bar(1000, 100), bar(2000, 104, 2)]); // high = 106 ≥ stop 105
    await replay.placeOrder({ symbol: "TEST", side: "sell", type: "market", volume: 1, sl: 105 });
    replay.step();
    expect(await replay.positions()).toHaveLength(0);
    // Short entered 100, stopped at 105 → (105-100)*-1 = -5.
    expect(replay.equityNow()).toBeCloseTo(100_000 - 5, 6);
  });

  it("a bar that hits the target closes the position with a gain", async () => {
    const replay = makeReplay([bar(1000, 100), bar(2000, 104, 2)]); // high = 106 ≥ tp 105
    await replay.placeOrder({ symbol: "TEST", side: "buy", type: "market", volume: 1, tp: 105 });
    replay.step();
    expect(await replay.positions()).toHaveLength(0);
    expect(replay.equityNow()).toBeCloseTo(100_000 + 5, 6);
  });

  it("the cursor advances what bars() returns", async () => {
    const bars = [bar(1000, 100), bar(2000, 101), bar(3000, 102), bar(4000, 103)];
    const replay = makeReplay(bars);

    expect((await replay.bars({ symbol: "TEST" }))).toHaveLength(1); // cursor 0
    replay.step();
    expect((await replay.bars({ symbol: "TEST" }))).toHaveLength(2);
    replay.step();
    const upTo = await replay.bars({ symbol: "TEST" });
    expect(upTo).toHaveLength(3);
    expect(upTo[upTo.length - 1]!.close).toBe(102); // latest = cursor bar
  });

  it("quote() synthesizes bid/ask around the current close", async () => {
    const replay = makeReplay([bar(1000, 200)], { halfSpread: 0.5 });
    const q = await replay.quote("TEST");
    expect(q.bid).toBeCloseTo(199.5, 6);
    expect(q.ask).toBeCloseTo(200.5, 6);
    expect(q.live).toBe(true);
  });

  it("account() equity reflects unrealized then realized PnL", async () => {
    const replay = makeReplay([bar(1000, 100), bar(2000, 110)], { startingEquity: 50_000 });
    await replay.placeOrder({ symbol: "TEST", side: "buy", type: "market", volume: 1 });
    // Move to next bar (110) — no stop/target, position stays open, unrealized +10.
    replay.step();
    const acct = await replay.account();
    expect(acct.equity).toBeCloseTo(50_000 + 10, 6);
    expect(acct.profit).toBeCloseTo(10, 6); // open/unrealized
  });

  it("a limit order that the bar does not reach does not fill", async () => {
    const replay = makeReplay([bar(1000, 100, 1)]); // low 99, high 101
    const res = await replay.placeOrder({ symbol: "TEST", side: "buy", type: "limit", price: 95, volume: 1 });
    expect(res.executed).toBe(false);
    expect(await replay.positions()).toHaveLength(0);
  });
});

describe("CompetitionLiveTrader against ReplayMt5", () => {
  const prevLive = process.env.GORDON_LIVE_TRADING;
  beforeEach(() => {
    process.env.GORDON_LIVE_TRADING = "1";
  });
  afterEach(() => {
    if (prevLive === undefined) delete process.env.GORDON_LIVE_TRADING;
    else process.env.GORDON_LIVE_TRADING = prevLive;
  });

  it("runCycle produces a decision and places an order through the live path", async () => {
    // A deterministic upward ramp: the last close is well above the lookback mean,
    // so the mean-reversion signal fires SHORT and the trader sizes + places.
    const bars: Mt5Bar[] = [];
    for (let i = 0; i < 30; i++) bars.push(bar(1_000 + i * 900, 100 + i * 0.5, 0.5));

    const sym: ReplaySymbolData = { symbol: "TEST", bars, contractSize: 1, halfSpread: 0.01 };
    const replay = new ReplayMt5({ startingEquity: 1_000_000, symbols: [sym] });
    // Advance cursor to the end so bars() returns the full ramp.
    while (replay.step()) { /* advance to last bar */ }

    const signal: SignalFn = (recent) => {
      const closes = recent.map((b) => b.close);
      const mean = closes.reduce((a, c) => a + c, 0) / closes.length;
      const last = closes[closes.length - 1]!;
      // Ramp → last > mean → short.
      return { side: last > mean ? "short" : "long", stopDistance: 1, targetDistance: 2 };
    };

    const contracts: Record<string, ContractSpec> = { TEST: { volume_min: 0.01, volume_step: 0.01, contractSize: 1 } };
    const trader = new CompetitionLiveTrader({
      client: replay,
      symbols: ["TEST"],
      signals: { TEST: signal },
      contracts,
      config: { execution: "taker", barsLookback: 30, dailyLossKillPct: 0.08, timeframe: "M15" },
      riskParams: COMPETITION_RISK_AGGRESSIVE,
      log: () => {},
    });

    const report = await trader.runCycle(bars[bars.length - 1]!.time * 1000);

    expect(report.liveArmed).toBe(true);
    expect(report.decisions).toHaveLength(1);
    const d = report.decisions[0]!;
    expect(d.action).toBe("placed");
    expect(d.side).toBe("sell");
    expect(report.ordersPlaced).toBe(1);

    // The order is now an open position in the replay bridge.
    const positions = await replay.positions();
    expect(positions).toHaveLength(1);
    expect(positions[0]!.sideLabel).toBe("short");
  });

  it("the trader skips a symbol whose position is already open", async () => {
    const bars: Mt5Bar[] = [];
    for (let i = 0; i < 30; i++) bars.push(bar(1_000 + i * 900, 100 + i * 0.5, 0.5));
    const sym: ReplaySymbolData = { symbol: "TEST", bars, contractSize: 1, halfSpread: 0.01 };
    const replay = new ReplayMt5({ startingEquity: 1_000_000, symbols: [sym] });
    while (replay.step()) { /* advance */ }

    // Pre-open a position so the trader's "already open" gate trips.
    await replay.placeOrder({ symbol: "TEST", side: "buy", type: "market", volume: 0.01 });

    const trader = new CompetitionLiveTrader({
      client: replay,
      symbols: ["TEST"],
      signals: { TEST: () => ({ side: "short", stopDistance: 1, targetDistance: 2 }) },
      contracts: { TEST: { volume_min: 0.01, volume_step: 0.01, contractSize: 1 } },
      config: { execution: "taker", barsLookback: 30, dailyLossKillPct: 0.08, timeframe: "M15" },
      riskParams: COMPETITION_RISK_AGGRESSIVE,
      log: () => {},
    });

    const report = await trader.runCycle(bars[bars.length - 1]!.time * 1000);
    expect(report.ordersPlaced).toBe(0);
    expect(report.decisions[0]!.action).toBe("skipped");
    expect(report.decisions[0]!.reason).toContain("already open");
  });
});
