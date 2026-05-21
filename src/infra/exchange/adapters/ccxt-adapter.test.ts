import { describe, it, expect } from "bun:test";
import {
  CcxtAdapter,
  toCcxtSymbol,
  fromCcxtSymbol,
} from "./ccxt-adapter.ts";

// =================== symbol normalization ===================

describe("toCcxtSymbol", () => {
  it("inserts slash for common USDT-quoted symbols", () => {
    expect(toCcxtSymbol("BTCUSDT")).toBe("BTC/USDT");
    expect(toCcxtSymbol("ETHUSDT")).toBe("ETH/USDT");
    expect(toCcxtSymbol("SOLUSDT")).toBe("SOL/USDT");
  });

  it("handles USDC, BTC, ETH, EUR, USD quotes", () => {
    expect(toCcxtSymbol("ETHUSDC")).toBe("ETH/USDC");
    expect(toCcxtSymbol("ETHBTC")).toBe("ETH/BTC");
    expect(toCcxtSymbol("ARBETH")).toBe("ARB/ETH");
    expect(toCcxtSymbol("BTCEUR")).toBe("BTC/EUR");
    expect(toCcxtSymbol("BTCUSD")).toBe("BTC/USD");
  });

  it("passes through already-slashed symbols", () => {
    expect(toCcxtSymbol("BTC/USDT")).toBe("BTC/USDT");
    expect(toCcxtSymbol("ETH/USD")).toBe("ETH/USD");
  });

  it("falls through unchanged when no common quote suffix matches", () => {
    expect(toCcxtSymbol("UNKNOWN")).toBe("UNKNOWN");
  });
});

describe("fromCcxtSymbol", () => {
  it("removes slash from CCXT-style symbols", () => {
    expect(fromCcxtSymbol("BTC/USDT")).toBe("BTCUSDT");
    expect(fromCcxtSymbol("ETH/USDC")).toBe("ETHUSDC");
  });

  it("passes through non-slashed symbols", () => {
    expect(fromCcxtSymbol("BTCUSDT")).toBe("BTCUSDT");
  });
});

// =================== adapter construction ===================

describe("CcxtAdapter construction", () => {
  it("throws on invalid CCXT sub-id", () => {
    expect(() => new CcxtAdapter("not_a_real_exchange", {})).toThrow();
  });

  it("constructs for a real CCXT exchange (binance)", () => {
    const adapter = new CcxtAdapter("binance", {});
    expect(adapter.exchangeId).toBe("ccxt:binance");
    expect(adapter.displayName).toContain("binance");
    expect(adapter.ccxtSubId).toBe("binance");
    expect(adapter.isSandbox).toBe(false);
  });

  it("constructs in sandbox mode for sandbox-capable exchanges (binance)", () => {
    const adapter = new CcxtAdapter("binance", { apiKey: "test", apiSecret: "test" }, true);
    expect(adapter.isSandbox).toBe(true);
  });

  it("doesn't throw for sandbox on a no-sandbox exchange (gracefully degrades)", () => {
    // Many CCXT exchanges throw NotSupported on setSandboxMode — adapter
    // catches that and continues. Live behavior is opt-in via construction.
    expect(() => new CcxtAdapter("kraken", { apiKey: "x", apiSecret: "x" }, true)).not.toThrow();
  });
});

// =================== mocked behavior ===================

