/**
 * Gemini Exchange Adapter
 * Wraps GeminiClient to implement the abstract Exchange interface.
 *
 * Supports OAuth 2.0 (preferred, zero-key onboarding) or HMAC API keys.
 */

import { GeminiClient } from "../../venues/exchange/clients/gemini/index.ts";
import type {
  GeminiOrder,
  GeminiNewOrderRequest,
  GeminiTimeframe,
} from "../../venues/exchange/clients/gemini/index.ts";
import type {
  Exchange,
  ExchangeId,
  ExchangeInfo,
  Ticker24hr,
  OrderBook,
  BookTicker,
  SpreadInfo,
  AvgPrice,
  AccountInfo,
  AccountDetails,
  Balance,
  OrderParams,
  Order,
  Trade,
  Deposit,
  Withdrawal,
  RateLimitStatus,
  SymbolInfo,
  OrderType,
  OrderStatus,
  WithdrawalResult,
  WithdrawalInfo,
} from "../types.ts";
import type { Candle } from "../../../types/index.ts";

const INTERVAL_MAP: Record<string, GeminiTimeframe> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "1h": "1hr",
  "1hr": "1hr",
  "6h": "6hr",
  "6hr": "6hr",
  "1d": "1day",
  "1D": "1day",
  "1day": "1day",
};

function intervalMs(interval: string): number {
  const map: Record<string, number> = {
    "1m": 60_000,
    "5m": 300_000,
    "15m": 900_000,
    "30m": 1_800_000,
    "1h": 3_600_000,
    "1hr": 3_600_000,
    "6h": 21_600_000,
    "6hr": 21_600_000,
    "1d": 86_400_000,
    "1D": 86_400_000,
    "1day": 86_400_000,
  };
  return map[interval] ?? 3_600_000;
}

/** Gemini symbol format is lowercase concat (e.g. "btcusd"); Gordon uses "BTCUSD". */
function toGeminiSymbol(symbol: string): string {
  return symbol.toLowerCase().replace(/[-_/]/g, "");
}
function fromGeminiSymbol(symbol: string): string {
  return symbol.toUpperCase();
}

export class GeminiAdapter implements Exchange {
  readonly exchangeId: ExchangeId = "gemini";
  readonly displayName = "Gemini";
  readonly isSandbox: boolean;

  private client: GeminiClient;

  constructor(config: {
    accessToken?: string;
    apiKey?: string;
    apiSecret?: string;
    sandbox?: boolean;
  }) {
    this.isSandbox = config.sandbox ?? false;
    this.client = new GeminiClient(config);
  }

  // ──────────────────────────── Connection & info ────────────────────────────

  async testConnection(): Promise<boolean> {
    return this.client.testConnection();
  }

  async getExchangeInfo(): Promise<ExchangeInfo> {
    const symbols = await this.client.getSymbols();
    return {
      timezone: "UTC",
      serverTime: Date.now(),
      symbols: symbols.map((sym): SymbolInfo => {
        const upper = sym.toUpperCase();
        // Infer base/quote from trailing currency suffix
        const quoteAssets = ["USD", "USDT", "USDC", "EUR", "GBP", "BTC", "ETH", "DAI", "GUSD"];
        let baseAsset = upper;
        let quoteAsset = "USD";
        for (const q of quoteAssets) {
          if (upper.endsWith(q)) {
            baseAsset = upper.slice(0, -q.length);
            quoteAsset = q;
            break;
          }
        }
        return {
          symbol: upper,
          status: "TRADING",
          baseAsset,
          quoteAsset,
          baseAssetPrecision: 8,
          quoteAssetPrecision: 2,
          orderTypes: ["MARKET", "LIMIT", "STOP_LOSS_LIMIT"] as OrderType[],
          isSpotTradingAllowed: true,
          filters: [],
        };
      }),
    };
  }

  // ──────────────────────────── Market data ────────────────────────────

  async getPrice(symbol: string): Promise<number> {
    const t = await this.client.getTicker(toGeminiSymbol(symbol));
    return parseFloat(t.last);
  }

  async getCandles(symbol: string, interval: string, limit?: number): Promise<Candle[]> {
    const timeframe = INTERVAL_MAP[interval] ?? "1hr";
    const raw = await this.client.getCandles(toGeminiSymbol(symbol), timeframe);
    const delta = intervalMs(interval);
    // Gemini returns newest first
    const ordered = [...raw].reverse();
    const trimmed = limit ? ordered.slice(-limit) : ordered;
    return trimmed.map(([ts, open, high, low, close, volume]) => ({
      openTime: ts,
      open,
      high,
      low,
      close,
      volume,
      closeTime: ts + delta,
    }));
  }

