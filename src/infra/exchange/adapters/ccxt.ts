/**
 * CCXT Exchange Adapter
 * Generic adapter that uses CCXT library to connect to multiple exchanges
 */

import ccxt, { type Exchange as CCXTExchange, type Market, type Ticker, type Order as CCXTOrder, type Trade as CCXTTrade, type Transaction } from "ccxt";
import type {
  Exchange,
  ExchangeId,
  ExchangeCredentials,
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
  OrderSide,
  OrderType,
  OrderStatus,
  Trade,
  Deposit,
  Withdrawal,
  RateLimitStatus,
  SymbolInfo,
  SymbolFilter,
} from "../types.ts";
import type { Candle } from "../../../types/index.ts";

/** CCXT exchange configuration type */
interface CCXTExchangeConfig {
  apiKey?: string;
  secret?: string;
  password?: string;
  enableRateLimit?: boolean;
  sandbox?: boolean;
}

/**
 * Maps exchange IDs to their CCXT class names
 */
const EXCHANGE_CLASS_MAP: Record<string, string> = {
  binance: "binance",
  coinbase: "coinbase",
  kraken: "kraken",
  bybit: "bybit",
  okx: "okx",
};

/**
 * Display names for exchanges
 */
const EXCHANGE_DISPLAY_NAMES: Record<string, string> = {
  binance: "Binance",
  coinbase: "Coinbase",
  kraken: "Kraken",
  bybit: "Bybit",
  okx: "OKX",
};

/**
 * CCXTAdapter - Generic adapter for CCXT-supported exchanges
 *
 * This adapter uses the CCXT library to provide a unified interface
 * for interacting with various cryptocurrency exchanges.
 */
export class CCXTAdapter implements Exchange {
  private ccxtExchange: CCXTExchange;
  private _exchangeId: ExchangeId;
  private _displayName: string;

  // Rate limiting state
  private requestCount = 0;
  private lastResetTime = Date.now();
  private readonly maxRequestsPerMinute = 1200;
  private throttledCount = 0;

  // Circuit breaker state
  private circuitBreakerState: "CLOSED" | "OPEN" | "HALF_OPEN" = "CLOSED";
  private consecutiveFailures = 0;
  private readonly maxFailures = 5;
  private circuitOpenTime = 0;
  private readonly circuitResetTimeout = 60000; // 1 minute

  get exchangeId(): ExchangeId {
    return this._exchangeId;
  }

  get displayName(): string {
    return this._displayName;
  }

  constructor(exchangeId: ExchangeId, credentials: ExchangeCredentials) {
    this._exchangeId = exchangeId;
    this._displayName = EXCHANGE_DISPLAY_NAMES[exchangeId] || exchangeId;

    const ccxtClassName = EXCHANGE_CLASS_MAP[exchangeId];
    if (!ccxtClassName) {
      throw new Error(`Unsupported exchange: ${exchangeId}`);
    }

    // Get the exchange class from CCXT using dynamic access
    const ccxtLib = ccxt as unknown as Record<string, new (config: CCXTExchangeConfig) => CCXTExchange>;
    const ExchangeClass = ccxtLib[ccxtClassName];
    if (!ExchangeClass) {
      throw new Error(`CCXT does not support exchange: ${exchangeId}`);
    }

    // Create CCXT exchange instance with rate limiting enabled
    this.ccxtExchange = new ExchangeClass({
      apiKey: credentials.apiKey,
      secret: credentials.apiSecret,
      password: credentials.passphrase,
      enableRateLimit: true,
      sandbox: credentials.sandbox ?? false,
    });
  }

  // -------------------------------------------------------------------------
  // Symbol Format Conversion
  // -------------------------------------------------------------------------

  /**
   * Convert from Binance format (BTCUSDT) to CCXT format (BTC/USDT)
   */
  private toCCXTSymbol(symbol: string): string {
    // Common quote currencies
    const quotes = ["USDT", "USDC", "BUSD", "BTC", "ETH", "BNB", "EUR", "USD", "GBP"];

    for (const quote of quotes) {
      if (symbol.endsWith(quote)) {
        const base = symbol.slice(0, -quote.length);
        return `${base}/${quote}`;
      }
    }

    // If no match found, assume it's already in CCXT format or return as-is
    return symbol.includes("/") ? symbol : symbol;
  }

