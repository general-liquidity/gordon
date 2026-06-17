import { afterEach, describe, expect, it } from "bun:test";
import { CompetitionLiveTrader, type Mt5Like, type SignalFn, type ContractSpec } from "./liveTrader.ts";
import { survivalStopDistance } from "./survivalStop.ts";
import type {
  Mt5Account,
  Mt5Position,
  Mt5Quote,
  Mt5Bar,
  Mt5OrderRequest,
  Mt5OrderResult,
} from "../../broker/mt5/bridgeClient.ts";

/**
 * MOCK Mt5Like — canned data, records placeOrder calls. Asserts no real network:
 * any unstubbed network would throw (these methods never touch fetch).
 */
class MockMt5 implements Mt5Like {
  placeOrderCalls: Mt5OrderRequest[] = [];

  constructor(
    private readonly state: {
      account: Mt5Account;
      positions: Mt5Position[];
      quote: Mt5Quote;
      bars: Mt5Bar[];
      orderResult?: Mt5OrderResult;
    },
  ) {}

  async account(): Promise<Mt5Account> {
    return this.state.account;
  }
  async positions(): Promise<Mt5Position[]> {
    return this.state.positions;
  }
  async quote(): Promise<Mt5Quote> {
    return this.state.quote;
  }
  async bars(): Promise<Mt5Bar[]> {
    return this.state.bars;
  }
  async placeOrder(req: Mt5OrderRequest): Promise<Mt5OrderResult> {
    this.placeOrderCalls.push(req);
    return this.state.orderResult ?? { executed: true, order: 12345 };
  }
}

const account = (equity: number): Mt5Account => ({
  login: 1,
  currency: "USD",
  balance: equity,
  equity,
  margin: 0,
  margin_free: equity,
  margin_level: 0,
  profit: 0,
  leverage: 100,
});

const quote = (bid: number, ask: number): Mt5Quote => ({
  symbol: "XAUUSD",
  bid,
  ask,
  last: (bid + ask) / 2,
  time: 1_700_000_000,
  live: true,
});

const bar = (close: number): Mt5Bar => ({
  time: 1_700_000_000,
  open: close,
  high: close,
  low: close,
  close,
  tickVolume: 1,
  spread: 1,
  realVolume: 0,
});

const SPEC: ContractSpec = { volume_min: 0.01, volume_step: 0.01, contractSize: 100 };

const longSignal: SignalFn = () => ({ side: "long", stopDistance: 10, targetDistance: 30 });

const baseOpts = (client: MockMt5) => ({
  client,
  symbols: ["XAUUSD"],
  signals: { XAUUSD: longSignal },
  contracts: { XAUUSD: SPEC },
  config: { execution: "taker" as const, barsLookback: 50, dailyLossKillPct: 0.08 },
  log: () => {},
});

const ORIGINAL_LIVE = process.env.GORDON_LIVE_TRADING;
afterEach(() => {
  if (ORIGINAL_LIVE === undefined) delete process.env.GORDON_LIVE_TRADING;
  else process.env.GORDON_LIVE_TRADING = ORIGINAL_LIVE;
});