  async get24hrTickers(): Promise<Ticker24hr[]> {
    // Gemini does not expose a batch 24hr-ticker endpoint; fetch top USD pairs.
    const symbols = await this.client.getSymbols();
    const usdPairs = symbols.filter((s) => s.endsWith("usd")).slice(0, 40);
    const results: Ticker24hr[] = [];
    for (const sym of usdPairs) {
      try {
        const v2 = await this.client.getTickerV2(sym);
        const open = parseFloat(v2.open);
        const close = parseFloat(v2.close);
        const change = close - open;
        const pct = open > 0 ? (change / open) * 100 : 0;
        results.push({
          symbol: fromGeminiSymbol(sym),
          priceChange: change,
          priceChangePercent: pct,
          lastPrice: close,
          highPrice: parseFloat(v2.high),
          lowPrice: parseFloat(v2.low),
          volume: 0,
          quoteVolume: 0,
          openTime: Date.now() - 86_400_000,
          closeTime: Date.now(),
        });
      } catch {
        // Skip failing pairs rather than aborting the batch.
      }
    }
    return results;
  }

  async getTopSymbols(n: number): Promise<string[]> {
    const tickers = await this.get24hrTickers();
    return tickers
      .sort((a, b) => Math.abs(b.priceChangePercent) - Math.abs(a.priceChangePercent))
      .slice(0, n)
      .map((t) => t.symbol);
  }

  async getOrderBook(symbol: string, limit?: number): Promise<OrderBook> {
    const book = await this.client.getOrderBook(toGeminiSymbol(symbol), limit ?? 50, limit ?? 50);
    return {
      lastUpdateId: Date.now(),
      bids: book.bids.map((b) => ({ price: parseFloat(b.price), quantity: parseFloat(b.amount) })),
      asks: book.asks.map((a) => ({ price: parseFloat(a.price), quantity: parseFloat(a.amount) })),
    };
  }

  async getBookTicker(symbol: string): Promise<BookTicker> {
    const t = await this.client.getTicker(toGeminiSymbol(symbol));
    return {
      symbol,
      bidPrice: parseFloat(t.bid),
      bidQty: 0,
      askPrice: parseFloat(t.ask),
      askQty: 0,
    };
  }

  async getSpread(symbol: string): Promise<SpreadInfo> {
    const t = await this.getBookTicker(symbol);
    const spread = t.askPrice - t.bidPrice;
    const mid = (t.askPrice + t.bidPrice) / 2;
    return {
      spread,
      spreadPercent: mid > 0 ? (spread / mid) * 100 : 0,
      bidPrice: t.bidPrice,
      askPrice: t.askPrice,
    };
  }

  async getAvgPrice(symbol: string): Promise<AvgPrice> {
    try {
      const candles = await this.getCandles(symbol, "5m", 6);
      let vSum = 0, pvSum = 0;
      for (const c of candles) {
        const typical = (c.high + c.low + c.close) / 3;
        pvSum += typical * c.volume;
        vSum += c.volume;
      }
      if (vSum > 0) return { mins: 30, price: pvSum / vSum };
    } catch {
      // fall through
    }
    return { mins: 5, price: await this.getPrice(symbol) };
  }

  // ──────────────────────────── Account ────────────────────────────

  async getAccountInfo(): Promise<AccountInfo> {
    const balances = await this.client.getBalances();
    return {
      canTrade: true,
      canWithdraw: true,
      canDeposit: true,
      accountType: "SPOT",
      updateTime: Date.now(),
      balances: balances.map((b): Balance => {
        const total = parseFloat(b.amount);
        const free = parseFloat(b.available);
        return {
          asset: b.currency.toUpperCase(),
          free,
          locked: total - free,
          total,
        };
      }),
    };
  }

  async getBalance(asset: string): Promise<number> {
    const info = await this.getAccountInfo();
    const entry = info.balances.find((b) => b.asset === asset.toUpperCase());
    return entry?.total ?? 0;
  }

  async getAllBalances(): Promise<Balance[]> {
    const info = await this.getAccountInfo();
    return info.balances.filter((b) => b.total > 0);
  }

  async getFullAccountDetails(): Promise<AccountDetails> {
    const info = await this.getAccountInfo();
    const nonZero = info.balances.filter((b) => b.total > 0);
    const stableUsd = nonZero
      .filter((b) => ["USD", "USDT", "USDC", "GUSD", "DAI"].includes(b.asset))
      .reduce((sum, b) => sum + b.total, 0);
    return { accountInfo: info, totalUsdtValue: stableUsd, nonZeroBalances: nonZero };
  }

  // ──────────────────────────── Trading ────────────────────────────

  async placeOrder(params: OrderParams): Promise<Order> {
    if (params.type === "MARKET") {
      throw new Error(
        "Gemini does not support plain market orders. Use a LIMIT with immediate-or-cancel (IOC) instead.",
      );
    }

    const req: GeminiNewOrderRequest = {
      client_order_id: params.newClientOrderId,
      symbol: toGeminiSymbol(params.symbol),
      amount: String(params.quantity ?? 0),
      price: String(params.price ?? 0),
      side: params.side === "BUY" ? "buy" : "sell",
      type: params.type === "STOP_LOSS_LIMIT" ? "exchange stop limit" : "exchange limit",
    };

    if (params.type === "STOP_LOSS_LIMIT" && params.stopPrice) {
      req.stop_price = String(params.stopPrice);
    }

    const options: ("maker-or-cancel" | "immediate-or-cancel" | "fill-or-kill")[] = [];
    if (params.timeInForce === "IOC") options.push("immediate-or-cancel");
    if (params.timeInForce === "FOK") options.push("fill-or-kill");
    if (options.length) req.options = options;

    const result = await this.client.placeOrder(req);
    return this.normalizeOrder(result);
  }

