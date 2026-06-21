import { afterEach, describe, expect, it } from "bun:test";
import { Mt5Adapter } from "./mt5.ts";
import { resetAllKillSwitches, tripKillSwitch } from "../../safety/killSwitches.ts";

const realFetch = globalThis.fetch;

/** Route the adapter's bridge calls to canned JSON by path. */
function stubBridge(routes: Record<string, unknown>) {
  globalThis.fetch = (async (url: string) => {
    const path = new URL(String(url)).pathname;
    const json = routes[path] ?? { error: `no stub for ${path}` };
    const status = (json as { error?: string }).error ? 404 : 200;
    return { ok: status === 200, status, text: async () => JSON.stringify(json) } as Response;
  }) as typeof fetch;
}

const adapter = new Mt5Adapter({ apiKey: "", apiSecret: "", baseUrl: "http://127.0.0.1:8788", paper: true });

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("Mt5Adapter", () => {
  it("maps account_info onto the normalized BrokerAccount", async () => {
    stubBridge({
      "/account": { login: 42, currency: "USD", balance: 1_000_000, equity: 1_002_500, margin: 5000, margin_free: 997_500 },
    });
    const a = await adapter.getAccount();
    expect(a.id).toBe("42");
    expect(a.cash).toBe(1_000_000);
    expect(a.portfolioValue).toBe(1_002_500); // equity
    expect(a.buyingPower).toBe(997_500); // free margin
  });

  it("maps positions with side, market value and unrealized P&L", async () => {
    stubBridge({
      "/positions": {
        positions: [
          { ticket: 1, symbol: "XAUUSD", type: 0, sideLabel: "long", volume: 2, price_open: 2000, price_current: 2010, profit: 20, sl: 0, tp: 0 },
        ],
      },
    });
    const [p] = await adapter.getPositions();
    expect(p!.side).toBe("long");
    expect(p!.marketValue).toBe(2 * 2010);
    expect(p!.unrealizedPl).toBe(20);
    expect(p!.unrealizedPlPercent).toBeCloseTo((20 / (2 * 2000)) * 100, 6);
  });

  it("maps the latest tick onto a BrokerQuote", async () => {
    stubBridge({ "/quote": { symbol: "EURUSD", bid: 1.1, ask: 1.1002, last: 1.1001, time: 1_700_000_000 } });
    const q = await adapter.getLatestQuote("EURUSD");
    expect(q.bidPrice).toBe(1.1);
    expect(q.askPrice).toBe(1.1002);
    expect(q.timestamp).toBe(new Date(1_700_000_000 * 1000).toISOString());
  });

  it("maps bars onto Candles (ms openTime, tick volume)", async () => {
    stubBridge({
      "/bars": { bars: [{ time: 1_700_000_000, open: 1, high: 2, low: 0.5, close: 1.5, tickVolume: 99, spread: 2, realVolume: 0 }] },
    });
    const [c] = await adapter.getHistoricalBars({ symbol: "XAUUSD", timeframe: "15m", startTime: 0, endTime: 1, limit: 1 });
    expect(c!.close).toBe(1.5);
    expect(c!.volume).toBe(99);
    expect(c!.openTime).toBe(1_700_000_000 * 1000);
  });

  it("placeOrder: a filled market order maps to a filled BrokerOrder", async () => {
    stubBridge({ "/order": { executed: true, retcode: 10009, order: 777, volume: 0.1 } });
    const o = await adapter.placeOrder({
      symbol: "XAUUSD", side: "buy", type: "market", timeInForce: "gtc", qty: 0.1, clientOrderId: "abc",
    });
    expect(o.id).toBe("777");
    expect(o.status).toBe("filled");
    expect(o.filledQty).toBe(0.1);
    expect(o.clientOrderId).toBe("abc");
  });

  it("placeOrder: the sidecar trading guard surfaces as a thrown, actionable error", async () => {
    stubBridge({ "/order": { executed: false, guard: "trading-disabled" } });
    await expect(
      adapter.placeOrder({ symbol: "XAUUSD", side: "buy", type: "market", timeInForce: "gtc", qty: 0.1 }),
    ).rejects.toThrow(/MT5_BRIDGE_ALLOW_TRADING/);
  });

  it("placeOrder: rejects when a venue kill switch is tripped, and passes once reset", async () => {
    stubBridge({ "/order": { executed: true, retcode: 10009, order: 778, volume: 0.1 } });
    const order = { symbol: "XAUUSD", side: "buy" as const, type: "market" as const, timeInForce: "gtc" as const, qty: 0.1 };

    tripKillSwitch({ scope: "venue", id: "mt5" }, "manual halt for test");
    try {
      await expect(adapter.placeOrder(order)).rejects.toThrow(/kill switch/i);
    } finally {
      resetAllKillSwitches("test cleanup of venue switch");
    }

    // Untripped: the same order goes through.
    const o = await adapter.placeOrder(order);
    expect(o.id).toBe("778");
    expect(o.status).toBe("filled");
  });

  it("placeOrder: rejects when a firm-wide kill switch is tripped", async () => {
    stubBridge({ "/order": { executed: true, retcode: 10009, order: 779, volume: 0.1 } });
    tripKillSwitch({ scope: "firm" }, "firm-wide halt for test");
    try {
      await expect(
        adapter.placeOrder({ symbol: "EURUSD", side: "sell", type: "market", timeInForce: "gtc", qty: 0.1 }),
      ).rejects.toThrow(/Reset the relevant kill switch/);
    } finally {
      resetAllKillSwitches("test cleanup of firm switch");
    }
  });

  it("testConnection reflects bridge health", async () => {
    stubBridge({ "/health": { ok: true, tradingEnabled: false } });
    expect(await adapter.testConnection()).toBe(true);
  });
});