function makeMockClient(overrides: Record<string, unknown> = {}): unknown {
  return {
    rateLimit: 100,
    has: { withdraw: false, fetchDepositAddress: false },
    loadMarkets: async () => ({}),
    fetchTicker: async (_symbol: string) => ({ last: 50000, close: 50000 }),
    fetchTickers: async () => ({
      "BTC/USDT": {
        symbol: "BTC/USDT",
        last: 50000,
        high: 51000,
        low: 49000,
        change: 1000,
        percentage: 2.0,
        baseVolume: 1000,
        quoteVolume: 50_000_000,
        timestamp: Date.now(),
      },
    }),
    fetchOHLCV: async (_symbol: string, _interval: string, _since?: number, limit?: number) => {
      const now = Date.now();
      return Array.from({ length: limit ?? 5 }, (_, i) => [
        now - (limit! - i) * 60_000,
        100,
        110,
        90,
        105,
        1000,
      ]);
    },
    fetchOrderBook: async (_symbol: string, _limit?: number) => ({
      timestamp: Date.now(),
      bids: [[49990, 1.5], [49980, 2.0], [49970, 3.0]],
      asks: [[50010, 1.2], [50020, 2.5], [50030, 3.1]],
    }),
    fetchBalance: async () => ({
      free: { USDT: 5000, BTC: 0.1 },
      used: { USDT: 100, BTC: 0 },
      total: { USDT: 5100, BTC: 0.1 },
    }),
    createOrder: async (symbol: string, type: string, side: string, amount: number, price?: number) => ({
      id: "order-123",
      symbol,
      type,
      side,
      amount,
      price: price ?? 50000,
      filled: 0,
      cost: 0,
      status: "open",
      timestamp: Date.now(),
    }),
    cancelOrder: async (_orderId: string, _symbol?: string) => ({ id: "order-123" }),
    fetchOpenOrders: async (_symbol?: string) => [
      { id: "order-456", symbol: "BTC/USDT", side: "buy", type: "limit", price: 48000, amount: 0.05, filled: 0, cost: 0, status: "open" },
    ],
    fetchOrder: async (orderId: string, _symbol?: string) => ({
      id: orderId,
      symbol: "BTC/USDT",
      side: "buy",
      type: "limit",
      status: "open",
      price: 48000,
      amount: 0.05,
      filled: 0,
      cost: 0,
    }),
    fetchClosedOrders: async () => [],
    fetchMyTrades: async () => [],
    fetchDeposits: async () => [],
    fetchWithdrawals: async () => [],
    fetchCurrencies: async () => ({}),
    setSandboxMode: () => {},
    ...overrides,
  };
}

describe("CcxtAdapter — market data (mocked)", () => {
  it("getPrice returns ticker.last", async () => {
    const adapter = CcxtAdapter.__forTesting("binance", makeMockClient());
    const price = await adapter.getPrice("BTCUSDT");
    expect(price).toBe(50000);
  });

  it("getCandles maps OHLCV with synthesized closeTime", async () => {
    const adapter = CcxtAdapter.__forTesting("binance", makeMockClient());
    const candles = await adapter.getCandles("BTCUSDT", "1m", 5);
    expect(candles).toHaveLength(5);
    expect(candles[0]!.open).toBe(100);
    expect(candles[0]!.high).toBe(110);
    expect(candles[0]!.low).toBe(90);
    expect(candles[0]!.close).toBe(105);
    expect(candles[0]!.volume).toBe(1000);
    expect(candles[0]!.closeTime).toBe(candles[0]!.openTime + 60_000 - 1);
  });

  it("getOrderBook maps bids/asks tuples", async () => {
    const adapter = CcxtAdapter.__forTesting("binance", makeMockClient());
    const ob = await adapter.getOrderBook("BTCUSDT");
    expect(ob.bids[0]).toEqual({ price: 49990, quantity: 1.5 });
    expect(ob.asks[0]).toEqual({ price: 50010, quantity: 1.2 });
  });

  it("getBookTicker returns first bid + ask", async () => {
    const adapter = CcxtAdapter.__forTesting("binance", makeMockClient());
    const bt = await adapter.getBookTicker("BTCUSDT");
    expect(bt.bidPrice).toBe(49990);
    expect(bt.askPrice).toBe(50010);
  });

  it("getSpread computes from top-of-book", async () => {
    const adapter = CcxtAdapter.__forTesting("binance", makeMockClient());
    const s = await adapter.getSpread("BTCUSDT");
    expect(s.spread).toBeCloseTo(20, 5);
    expect(s.spreadPercent).toBeGreaterThan(0);
  });

  it("get24hrTickers maps every ticker", async () => {
    const adapter = CcxtAdapter.__forTesting("binance", makeMockClient());
    const tickers = await adapter.get24hrTickers();
    expect(tickers).toHaveLength(1);
    expect(tickers[0]!.lastPrice).toBe(50000);
    expect(tickers[0]!.priceChangePercent).toBe(2);
  });

  it("getTopSymbols sorts by quoteVolume descending", async () => {
    const mock = makeMockClient({
      fetchTickers: async () => ({
        "BTC/USDT": { symbol: "BTC/USDT", quoteVolume: 50_000_000, last: 50000 },
        "ETH/USDT": { symbol: "ETH/USDT", quoteVolume: 30_000_000, last: 3000 },
        "SOL/USDT": { symbol: "SOL/USDT", quoteVolume: 10_000_000, last: 100 },
      }),
    });
    const adapter = CcxtAdapter.__forTesting("binance", mock);
    const tops = await adapter.getTopSymbols(2);
    expect(tops).toEqual(["BTC/USDT", "ETH/USDT"]);
  });
});