  async cancelOrder(_symbol: string, orderId: string): Promise<void> {
    await this.client.cancelOrder(orderId);
  }

  async cancelAllOrders(symbol: string): Promise<Order[]> {
    const open = await this.getOpenOrders(symbol);
    await this.client.cancelAllActiveOrders();
    return open;
  }

  async getOpenOrders(symbol?: string): Promise<Order[]> {
    const orders = await this.client.getActiveOrders();
    const filtered = symbol
      ? orders.filter((o) => fromGeminiSymbol(o.symbol) === symbol.toUpperCase())
      : orders;
    return filtered.map((o) => this.normalizeOrder(o));
  }

  async getOrderStatus(_symbol: string, orderId: number | string): Promise<Order> {
    const result = await this.client.getOrderStatus(String(orderId));
    return this.normalizeOrder(result);
  }

  async testOrder(params: OrderParams): Promise<boolean> {
    // Gemini has no test-order endpoint; local validation only.
    if (!params.symbol || !params.side || !params.type) return false;
    if (params.type === "LIMIT" && (!params.price || params.price <= 0)) return false;
    if (!params.quantity || params.quantity <= 0) return false;
    return true;
  }

  private normalizeOrder(o: GeminiOrder): Order {
    const price = parseFloat(o.price) || 0;
    const executed = parseFloat(o.executed_amount) || 0;
    const original = parseFloat(o.original_amount) || 0;
    const avg = parseFloat(o.avg_execution_price) || 0;

    let status: OrderStatus = "NEW";
    if (o.is_cancelled) status = "CANCELED";
    else if (!o.is_live && executed >= original) status = "FILLED";
    else if (executed > 0 && executed < original) status = "PARTIALLY_FILLED";
    else if (!o.is_live) status = "EXPIRED";

    const type: OrderType = o.type.toLowerCase().includes("stop")
      ? "STOP_LOSS_LIMIT"
      : "LIMIT";

    return {
      orderId: o.order_id,
      clientOrderId: o.client_order_id,
      symbol: fromGeminiSymbol(o.symbol),
      side: o.side === "buy" ? "BUY" : "SELL",
      type,
      status,
      price,
      quantity: original,
      executedQty: executed,
      cummulativeQuoteQty: executed * avg,
      time: o.timestampms,
      updateTime: o.timestampms,
      isWorking: o.is_live,
    };
  }

  // ──────────────────────────── History ────────────────────────────

  async getTradeHistory(symbol: string, limit?: number): Promise<Trade[]> {
    const trades = await this.client.getMyTrades(toGeminiSymbol(symbol), limit ?? 50);
    return trades.map((t): Trade => ({
      id: String(t.tid),
      orderId: t.order_id,
      symbol,
      side: t.type === "Buy" ? "BUY" : "SELL",
      price: parseFloat(t.price),
      quantity: parseFloat(t.amount),
      commission: parseFloat(t.fee_amount),
      commissionAsset: t.fee_currency,
      time: t.timestampms,
      isMaker: !t.aggressor,
    }));
  }

  async getOrderHistory(symbol: string, _limit?: number): Promise<Order[]> {
    // Gemini provides /v1/orders/history via mytrades by symbol — use trades
    // as a proxy, or fall back to active orders if trades unavailable.
    const active = await this.getOpenOrders(symbol);
    return active;
  }

  // ──────────────────────────── Wallet (not wired) ────────────────────────────

  async getDepositHistory(_limit?: number): Promise<Deposit[]> {
    return [];
  }

  async getWithdrawalHistory(_limit?: number): Promise<Withdrawal[]> {
    return [];
  }

  async withdraw(
    _coin: string,
    _address: string,
    _amount: number,
    _network?: string,
  ): Promise<WithdrawalResult> {
    throw new Error("Gemini withdrawals are not wired through Gordon yet.");
  }

  async getWithdrawalInfo(coin: string, _network?: string): Promise<WithdrawalInfo> {
    return { coin, networks: [] };
  }

  // ──────────────────────────── Rate limits & circuit breaker ────────────────────────────

  getRateLimitStatus(): RateLimitStatus {
    // Gemini public: 120/min, private: 600/min. Not actively tracked here.
    return {
      currentWeight: 0,
      maxWeight: 600,
      usagePercent: 0,
      isThrottling: false,
      throttledCount: 0,
      timeUntilReset: 60_000,
    };
  }

  shouldThrottle(): boolean {
    return false;
  }

  getCircuitBreakerState(): string {
    return "CLOSED";
  }

  resetCircuitBreaker(): void {
    // No-op: GeminiAdapter does not maintain a circuit breaker yet.
  }
}
