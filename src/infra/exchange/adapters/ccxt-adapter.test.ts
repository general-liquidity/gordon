import { describe, it, expect, afterEach } from "bun:test";
import {
  CcxtAdapter,
  toCcxtSymbol,
  fromCcxtSymbol,
  DEFAULT_MAX_LEVERAGE,
} from "./ccxt-adapter.ts";
import {
  tripKillSwitch,
  resetAllKillSwitches,
} from "../../safety/killSwitches.ts";

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

  it("FAILS LOUD for sandbox on a no-sandbox exchange (no silent live)", () => {
    // CAPITAL-SAFETY: CCXT throws NotSupported on setSandboxMode for venues
    // without a sandbox (e.g. kraken). The adapter must REFUSE to construct
    // rather than silently run against LIVE while isSandbox=true.
    expect(() => new CcxtAdapter("kraken", { apiKey: "x", apiSecret: "x" }, true)).toThrow();
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

// =================== Tier 1 safety patches ===================

describe("CcxtAdapter — precision normalization (safety)", () => {
  it("placeOrder normalizes amount + price via CCXT's precision helpers", async () => {
    let receivedAmount: number | undefined;
    let receivedPrice: number | undefined;
    const mock = makeMockClient({
      markets: { "BTC/USDT": { precision: { amount: 6, price: 2 } } },
      loadMarkets: async () => ({ "BTC/USDT": {} }),
      amountToPrecision: (_symbol: string, amount: number) => amount.toFixed(6),
      priceToPrecision: (_symbol: string, price: number) => price.toFixed(2),
      createOrder: async (
        symbol: string,
        type: string,
        side: string,
        amount: number,
        price?: number,
      ) => {
        receivedAmount = amount;
        receivedPrice = price;
        return {
          id: "ord-1",
          symbol,
          type,
          side,
          amount,
          price,
          status: "open",
          filled: 0,
          cost: 0,
        };
      },
    });
    const adapter = CcxtAdapter.__forTesting("binance", mock);
    await adapter.placeOrder({
      symbol: "BTCUSDT",
      side: "BUY",
      type: "LIMIT",
      quantity: 0.123456789,
      price: 50000.999,
    });
    expect(receivedAmount).toBe(0.123457);
    expect(receivedPrice).toBe(50001);
  });

  it("placeOrder auto-generates a clientOrderId when caller doesn't supply", async () => {
    let receivedParams: Record<string, unknown> | undefined;
    const mock = makeMockClient({
      markets: { "BTC/USDT": {} },
      loadMarkets: async () => ({ "BTC/USDT": {} }),
      amountToPrecision: (_s: string, a: number) => String(a),
      priceToPrecision: (_s: string, p: number) => String(p),
      createOrder: async (
        symbol: string,
        type: string,
        side: string,
        amount: number,
        price: number | undefined,
        params?: Record<string, unknown>,
      ) => {
        receivedParams = params;
        return {
          id: "ord-1",
          symbol,
          type,
          side,
          amount,
          price,
          status: "open",
          filled: 0,
          cost: 0,
        };
      },
    });
    const adapter = CcxtAdapter.__forTesting("binance", mock);
    await adapter.placeOrder({
      symbol: "BTCUSDT",
      side: "BUY",
      type: "LIMIT",
      quantity: 0.1,
      price: 50000,
    });
    expect(receivedParams?.clientOrderId).toBeDefined();
    expect(String(receivedParams?.clientOrderId)).toMatch(/^gordon-[0-9a-f]{16}$/);
  });

  it("placeOrder uses caller-supplied clientOrderId when present", async () => {
    let receivedParams: Record<string, unknown> | undefined;
    const mock = makeMockClient({
      markets: { "BTC/USDT": {} },
      loadMarkets: async () => ({ "BTC/USDT": {} }),
      amountToPrecision: (_s: string, a: number) => String(a),
      priceToPrecision: (_s: string, p: number) => String(p),
      createOrder: async (
        symbol: string,
        type: string,
        side: string,
        amount: number,
        price: number | undefined,
        params?: Record<string, unknown>,
      ) => {
        receivedParams = params;
        return {
          id: "ord-1",
          symbol,
          type,
          side,
          amount,
          price,
          status: "open",
          filled: 0,
          cost: 0,
        };
      },
    });
    const adapter = CcxtAdapter.__forTesting("binance", mock);
    await adapter.placeOrder({
      symbol: "BTCUSDT",
      side: "BUY",
      type: "LIMIT",
      quantity: 0.1,
      price: 50000,
      newClientOrderId: "my-custom-id-123",
    });
    expect(receivedParams?.clientOrderId).toBe("my-custom-id-123");
  });
});

// =================== Tier 3 derivatives + margin + account + order-mgmt ===================

describe("CcxtAdapter — derivatives (ExchangeDerivatives)", () => {
  it("fetchFundingRate maps response", async () => {
    const mock = makeMockClient({
      fetchFundingRate: async (_symbol: string) => ({
        symbol: "BTC/USDT:USDT",
        fundingRate: 0.0001,
        nextFundingRate: 0.00012,
        nextFundingTimestamp: 1700000000000,
        timestamp: 1699999000000,
      }),
    });
    const adapter = CcxtAdapter.__forTesting("bybit", mock);
    const r = await adapter.fetchFundingRate("BTCUSDT");
    expect(r.fundingRate).toBe(0.0001);
    expect(r.nextFundingRate).toBe(0.00012);
  });

  it("fetchPositions maps each position", async () => {
    const mock = makeMockClient({
      fetchPositions: async () => [
        {
          symbol: "BTC/USDT:USDT",
          side: "long",
          contracts: 0.5,
          contractSize: 1,
          entryPrice: 50000,
          markPrice: 51000,
          notional: 25500,
          leverage: 10,
          liquidationPrice: 45000,
          marginMode: "isolated",
          unrealizedPnl: 500,
          percentage: 2.0,
          timestamp: Date.now(),
        },
      ],
    });
    const adapter = CcxtAdapter.__forTesting("bybit", mock);
    const positions = await adapter.fetchPositions();
    expect(positions).toHaveLength(1);
    expect(positions[0]!.side).toBe("long");
    expect(positions[0]!.leverage).toBe(10);
    expect(positions[0]!.marginMode).toBe("isolated");
    expect(positions[0]!.unrealizedPnl).toBe(500);
  });

  it("fetchPosition returns null when none open", async () => {
    const mock = makeMockClient({
      fetchPosition: async () => null,
    });
    const adapter = CcxtAdapter.__forTesting("bybit", mock);
    const p = await adapter.fetchPosition("BTCUSDT");
    expect(p).toBeNull();
  });

  it("setLeverage + setMarginMode call through", async () => {
    let leverageCall: { l?: number; s?: string } = {};
    let modeCall: { m?: string; s?: string } = {};
    const mock = makeMockClient({
      setLeverage: async (l: number, s: string) => {
        leverageCall = { l, s };
      },
      setMarginMode: async (m: string, s: string) => {
        modeCall = { m, s };
      },
    });
    const adapter = CcxtAdapter.__forTesting("bybit", mock, false, { maxLeverage: 20 });
    await adapter.setLeverage(10, "BTCUSDT");
    expect(leverageCall.l).toBe(10);
    expect(leverageCall.s).toBe("BTC/USDT");
    await adapter.setMarginMode("isolated", "BTCUSDT");
    expect(modeCall.m).toBe("isolated");
    expect(modeCall.s).toBe("BTC/USDT");
  });

  it("closePosition falls back to opposite-side market order when no native support", async () => {
    let placedSide: string | undefined;
    let placedAmount: number | undefined;
    const mock = makeMockClient({
      fetchPosition: async () => ({
        symbol: "BTC/USDT:USDT",
        side: "long",
        contracts: 0.5,
        contractSize: 1,
        entryPrice: 50000,
        markPrice: 51000,
        notional: 25500,
        leverage: 10,
        liquidationPrice: 45000,
        marginMode: "isolated",
        unrealizedPnl: 500,
        percentage: 2.0,
        timestamp: Date.now(),
      }),
      markets: { "BTC/USDT": {} },
      loadMarkets: async () => ({ "BTC/USDT": {} }),
      amountToPrecision: (_s: string, a: number) => String(a),
      priceToPrecision: (_s: string, p: number) => String(p),
      createOrder: async (symbol: string, type: string, side: string, amount: number) => {
        placedSide = side;
        placedAmount = amount;
        return { id: "close-1", symbol, type, side, amount, status: "closed", filled: amount, cost: 0 };
      },
    });
    const adapter = CcxtAdapter.__forTesting("bybit", mock);
    await adapter.closePosition("BTCUSDT");
    expect(placedSide).toBe("sell");
    expect(placedAmount).toBe(0.5);
  });
});

describe("CcxtAdapter — margin (ExchangeMargin)", () => {
  it("borrowCrossMargin calls through", async () => {
    let received: { c?: string; a?: number } = {};
    const mock = makeMockClient({
      borrowCrossMargin: async (c: string, a: number) => {
        received = { c, a };
        return { id: "loan-1", amount: a };
      },
    });
    const adapter = CcxtAdapter.__forTesting("bybit", mock);
    const r = await adapter.borrowCrossMargin("USDT", 1000);
    expect(received.c).toBe("USDT");
    expect(received.a).toBe(1000);
    expect(r.id).toBe("loan-1");
    expect(r.amount).toBe(1000);
  });

  it("repayMargin includes symbol when supplied", async () => {
    let received: { c?: string; a?: number; s?: string } = {};
    const mock = makeMockClient({
      repayMargin: async (c: string, a: number, s?: string) => {
        received = { c, a, s };
        return { id: "repay-1", amount: a };
      },
    });
    const adapter = CcxtAdapter.__forTesting("bybit", mock);
    await adapter.repayMargin("USDT", 500, "BTCUSDT");
    expect(received.s).toBe("BTC/USDT");
  });
});

describe("CcxtAdapter — account management", () => {
  it("transfer calls through", async () => {
    let received: { c?: string; a?: number; f?: string; t?: string } = {};
    const mock = makeMockClient({
      transfer: async (c: string, a: number, f: string, t: string) => {
        received = { c, a, f, t };
        return { id: "tx-1", status: "ok" };
      },
    });
    const adapter = CcxtAdapter.__forTesting("bybit", mock);
    const r = await adapter.transfer("USDT", 1000, "spot", "swap");
    expect(received.f).toBe("spot");
    expect(received.t).toBe("swap");
    expect(r.id).toBe("tx-1");
    expect(r.status).toBe("ok");
  });
});

describe("CcxtAdapter — order management", () => {
  it("createOrders uses native batch when available", async () => {
    let receivedBatch: unknown[] | undefined;
    const mock = makeMockClient({
      markets: { "BTC/USDT": {}, "ETH/USDT": {} },
      loadMarkets: async () => ({ "BTC/USDT": {}, "ETH/USDT": {} }),
      amountToPrecision: (_s: string, a: number) => String(a),
      priceToPrecision: (_s: string, p: number) => String(p),
      createOrders: async (orders: unknown[]) => {
        receivedBatch = orders;
        return orders.map((_, i) => ({
          id: `batch-${i}`,
          symbol: "BTC/USDT",
          side: "buy",
          type: "limit",
          status: "open",
          price: 50000,
          amount: 0.1,
          filled: 0,
          cost: 0,
        }));
      },
    });
    const adapter = CcxtAdapter.__forTesting("bybit", mock);
    const results = await adapter.createOrders([
      { symbol: "BTCUSDT", side: "BUY", type: "LIMIT", quantity: 0.1, price: 50000 },
      { symbol: "ETHUSDT", side: "BUY", type: "LIMIT", quantity: 1, price: 3000 },
    ]);
    expect(receivedBatch?.length).toBe(2);
    expect(results).toHaveLength(2);
  });

  it("createOrders falls back to sequential when native unavailable", async () => {
    let createCalls = 0;
    const mock = makeMockClient({
      markets: { "BTC/USDT": {} },
      loadMarkets: async () => ({ "BTC/USDT": {} }),
      amountToPrecision: (_s: string, a: number) => String(a),
      priceToPrecision: (_s: string, p: number) => String(p),
      createOrder: async (symbol: string, type: string, side: string, amount: number) => {
        createCalls++;
        return { id: `seq-${createCalls}`, symbol, type, side, amount, status: "open", filled: 0, cost: 0 };
      },
    });
    const adapter = CcxtAdapter.__forTesting("bybit", mock);
    await adapter.createOrders([
      { symbol: "BTCUSDT", side: "BUY", type: "LIMIT", quantity: 0.1, price: 50000 },
      { symbol: "BTCUSDT", side: "SELL", type: "LIMIT", quantity: 0.1, price: 60000 },
    ]);
    expect(createCalls).toBe(2);
  });

  it("cancelOrders uses native batch when available", async () => {
    let receivedIds: string[] | undefined;
    const mock = makeMockClient({
      cancelOrders: async (ids: string[]) => {
        receivedIds = ids;
        return {};
      },
    });
    const adapter = CcxtAdapter.__forTesting("bybit", mock);
    await adapter.cancelOrders(["1", "2", "3"], "BTCUSDT");
    expect(receivedIds).toEqual(["1", "2", "3"]);
  });
});

// =================== capability introspection ===================

describe("CcxtAdapter — capability introspection", () => {
  it("supports() reads CCXT's .has map", () => {
    const mock = {
      ...(makeMockClient() as Record<string, unknown>),
      has: { fetchPositions: true, fetchFundingRate: false, withdraw: true },
    };
    const adapter = CcxtAdapter.__forTesting("bybit", mock);
    expect(adapter.supports("fetchPositions")).toBe(true);
    expect(adapter.supports("fetchFundingRate")).toBe(false);
    expect(adapter.supports("withdraw")).toBe(true);
    expect(adapter.supports("nonexistent")).toBe(false);
  });

  it("getFeatures returns the .features object", () => {
    const features = { spot: { createOrder: { triggerPrice: true } } };
    const mock = {
      ...(makeMockClient() as Record<string, unknown>),
      features,
    };
    const adapter = CcxtAdapter.__forTesting("bybit", mock);
    expect(adapter.getFeatures()).toEqual(features);
  });
});

// =================== P1-5: kill-switch chokepoint ===================

describe("CcxtAdapter — kill-switch chokepoint (P1-5)", () => {
  afterEach(() => {
    resetAllKillSwitches("test cleanup of kill switches");
  });

  it("placeOrder rejects when a venue kill switch is tripped", async () => {
    const adapter = CcxtAdapter.__forTesting("binance", makeMockClient());
    tripKillSwitch({ scope: "venue", id: "ccxt:binance" }, "manual halt for test");
    await expect(
      adapter.placeOrder({ symbol: "BTCUSDT", side: "BUY", type: "MARKET", quantity: 0.1 }),
    ).rejects.toThrow(/kill switch/i);
  });

  it("placeOrder rejects when the firm-wide switch is tripped", async () => {
    const adapter = CcxtAdapter.__forTesting("binance", makeMockClient());
    tripKillSwitch({ scope: "firm" }, "firm-wide halt for test");
    await expect(
      adapter.placeOrder({ symbol: "BTCUSDT", side: "BUY", type: "MARKET", quantity: 0.1 }),
    ).rejects.toThrow();
  });

  it("placeOrder proceeds when no switch is tripped", async () => {
    const adapter = CcxtAdapter.__forTesting("binance", makeMockClient());
    const order = await adapter.placeOrder({
      symbol: "BTCUSDT",
      side: "BUY",
      type: "LIMIT",
      quantity: 0.1,
      price: 50000,
    });
    expect(order.orderId).toBe("order-123");
  });
});

// =================== P1-5b: setLeverage clamp ===================

describe("CcxtAdapter — setLeverage clamp (P1-5b)", () => {
  it("clamps a request above maxLeverage down to the cap", async () => {
    let leverageCall: number | undefined;
    const mock = makeMockClient({
      setLeverage: async (l: number, _s: string) => {
        leverageCall = l;
      },
    });
    const adapter = CcxtAdapter.__forTesting("bybit", mock, false, { maxLeverage: 10 });
    await adapter.setLeverage(125, "BTCUSDT");
    expect(leverageCall).toBe(10);
  });

  it("passes leverage through unchanged when below the cap", async () => {
    let leverageCall: number | undefined;
    const mock = makeMockClient({
      setLeverage: async (l: number, _s: string) => {
        leverageCall = l;
      },
    });
    const adapter = CcxtAdapter.__forTesting("bybit", mock, false, { maxLeverage: 10 });
    await adapter.setLeverage(5, "BTCUSDT");
    expect(leverageCall).toBe(5);
  });

  it("clamps to the conservative 5x default when no cap is explicitly configured", async () => {
    let leverageCall: number | undefined;
    const mock = makeMockClient({
      setLeverage: async (l: number, _s: string) => {
        leverageCall = l;
      },
    });
    const adapter = CcxtAdapter.__forTesting("bybit", mock);
    await adapter.setLeverage(125, "BTCUSDT");
    expect(leverageCall).toBe(DEFAULT_MAX_LEVERAGE);
    expect(leverageCall).toBe(5);
  });

  it("lets an explicit cap raise leverage above the 5x default", async () => {
    let leverageCall: number | undefined;
    const mock = makeMockClient({
      setLeverage: async (l: number, _s: string) => {
        leverageCall = l;
      },
    });
    const adapter = CcxtAdapter.__forTesting("bybit", mock, false, { maxLeverage: 20 });
    await adapter.setLeverage(20, "BTCUSDT");
    expect(leverageCall).toBe(20);
  });
});

// =================== P1-9: malformed-response guards ===================

describe("CcxtAdapter — malformed order responses throw (P1-9)", () => {
  it("throws when the order id is missing", async () => {
    const mock = makeMockClient({
      createOrder: async (symbol: string, type: string, side: string, amount: number, price?: number) => ({
        // no id
        symbol,
        type,
        side,
        amount,
        price: price ?? 50000,
        filled: 0,
        cost: 0,
        status: "open",
      }),
    });
    const adapter = CcxtAdapter.__forTesting("binance", mock);
    await expect(
      adapter.placeOrder({ symbol: "BTCUSDT", side: "BUY", type: "MARKET", quantity: 0.1 }),
    ).rejects.toThrow(/order id/i);
  });

  it("throws when status is missing", async () => {
    const mock = makeMockClient({
      createOrder: async (symbol: string, type: string, side: string, amount: number, price?: number) => ({
        id: "order-123",
        symbol,
        type,
        side,
        amount,
        price: price ?? 50000,
        filled: 0,
        cost: 0,
        // no status
      }),
    });
    const adapter = CcxtAdapter.__forTesting("binance", mock);
    await expect(
      adapter.placeOrder({ symbol: "BTCUSDT", side: "BUY", type: "MARKET", quantity: 0.1 }),
    ).rejects.toThrow(/status/i);
  });

  it("throws when filled coerces to NaN", async () => {
    const mock = makeMockClient({
      createOrder: async (symbol: string, type: string, side: string, amount: number, price?: number) => ({
        id: "order-123",
        symbol,
        type,
        side,
        amount,
        price: price ?? 50000,
        filled: "not-a-number",
        cost: 0,
        status: "open",
      }),
    });
    const adapter = CcxtAdapter.__forTesting("binance", mock);
    await expect(
      adapter.placeOrder({ symbol: "BTCUSDT", side: "BUY", type: "MARKET", quantity: 0.1 }),
    ).rejects.toThrow(/filled/i);
  });

  it("throws when price coerces to NaN", async () => {
    const mock = makeMockClient({
      createOrder: async (symbol: string, type: string, side: string, amount: number) => ({
        id: "order-123",
        symbol,
        type,
        side,
        amount,
        price: "garbage",
        filled: 0,
        cost: 0,
        status: "open",
      }),
    });
    const adapter = CcxtAdapter.__forTesting("binance", mock);
    await expect(
      adapter.placeOrder({ symbol: "BTCUSDT", side: "BUY", type: "MARKET", quantity: 0.1 }),
    ).rejects.toThrow(/price/i);
  });

  it("parses a well-formed order without throwing", async () => {
    const adapter = CcxtAdapter.__forTesting("binance", makeMockClient());
    const order = await adapter.placeOrder({
      symbol: "BTCUSDT",
      side: "BUY",
      type: "LIMIT",
      quantity: 0.1,
      price: 50000,
    });
    expect(order.orderId).toBe("order-123");
    expect(order.status).toBe("NEW");
  });

  it("getCandles throws on a malformed OHLC value", async () => {
    const mock = makeMockClient({
      fetchOHLCV: async () => [
        [Date.now(), 100, "bad-high", 90, 105, 1000],
      ],
    });
    const adapter = CcxtAdapter.__forTesting("binance", mock);
    await expect(adapter.getCandles("BTCUSDT", "1m", 1)).rejects.toThrow(/malformed OHLC/i);
  });
});