describe("CcxtAdapter — account (mocked)", () => {
  it("getAccountInfo aggregates balances", async () => {
    const adapter = CcxtAdapter.__forTesting("binance", makeMockClient());
    const info = await adapter.getAccountInfo();
    expect(info.balances).toHaveLength(2);
    const usdt = info.balances.find((b) => b.asset === "USDT");
    expect(usdt?.total).toBe(5100);
    expect(usdt?.free).toBe(5000);
    expect(usdt?.locked).toBe(100);
  });

  it("getBalance returns asset total", async () => {
    const adapter = CcxtAdapter.__forTesting("binance", makeMockClient());
    expect(await adapter.getBalance("USDT")).toBe(5100);
    expect(await adapter.getBalance("UNKNOWN")).toBe(0);
  });

  it("getAllBalances returns non-zero only", async () => {
    const mock = makeMockClient({
      fetchBalance: async () => ({
        free: { USDT: 100, ZERO: 0 },
        used: { USDT: 0, ZERO: 0 },
        total: { USDT: 100, ZERO: 0 },
      }),
    });
    const adapter = CcxtAdapter.__forTesting("binance", mock);
    const balances = await adapter.getAllBalances();
    expect(balances.map((b) => b.asset)).toEqual(["USDT"]);
  });
});

describe("CcxtAdapter — trading (mocked)", () => {
  it("placeOrder maps params to CCXT + normalizes response", async () => {
    const adapter = CcxtAdapter.__forTesting("binance", makeMockClient());
    const order = await adapter.placeOrder({
      symbol: "BTCUSDT",
      side: "BUY",
      type: "LIMIT",
      quantity: 0.1,
      price: 50000,
    });
    expect(order.orderId).toBe("order-123");
    expect(order.side).toBe("BUY");
    expect(order.type).toBe("LIMIT");
    expect(order.status).toBe("NEW");
  });

  it("getOpenOrders maps each", async () => {
    const adapter = CcxtAdapter.__forTesting("binance", makeMockClient());
    const orders = await adapter.getOpenOrders("BTCUSDT");
    expect(orders).toHaveLength(1);
    expect(orders[0]!.orderId).toBe("order-456");
    expect(orders[0]!.side).toBe("BUY");
  });

  it("getOrderStatus maps a single order", async () => {
    const adapter = CcxtAdapter.__forTesting("binance", makeMockClient());
    const order = await adapter.getOrderStatus("BTCUSDT", "order-789");
    expect(order.orderId).toBe("order-789");
  });

  it("cancelOrder calls through without throwing", async () => {
    let calledWith: { orderId?: string; symbol?: string } = {};
    const mock = makeMockClient({
      cancelOrder: async (orderId: string, symbol: string) => {
        calledWith = { orderId, symbol };
        return { id: orderId };
      },
    });
    const adapter = CcxtAdapter.__forTesting("binance", mock);
    await adapter.cancelOrder("BTCUSDT", "order-x");
    expect(calledWith.orderId).toBe("order-x");
    expect(calledWith.symbol).toBe("BTC/USDT");
  });

  it("cancelAllOrders falls back to per-order cancel when no native support", async () => {
    let cancelCalls = 0;
    const mock = makeMockClient({
      has: { cancelAllOrders: false },
      fetchOpenOrders: async () => [
        { id: "1", symbol: "BTC/USDT", side: "buy", status: "open", price: 50000, amount: 0.1, filled: 0, cost: 0 },
        { id: "2", symbol: "BTC/USDT", side: "sell", status: "open", price: 60000, amount: 0.1, filled: 0, cost: 0 },
      ],
      cancelOrder: async () => {
        cancelCalls++;
        return {};
      },
    });
    const adapter = CcxtAdapter.__forTesting("binance", mock);
    const cancelled = await adapter.cancelAllOrders("BTCUSDT");
    expect(cancelCalls).toBe(2);
    expect(cancelled.length).toBe(2);
  });

  it("testOrder always returns true (CCXT has no unified test-order)", async () => {
    const adapter = CcxtAdapter.__forTesting("binance", makeMockClient());
    const ok = await adapter.testOrder({
      symbol: "BTCUSDT",
      side: "BUY",
      type: "LIMIT",
      quantity: 0.1,
      price: 50000,
    });
    expect(ok).toBe(true);
  });
});