  /**
   * Convert from CCXT format (BTC/USDT) to Binance format (BTCUSDT)
   */
  private fromCCXTSymbol(symbol: string): string {
    return symbol.replace("/", "");
  }

  // -------------------------------------------------------------------------
  // Circuit Breaker Helpers
  // -------------------------------------------------------------------------

  private async withCircuitBreaker<T>(operation: () => Promise<T>): Promise<T> {
    // Check circuit breaker state
    if (this.circuitBreakerState === "OPEN") {
      if (Date.now() - this.circuitOpenTime > this.circuitResetTimeout) {
        this.circuitBreakerState = "HALF_OPEN";
      } else {
        throw new Error("Circuit breaker is OPEN - exchange temporarily unavailable");
      }
    }

    try {
      const result = await operation();
      // Success - reset failures
      this.consecutiveFailures = 0;
      if (this.circuitBreakerState === "HALF_OPEN") {
        this.circuitBreakerState = "CLOSED";
      }
      return result;
    } catch (error) {
      this.consecutiveFailures++;

      if (this.consecutiveFailures >= this.maxFailures) {
        this.circuitBreakerState = "OPEN";
        this.circuitOpenTime = Date.now();
      }

      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // Connection
  // -------------------------------------------------------------------------

  async testConnection(): Promise<boolean> {
    return this.withCircuitBreaker(async () => {
      try {
        await this.ccxtExchange.fetchTime();
        return true;
      } catch {
        return false;
      }
    });
  }

  async getExchangeInfo(): Promise<ExchangeInfo> {
    return this.withCircuitBreaker(async () => {
      await this.ccxtExchange.loadMarkets();

      const marketsList = Object.values(this.ccxtExchange.markets) as (Market | undefined)[];
      const validMarkets = marketsList.filter((m): m is Market => m !== undefined && m !== null);

      const symbols: SymbolInfo[] = validMarkets.map((m) => {
        // Use non-null assertion since we've filtered above
        const market = m!;
        const filters: SymbolFilter[] = [];

        // Create price filter if available
        const precision = market.precision;
        if (precision?.price !== undefined) {
          filters.push({
            filterType: "PRICE_FILTER",
            tickSize: String(precision.price),
          });
        }

        // Create lot size filter if available
        const limits = market.limits;
        if (limits?.amount) {
          filters.push({
            filterType: "LOT_SIZE",
            minQty: limits.amount.min != null ? String(limits.amount.min) : undefined,
            maxQty: limits.amount.max != null ? String(limits.amount.max) : undefined,
            stepSize: precision?.amount != null ? String(precision.amount) : undefined,
          });
        }

        // Create min notional filter if available
        if (limits?.cost?.min != null) {
          filters.push({
            filterType: "MIN_NOTIONAL",
            minNotional: String(limits.cost.min),
          });
        }

        return {
          symbol: this.fromCCXTSymbol(String(market.symbol ?? "")),
          status: market.active ? "TRADING" : "HALT",
          baseAsset: String(market.base ?? ""),
          quoteAsset: String(market.quote ?? ""),
          baseAssetPrecision: typeof precision?.amount === "number" ? precision.amount : 8,
          quoteAssetPrecision: typeof precision?.price === "number" ? precision.price : 8,
          orderTypes: (market.type === "spot" ? ["MARKET", "LIMIT"] : ["MARKET", "LIMIT"]) as OrderType[],
          isSpotTradingAllowed: market.spot ?? market.type === "spot",
          filters,
        };
      });

      return {
        timezone: "UTC",
        serverTime: Date.now(),
        symbols,
      };
    });
  }

  // -------------------------------------------------------------------------
  // Market Data
  // -------------------------------------------------------------------------

  async getPrice(symbol: string): Promise<number> {
    return this.withCircuitBreaker(async () => {
      const ccxtSymbol = this.toCCXTSymbol(symbol);
      const ticker = await this.ccxtExchange.fetchTicker(ccxtSymbol);
      return ticker.last ?? ticker.close ?? 0;
    });
  }

  async getCandles(symbol: string, interval: string, limit = 100): Promise<Candle[]> {
    return this.withCircuitBreaker(async () => {
      const ccxtSymbol = this.toCCXTSymbol(symbol);

      // Map interval to CCXT timeframe format
      const timeframe = this.mapIntervalToTimeframe(interval);

      const ohlcv = await this.ccxtExchange.fetchOHLCV(ccxtSymbol, timeframe, undefined, limit);

      return ohlcv.map((candle): Candle => ({
        openTime: candle[0] as number,
        open: candle[1] as number,
        high: candle[2] as number,
        low: candle[3] as number,
        close: candle[4] as number,
        volume: candle[5] as number,
        closeTime: (candle[0] as number) + this.getIntervalMs(interval) - 1,
      }));
    });
  }

  private mapIntervalToTimeframe(interval: string): string {
    // Most exchanges use similar timeframe formats, but we ensure compatibility
    const mapping: Record<string, string> = {
      "1m": "1m",
      "3m": "3m",
      "5m": "5m",
      "15m": "15m",
      "30m": "30m",
      "1h": "1h",
      "2h": "2h",
      "4h": "4h",
      "6h": "6h",
      "8h": "8h",
      "12h": "12h",
      "1d": "1d",
      "3d": "3d",
      "1w": "1w",
      "1M": "1M",
    };
    return mapping[interval] ?? interval;
  }

  private getIntervalMs(interval: string): number {
    const units: Record<string, number> = {
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
      w: 7 * 24 * 60 * 60 * 1000,
      M: 30 * 24 * 60 * 60 * 1000,
    };

    const match = interval.match(/^(\d+)([mhdwM])$/);
    if (match && match[1] && match[2]) {
      const value = parseInt(match[1], 10);
      const unit = match[2];
      return value * (units[unit] ?? 60000);
    }
    return 60000; // Default to 1 minute
  }

  async get24hrTickers(): Promise<Ticker24hr[]> {
    return this.withCircuitBreaker(async () => {
      const tickers = await this.ccxtExchange.fetchTickers();

      return Object.values(tickers).map((ticker): Ticker24hr => {
        const t = ticker as Ticker;
        return {
          symbol: this.fromCCXTSymbol(String(t.symbol ?? "")),
          priceChange: Number(t.change ?? 0),
          priceChangePercent: Number(t.percentage ?? 0),
          lastPrice: Number(t.last ?? t.close ?? 0),
          highPrice: Number(t.high ?? 0),
          lowPrice: Number(t.low ?? 0),
          volume: Number(t.baseVolume ?? 0),
          quoteVolume: Number(t.quoteVolume ?? 0),
          openTime: t.timestamp ? Number(t.timestamp) - 86400000 : Date.now() - 86400000,
          closeTime: Number(t.timestamp ?? Date.now()),
        };
      });
    });
  }

  async getTopSymbols(n: number): Promise<string[]> {
    return this.withCircuitBreaker(async () => {
      const tickers = await this.get24hrTickers();

      // Sort by quote volume (trading volume in quote currency)
      const sorted = tickers
        .filter((t) => t.symbol.endsWith("USDT") || t.symbol.endsWith("USD"))
        .sort((a, b) => b.quoteVolume - a.quoteVolume);

      return sorted.slice(0, n).map((t) => t.symbol);
    });
  }

  async getOrderBook(symbol: string, limit = 100): Promise<OrderBook> {
    return this.withCircuitBreaker(async () => {
      const ccxtSymbol = this.toCCXTSymbol(symbol);
      const book = await this.ccxtExchange.fetchOrderBook(ccxtSymbol, limit);

      return {
        lastUpdateId: book.nonce ?? Date.now(),
        bids: book.bids.map((bid) => ({
          price: Number(bid[0]),
          quantity: Number(bid[1]),
        })),
        asks: book.asks.map((ask) => ({
          price: Number(ask[0]),
          quantity: Number(ask[1]),
        })),
      };
    });
  }

  async getBookTicker(symbol: string): Promise<BookTicker> {
    return this.withCircuitBreaker(async () => {
      const ccxtSymbol = this.toCCXTSymbol(symbol);
      const book = await this.ccxtExchange.fetchOrderBook(ccxtSymbol, 1);

      const bestBid = book.bids[0] ?? [0, 0];
      const bestAsk = book.asks[0] ?? [0, 0];

      return {
        symbol: this.fromCCXTSymbol(symbol),
        bidPrice: Number(bestBid[0]),
        bidQty: Number(bestBid[1]),
        askPrice: Number(bestAsk[0]),
        askQty: Number(bestAsk[1]),
      };
    });
  }

  async getSpread(symbol: string): Promise<SpreadInfo> {
    const bookTicker = await this.getBookTicker(symbol);

    const spread = bookTicker.askPrice - bookTicker.bidPrice;
    const midPrice = (bookTicker.askPrice + bookTicker.bidPrice) / 2;
    const spreadPercent = midPrice > 0 ? (spread / midPrice) * 100 : 0;

    return {
      spread,
      spreadPercent,
      bidPrice: bookTicker.bidPrice,
      askPrice: bookTicker.askPrice,
    };
  }

  async getAvgPrice(symbol: string): Promise<AvgPrice> {
    return this.withCircuitBreaker(async () => {
      // CCXT doesn't have a direct average price endpoint
      // We approximate using the last price
      const price = await this.getPrice(symbol);

      return {
        mins: 5, // Approximate
        price,
      };
    });
  }

  // -------------------------------------------------------------------------
  // Account
  // -------------------------------------------------------------------------

  async getAccountInfo(): Promise<AccountInfo> {
    return this.withCircuitBreaker(async () => {
      const balance = await this.ccxtExchange.fetchBalance();
      const totalObj = (balance.total ?? {}) as Record<string, number>;
      const freeObj = (balance.free ?? {}) as Record<string, number>;

      const balances: Balance[] = Object.entries(totalObj)
        .filter(([, total]) => Number(total) > 0)
        .map(([asset, total]): Balance => {
          const totalNum = Number(total);
          const freeNum = Number(freeObj[asset] ?? 0);
          return {
            asset,
            free: freeNum,
            locked: totalNum - freeNum,
            total: totalNum,
          };
        });

      return {
        canTrade: true,
        canWithdraw: true,
        canDeposit: true,
        accountType: "SPOT",
        balances,
        updateTime: Date.now(),
      };
    });
  }

  async getBalance(asset: string): Promise<number> {
    return this.withCircuitBreaker(async () => {
      const balance = await this.ccxtExchange.fetchBalance();
      const totalObj = (balance.total ?? {}) as Record<string, number>;
      return Number(totalObj[asset] ?? 0);
    });
  }

  async getAllBalances(): Promise<Balance[]> {
    const accountInfo = await this.getAccountInfo();
    return accountInfo.balances;
  }

  async getFullAccountDetails(): Promise<AccountDetails> {
    const accountInfo = await this.getAccountInfo();
    const nonZeroBalances = accountInfo.balances.filter((b) => b.total > 0);

    // Calculate approximate USDT value
    const stableBalances = nonZeroBalances.filter(
      (b) => b.asset === "USDT" || b.asset === "BUSD" || b.asset === "USDC" || b.asset === "USD"
    );
    const totalUsdtValue = stableBalances.reduce((sum, b) => sum + b.total, 0);

    return {
      accountInfo,
      totalUsdtValue,
      nonZeroBalances,
    };
  }

  // -------------------------------------------------------------------------
  // Trading
  // -------------------------------------------------------------------------

  async placeOrder(params: OrderParams): Promise<Order> {
    return this.withCircuitBreaker(async () => {
      const ccxtSymbol = this.toCCXTSymbol(params.symbol);
      const side = params.side.toLowerCase() as "buy" | "sell";
      const type = params.type.toLowerCase();

      let ccxtOrder: CCXTOrder;

      if (type === "market") {
        ccxtOrder = await this.ccxtExchange.createMarketOrder(
          ccxtSymbol,
          side,
          params.quantity ?? 0,
          undefined,
          { quoteOrderQty: params.quoteOrderQty }
        );
      } else if (type === "limit" && params.price) {
        ccxtOrder = await this.ccxtExchange.createLimitOrder(
          ccxtSymbol,
          side,
          params.quantity ?? 0,
          params.price,
          { timeInForce: params.timeInForce }
        );
      } else if ((type === "stop_loss" || type === "stop_loss_limit") && params.stopPrice) {
        ccxtOrder = await this.ccxtExchange.createOrder(
          ccxtSymbol,
          "stop",
          side,
          params.quantity ?? 0,
          params.price,
          { stopPrice: params.stopPrice, timeInForce: params.timeInForce }
        );
      } else {
        throw new Error(`Unsupported order type: ${params.type}`);
      }

      return this.normalizeOrder(ccxtOrder);
    });
  }

  async cancelOrder(symbol: string, orderId: string): Promise<void> {
    return this.withCircuitBreaker(async () => {
      const ccxtSymbol = this.toCCXTSymbol(symbol);
      await this.ccxtExchange.cancelOrder(orderId, ccxtSymbol);
    });
  }

  async cancelAllOrders(symbol: string): Promise<Order[]> {
    return this.withCircuitBreaker(async () => {
      const ccxtSymbol = this.toCCXTSymbol(symbol);
      const openOrders = await this.ccxtExchange.fetchOpenOrders(ccxtSymbol);

      const cancelledOrders: Order[] = [];
      for (const order of openOrders as CCXTOrder[]) {
        await this.ccxtExchange.cancelOrder(order.id, ccxtSymbol);
        cancelledOrders.push(this.normalizeOrder(order));
      }

      return cancelledOrders;
    });
  }

  async getOpenOrders(symbol?: string): Promise<Order[]> {
    return this.withCircuitBreaker(async () => {
      const ccxtSymbol = symbol ? this.toCCXTSymbol(symbol) : undefined;
      const orders = await this.ccxtExchange.fetchOpenOrders(ccxtSymbol) as CCXTOrder[];
      return orders.map((o: CCXTOrder) => this.normalizeOrder(o));
    });
  }

  async getOrderStatus(symbol: string, orderId: number | string): Promise<Order> {
    return this.withCircuitBreaker(async () => {
      const ccxtSymbol = this.toCCXTSymbol(symbol);
      const order = await this.ccxtExchange.fetchOrder(orderId.toString(), ccxtSymbol);
      return this.normalizeOrder(order);
    });
  }

  async testOrder(params: OrderParams): Promise<boolean> {
    // Most exchanges don't have a test order endpoint via CCXT
    // We validate the parameters instead
    try {
      if (!params.symbol || !params.side || !params.type) {
        return false;
      }

      if (params.type === "LIMIT" && !params.price) {
        return false;
      }

      if (!params.quantity && !params.quoteOrderQty) {
        return false;
      }

      // Load markets to validate symbol
      await this.ccxtExchange.loadMarkets();
      const ccxtSymbol = this.toCCXTSymbol(params.symbol);

      if (!this.ccxtExchange.markets[ccxtSymbol]) {
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // History
  // -------------------------------------------------------------------------

  async getTradeHistory(symbol: string, limit = 100): Promise<Trade[]> {
    return this.withCircuitBreaker(async () => {
      const ccxtSymbol = this.toCCXTSymbol(symbol);
      const trades = await this.ccxtExchange.fetchMyTrades(ccxtSymbol, undefined, limit);

      return (trades as CCXTTrade[]).map((t: CCXTTrade): Trade => ({
        id: String(t.id ?? ""),
        orderId: String(t.order ?? ""),
        symbol: this.fromCCXTSymbol(String(t.symbol ?? "")),
        side: (t.side?.toUpperCase() ?? "BUY") as OrderSide,
        price: Number(t.price ?? 0),
        quantity: Number(t.amount ?? 0),
        commission: Number(t.fee?.cost ?? 0),
        commissionAsset: String(t.fee?.currency ?? ""),
        time: Number(t.timestamp ?? Date.now()),
        isMaker: t.takerOrMaker === "maker",
      }));
    });
  }

  async getOrderHistory(symbol: string, limit = 100): Promise<Order[]> {
    return this.withCircuitBreaker(async () => {
      const ccxtSymbol = this.toCCXTSymbol(symbol);
      const orders = await this.ccxtExchange.fetchClosedOrders(ccxtSymbol, undefined, limit) as CCXTOrder[];
      return orders.map((o: CCXTOrder) => this.normalizeOrder(o));
    });
  }

  async getDepositHistory(limit = 100): Promise<Deposit[]> {
    return this.withCircuitBreaker(async () => {
      if (!this.ccxtExchange.has["fetchDeposits"]) {
        return [];
      }

      const deposits = await this.ccxtExchange.fetchDeposits(undefined, undefined, limit);

      return (deposits as Transaction[]).map((d: Transaction): Deposit => ({
        id: String(d.id ?? d.txid ?? ""),
        amount: Number(d.amount ?? 0),
        coin: String(d.currency ?? ""),
        network: String(d.network ?? ""),
        status: this.mapDepositStatus(d.status),
        address: String(d.address ?? ""),
        txId: d.txid != null ? String(d.txid) : undefined,
        insertTime: Number(d.timestamp ?? Date.now()),
        confirmTimes: undefined,
      }));
    });
  }

  async getWithdrawalHistory(limit = 100): Promise<Withdrawal[]> {
    return this.withCircuitBreaker(async () => {
      if (!this.ccxtExchange.has["fetchWithdrawals"]) {
        return [];
      }

      const withdrawals = await this.ccxtExchange.fetchWithdrawals(undefined, undefined, limit);

      return (withdrawals as Transaction[]).map((w: Transaction): Withdrawal => ({
        id: String(w.id ?? w.txid ?? ""),
        amount: Number(w.amount ?? 0),
        coin: String(w.currency ?? ""),
        network: String(w.network ?? ""),
        status: this.mapWithdrawalStatus(w.status),
        address: String(w.address ?? ""),
        txId: w.txid != null ? String(w.txid) : undefined,
        applyTime: Number(w.timestamp ?? Date.now()),
        transactionFee: w.fee?.cost != null ? Number(w.fee.cost) : undefined,
      }));
    });
  }

  private mapDepositStatus(status?: string): number {
    const statusMap: Record<string, number> = {
      pending: 0,
      ok: 1,
      canceled: 2,
      failed: 3,
    };
    return statusMap[status ?? "pending"] ?? 0;
  }

  private mapWithdrawalStatus(status?: string): number {
    const statusMap: Record<string, number> = {
      pending: 0,
      ok: 1,
      canceled: 2,
      failed: 3,
    };
    return statusMap[status ?? "pending"] ?? 0;
  }

  // -------------------------------------------------------------------------
  // Rate Limiting & Status
  // -------------------------------------------------------------------------

  shouldThrottle(): boolean {
    this.updateRateLimitWindow();
    const usage = this.requestCount / this.maxRequestsPerMinute;

    if (usage > 0.8) {
      this.throttledCount++;
      return true;
    }
    return false;
  }

  getRateLimitStatus(): RateLimitStatus {
    this.updateRateLimitWindow();

    return {
      currentWeight: this.requestCount,
      maxWeight: this.maxRequestsPerMinute,
      usagePercent: (this.requestCount / this.maxRequestsPerMinute) * 100,
      isThrottling: this.shouldThrottle(),
      throttledCount: this.throttledCount,
      timeUntilReset: Math.max(0, 60000 - (Date.now() - this.lastResetTime)),
    };
  }

  private updateRateLimitWindow(): void {
    const now = Date.now();
    if (now - this.lastResetTime >= 60000) {
      this.requestCount = 0;
      this.lastResetTime = now;
    }
  }

  getCircuitBreakerState(): string {
    return this.circuitBreakerState;
  }

  resetCircuitBreaker(): void {
    this.circuitBreakerState = "CLOSED";
    this.consecutiveFailures = 0;
  }

  // -------------------------------------------------------------------------
  // Private Helpers
  // -------------------------------------------------------------------------

  private normalizeOrder(ccxtOrder: CCXTOrder): Order {
    return {
      orderId: ccxtOrder.id,
      clientOrderId: ccxtOrder.clientOrderId,
      symbol: this.fromCCXTSymbol(ccxtOrder.symbol),
      side: ccxtOrder.side?.toUpperCase() as OrderSide,
      type: ccxtOrder.type?.toUpperCase() as OrderType,
      status: this.mapOrderStatus(ccxtOrder.status),
      price: ccxtOrder.price ?? 0,
      quantity: ccxtOrder.amount,
      executedQty: ccxtOrder.filled ?? 0,
      cummulativeQuoteQty: ccxtOrder.cost ?? 0,
      timeInForce: ccxtOrder.timeInForce?.toUpperCase() as Order["timeInForce"],
      stopPrice: ccxtOrder.stopPrice,
      time: ccxtOrder.timestamp,
      updateTime: ccxtOrder.lastTradeTimestamp,
      isWorking: ccxtOrder.status === "open",
    };
  }

  private mapOrderStatus(status?: string): OrderStatus {
    const statusMap: Record<string, OrderStatus> = {
      open: "NEW",
      closed: "FILLED",
      canceled: "CANCELED",
      expired: "EXPIRED",
      rejected: "REJECTED",
    };
    return statusMap[status ?? "open"] ?? "NEW";
  }
}