describe("CompetitionLiveTrader", () => {
  it("places a buy with rounded lots + sl/tp on a flat symbol + long signal when armed", async () => {
    process.env.GORDON_LIVE_TRADING = "1";
    const client = new MockMt5({
      account: account(1_000_000),
      positions: [],
      quote: quote(2000, 2001),
      bars: [bar(2000)],
    });
    const trader = new CompetitionLiveTrader(baseOpts(client));

    const report = await trader.runCycle();

    expect(report.liveArmed).toBe(true);
    expect(report.ordersPlaced).toBe(1);
    expect(client.placeOrderCalls).toHaveLength(1);

    const order = client.placeOrderCalls[0]!;
    expect(order.side).toBe("buy");
    expect(order.type).toBe("market");
    // Lots snapped to volume_step (0.01) and a multiple of it.
    expect(order.volume).toBeGreaterThanOrEqual(SPEC.volume_min);
    expect(Math.round(order.volume / SPEC.volume_step)).toBeCloseTo(order.volume / SPEC.volume_step, 6);
    // SL below entry (ask 2001), TP above — long.
    expect(order.sl).toBeCloseTo(2001 - 10, 6);
    expect(order.tp).toBeCloseTo(2001 + 30, 6);
    expect(order.clientOrderId).toContain("XAUUSD");

    const placed = report.decisions.find((d) => d.symbol === "XAUUSD");
    expect(placed?.action).toBe("placed");
  });

  it("attaches an SL no looser than EITHER the strategy stop or the survival cap", async () => {
    process.env.GORDON_LIVE_TRADING = "1";
    const equity = 1_000_000;
    const client = new MockMt5({ account: account(equity), positions: [], quote: quote(2000, 2001), bars: [bar(2000)] });
    const trader = new CompetitionLiveTrader(baseOpts(client));
    await trader.runCycle();

    const order = client.placeOrderCalls[0]!;
    const entry = 2001; // long fills at ask
    const slDistance = entry - (order.sl as number);
    // never looser than the strategy stop (10)…
    expect(slDistance).toBeLessThanOrEqual(10 + 1e-6);
    // …and never looser than the survival stop derived from the ACTUAL placed notional.
    const survival = survivalStopDistance({ positionNotional: order.volume * (SPEC.contractSize ?? 1) * entry, equity });
    expect(slDistance).toBeLessThanOrEqual(entry * survival + 1e-6);
  });

  it("halts new entries when the daily-loss kill triggers", async () => {
    process.env.GORDON_LIVE_TRADING = "1";
    const client = new MockMt5({
      account: account(1_000_000),
      positions: [],
      quote: quote(2000, 2001),
      bars: [bar(2000)],
    });
    const trader = new CompetitionLiveTrader(baseOpts(client));

    // First cycle establishes the day-start equity baseline at 1,000,000.
    await trader.runCycle();
    client.placeOrderCalls = [];

    // Second cycle: equity dropped 10% (> 8% kill) → halt.
    (client as unknown as { state: { account: Mt5Account } }).state.account = account(900_000);
    const report = await trader.runCycle();

    expect(report.halted).toBe(true);
    expect(report.ordersPlaced).toBe(0);
    expect(client.placeOrderCalls).toHaveLength(0);
    expect(report.decisions.every((d) => d.action === "halted")).toBe(true);
  });

  it("does NOT call placeOrder when GORDON_LIVE_TRADING is unset (records dry decision)", async () => {
    delete process.env.GORDON_LIVE_TRADING;
    const client = new MockMt5({
      account: account(1_000_000),
      positions: [],
      quote: quote(2000, 2001),
      bars: [bar(2000)],
    });
    const trader = new CompetitionLiveTrader(baseOpts(client));

    const report = await trader.runCycle();

    expect(report.liveArmed).toBe(false);
    expect(report.ordersPlaced).toBe(0);
    expect(client.placeOrderCalls).toHaveLength(0);

    const dry = report.decisions.find((d) => d.symbol === "XAUUSD");
    expect(dry?.action).toBe("dry");
    expect(dry?.lots).toBeGreaterThan(0);
    expect(dry?.side).toBe("buy");
  });

  it("skips a symbol that already has an open position (no new entry)", async () => {
    process.env.GORDON_LIVE_TRADING = "1";
    const openPos: Mt5Position = {
      ticket: 7,
      symbol: "XAUUSD",
      type: 0,
      sideLabel: "long",
      volume: 1,
      price_open: 1990,
      price_current: 2000,
      profit: 10,
      sl: 0,
      tp: 0,
    };
    const client = new MockMt5({
      account: account(1_000_000),
      positions: [openPos],
      quote: quote(2000, 2001),
      bars: [bar(2000)],
    });
    const trader = new CompetitionLiveTrader(baseOpts(client));

    const report = await trader.runCycle();

    expect(report.ordersPlaced).toBe(0);
    expect(client.placeOrderCalls).toHaveLength(0);
    const skipped = report.decisions.find((d) => d.symbol === "XAUUSD");
    expect(skipped?.action).toBe("skipped");
    expect(skipped?.reason).toContain("already open");
    // Open notional reflected in the report.
    expect(report.openExposureNotional).toBeCloseTo(1 * 2000, 6);
  });
});