// =================== circuit breaker + rate limit ===================

describe("CcxtAdapter — circuit breaker", () => {
  it("opens after 3 consecutive failures", async () => {
    const failingMock = {
      ...(makeMockClient() as Record<string, unknown>),
      fetchTicker: async () => {
        throw new Error("upstream busted");
      },
    };
    const adapter = CcxtAdapter.__forTesting("binance", failingMock);
    expect(adapter.getCircuitBreakerState()).toBe("closed");
    for (let i = 0; i < 3; i++) {
      try { await adapter.getPrice("BTCUSDT"); } catch { /* expected */ }
    }
    expect(adapter.getCircuitBreakerState()).toBe("open");
  });

  it("resetCircuitBreaker restores closed state", async () => {
    const failingMock = {
      ...(makeMockClient() as Record<string, unknown>),
      fetchTicker: async () => { throw new Error("boom"); },
    };
    const adapter = CcxtAdapter.__forTesting("binance", failingMock);
    for (let i = 0; i < 3; i++) {
      try { await adapter.getPrice("BTCUSDT"); } catch { /* */ }
    }
    expect(adapter.getCircuitBreakerState()).toBe("open");
    adapter.resetCircuitBreaker();
    expect(adapter.getCircuitBreakerState()).toBe("closed");
  });
});

describe("CcxtAdapter — rate limit status", () => {
  it("returns a synthesized status with budget + usage", () => {
    const adapter = CcxtAdapter.__forTesting("binance", makeMockClient());
    const status = adapter.getRateLimitStatus();
    expect(status.maxWeight).toBeGreaterThan(0);
    expect(status.currentWeight).toBe(0);
    expect(status.usagePercent).toBe(0);
  });

  it("shouldThrottle returns true when circuit is open", async () => {
    const failingMock = {
      ...(makeMockClient() as Record<string, unknown>),
      fetchTicker: async () => { throw new Error("boom"); },
    };
    const adapter = CcxtAdapter.__forTesting("binance", failingMock);
    for (let i = 0; i < 3; i++) {
      try { await adapter.getPrice("BTCUSDT"); } catch { /* */ }
    }
    expect(adapter.shouldThrottle()).toBe(true);
  });
});

// =================== factory wiring ===================

describe("ExchangeId routing — ccxt:* prefix", () => {
  it("isCcxtExchangeId recognizes ccxt: prefix", async () => {
    const { isCcxtExchangeId, extractCcxtSubId } = await import("../types.ts");
    expect(isCcxtExchangeId("ccxt:bybit")).toBe(true);
    expect(isCcxtExchangeId("ccxt:kucoin")).toBe(true);
    expect(isCcxtExchangeId("binance")).toBe(false);
    expect(extractCcxtSubId("ccxt:bybit")).toBe("bybit");
  });
});
