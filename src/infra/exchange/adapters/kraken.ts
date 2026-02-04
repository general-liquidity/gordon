/**
 * Kraken Exchange Adapter
 * Wraps KrakenClient to implement the abstract Exchange interface
 */

import { KrakenClient, KrakenError } from "../../kraken/index.ts";
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
  OrderSide,
} from "../types.ts";
import type { Candle } from "../../../types/index.ts";

/**
 * Symbol mapping for Kraken
 * Kraken uses X/Z prefixes for crypto/fiat
 */
const KRAKEN_ASSET_MAP: Record<string, string> = {
  BTC: "XBT",
  DOGE: "XDG",
};

const REVERSE_ASSET_MAP: Record<string, string> = {
  XBT: "BTC",
  XXBT: "BTC",
  XDG: "DOGE",
  XXDG: "DOGE",
};

/**
 * KrakenAdapter - Adapts KrakenClient to the Exchange interface
 */
export class KrakenAdapter implements Exchange {
  private client: KrakenClient;
  private pairCache: Map<string, string> = new Map();

  readonly exchangeId: ExchangeId = "kraken";
  readonly displayName = "Kraken";

  constructor(apiKey: string, apiSecret: string) {
    this.client = new KrakenClient(apiKey, apiSecret);
  }

  // -------------------------------------------------------------------------
  // Symbol Conversion Helpers
  // -------------------------------------------------------------------------

  /**
   * Convert standard symbol (BTCUSD) to Kraken format (XXBTZUSD)
   */
  private toKrakenSymbol(symbol: string): string {
    // Check cache first
    const cached = this.pairCache.get(symbol);
    if (cached) return cached;

    // Common quote currencies
    const quotes = ["USDT", "USDC", "USD", "EUR", "GBP", "BTC", "ETH"];
    for (const quote of quotes) {
      if (symbol.endsWith(quote)) {
        const base = symbol.slice(0, -quote.length);
        const krakenBase = KRAKEN_ASSET_MAP[base] || base;
        // Kraken often uses X prefix for crypto, Z for fiat
        const krakenQuote = quote === "USD" ? "ZUSD" : quote === "EUR" ? "ZEUR" : quote;
        const krakenSymbol = `X${krakenBase}${krakenQuote}`;
        this.pairCache.set(symbol, krakenSymbol);
        return krakenSymbol;
      }
    }
    return symbol;
  }

  /**
   * Convert Kraken symbol to standard format
   */
  private fromKrakenSymbol(symbol: string): string {
    // Remove common prefixes
    let normalized = symbol;

    // Handle XXBTZUSD format
    if (normalized.startsWith("X") && normalized.length > 4) {
      normalized = normalized.slice(1);
    }

    // Replace known Kraken asset names
    for (const [kraken, standard] of Object.entries(REVERSE_ASSET_MAP)) {
      if (normalized.startsWith(kraken)) {
        normalized = standard + normalized.slice(kraken.length);
        break;
      }
    }

    // Remove Z prefix from fiat
    normalized = normalized.replace(/Z(USD|EUR|GBP)/g, "$1");

    return normalized;
  }

  /**
   * Convert Kraken asset name to standard
   */
  private normalizeAsset(asset: string): string {
    return REVERSE_ASSET_MAP[asset] || asset.replace(/^[XZ]/, "");
  }

  // -------------------------------------------------------------------------
  // Connection
  // -------------------------------------------------------------------------

  async testConnection(): Promise<boolean> {
    return this.client.testConnection();
  }

  async getExchangeInfo(): Promise<ExchangeInfo> {
    const [time, pairs] = await Promise.all([
      this.client.getServerTime(),
      this.client.getAssetPairs(),
    ]);

    return {
      timezone: "UTC",
      serverTime: time.unixtime * 1000,
      symbols: Object.entries(pairs).map(
        ([key, p]): SymbolInfo => ({
          symbol: this.fromKrakenSymbol(key),
          status: p.status,
          baseAsset: this.normalizeAsset(p.base),
          quoteAsset: this.normalizeAsset(p.quote),
          baseAssetPrecision: p.lot_decimals,
          quoteAssetPrecision: p.pair_decimals,
          orderTypes: ["MARKET", "LIMIT", "STOP_LOSS", "STOP_LOSS_LIMIT"] as OrderType[],
          isSpotTradingAllowed: p.status === "online",
          filters: [
            {
              filterType: "LOT_SIZE",
              minQty: p.ordermin,
              stepSize: `0.${"0".repeat(p.lot_decimals - 1)}1`,
            },
            {
              filterType: "PRICE_FILTER",
              tickSize: p.tick_size,
            },
            {
              filterType: "NOTIONAL",
              minNotional: p.costmin,
            },
          ],
        })
      ),
    };
  }

  // -------------------------------------------------------------------------
  // Market Data
  // -------------------------------------------------------------------------

  async getPrice(symbol: string): Promise<number> {
    const krakenSymbol = this.toKrakenSymbol(symbol);
    const tickers = await this.client.getTicker([krakenSymbol]);
    const ticker = Object.values(tickers)[0];
    if (!ticker) {
      throw new Error(`No ticker data for ${symbol}`);
    }
    return parseFloat(ticker.c[0]); // Last trade price
  }

  async getCandles(symbol: string, interval: string, limit?: number): Promise<Candle[]> {
    const krakenSymbol = this.toKrakenSymbol(symbol);
    const krakenInterval = this.mapInterval(interval);

    const response = await this.client.getOHLC(krakenSymbol, krakenInterval);

    // Find the OHLC data (exclude 'last' key)
    const ohlcData = Object.entries(response)
      .filter(([key]) => key !== "last")
      .flatMap(([, data]) => data as any[]);

    const candles = ohlcData.slice(-(limit || 100)).map(
      (c: any): Candle => ({
        openTime: c[0] * 1000,
        open: parseFloat(c[1]),
        high: parseFloat(c[2]),
        low: parseFloat(c[3]),
        close: parseFloat(c[4]),
        volume: parseFloat(c[6]),
        closeTime: c[0] * 1000 + this.getIntervalMs(interval),
      })
    );

    return candles;
  }

  private mapInterval(interval: string): number {
    const map: Record<string, number> = {
      "1m": 1,
      "5m": 5,
      "15m": 15,
      "30m": 30,
      "1h": 60,
      "4h": 240,
      "1d": 1440,
      "1w": 10080,
    };
    return map[interval] || 60;
  }

  private getIntervalMs(interval: string): number {
    const map: Record<string, number> = {
      "1m": 60000,
      "5m": 300000,
      "15m": 900000,
      "30m": 1800000,
      "1h": 3600000,
      "4h": 14400000,
      "1d": 86400000,
      "1w": 604800000,
    };
    return map[interval] || 3600000;
  }

  async get24hrTickers(): Promise<Ticker24hr[]> {
    // Get all asset pairs first
    const pairs = await this.client.getAssetPairs();
    const pairNames = Object.keys(pairs).filter(
      (p) => !p.includes(".d") // Exclude dark pool pairs
    );

    // Get tickers in batches to avoid rate limits
    const batchSize = 20;
    const allTickers: Ticker24hr[] = [];

    for (let i = 0; i < pairNames.length; i += batchSize) {
      const batch = pairNames.slice(i, i + batchSize);
      const tickers = await this.client.getTicker(batch);

      for (const [key, t] of Object.entries(tickers)) {
        allTickers.push({
          symbol: this.fromKrakenSymbol(key),
          priceChange: 0, // Kraken doesn't provide this directly
          priceChangePercent: 0,
          lastPrice: parseFloat(t.c[0]),
          highPrice: parseFloat(t.h[1]), // 24h high
          lowPrice: parseFloat(t.l[1]), // 24h low
          volume: parseFloat(t.v[1]), // 24h volume
          quoteVolume: parseFloat(t.v[1]) * parseFloat(t.p[1]), // volume * vwap
          openTime: Date.now() - 86400000,
          closeTime: Date.now(),
        });
      }
    }

    return allTickers;
  }

  async getTopSymbols(n: number): Promise<string[]> {
    const tickers = await this.get24hrTickers();
    return tickers
      .filter((t) => t.symbol.endsWith("USD") || t.symbol.endsWith("USDT"))
      .sort((a, b) => b.quoteVolume - a.quoteVolume)
      .slice(0, n)
      .map((t) => t.symbol);
  }

  async getOrderBook(symbol: string, limit?: number): Promise<OrderBook> {
    const krakenSymbol = this.toKrakenSymbol(symbol);
    const books = await this.client.getOrderBook(krakenSymbol, limit || 25);
    const book = Object.values(books)[0];

    if (!book) {
      throw new Error(`No order book data for ${symbol}`);
    }

    return {
      lastUpdateId: Date.now(),
      bids: book.bids.map(([price, volume]) => ({
        price: parseFloat(price),
        quantity: parseFloat(volume),
      })),
      asks: book.asks.map(([price, volume]) => ({
        price: parseFloat(price),
        quantity: parseFloat(volume),
      })),
    };
  }

  async getBookTicker(symbol: string): Promise<BookTicker> {
    const krakenSymbol = this.toKrakenSymbol(symbol);
    const tickers = await this.client.getTicker([krakenSymbol]);
    const ticker = Object.values(tickers)[0];

    if (!ticker) {
      throw new Error(`No ticker data for ${symbol}`);
    }

    return {
      symbol,
      bidPrice: parseFloat(ticker.b[0]),
      bidQty: parseFloat(ticker.b[2]),
      askPrice: parseFloat(ticker.a[0]),
      askQty: parseFloat(ticker.a[2]),
    };
  }

  async getSpread(symbol: string): Promise<SpreadInfo> {
    const ticker = await this.getBookTicker(symbol);
    const spread = ticker.askPrice - ticker.bidPrice;
    const midPrice = (ticker.askPrice + ticker.bidPrice) / 2;
    return {
      spread,
      spreadPercent: midPrice > 0 ? (spread / midPrice) * 100 : 0,
      bidPrice: ticker.bidPrice,
      askPrice: ticker.askPrice,
    };
  }

  async getAvgPrice(symbol: string): Promise<AvgPrice> {
    const krakenSymbol = this.toKrakenSymbol(symbol);
    const tickers = await this.client.getTicker([krakenSymbol]);
    const ticker = Object.values(tickers)[0];

    if (!ticker) {
      throw new Error(`No ticker data for ${symbol}`);
    }

    return {
      mins: 1440, // 24h VWAP
      price: parseFloat(ticker.p[1]), // 24h volume weighted average price
    };
  }

  // -------------------------------------------------------------------------
  // Account
  // -------------------------------------------------------------------------

  async getAccountInfo(): Promise<AccountInfo> {
    const balances = await this.client.getBalance();

    return {
      canTrade: true,
      canWithdraw: true,
      canDeposit: true,
      accountType: "SPOT",
      updateTime: Date.now(),
      balances: Object.entries(balances).map(
        ([asset, balance]): Balance => ({
          asset: this.normalizeAsset(asset),
          free: parseFloat(balance),
          locked: 0, // Kraken basic balance doesn't show hold separately
          total: parseFloat(balance),
        })
      ),
    };
  }

  async getBalance(asset: string): Promise<number> {
    const balances = await this.client.getBalance();
    const krakenAsset = KRAKEN_ASSET_MAP[asset] || `X${asset}`;
    return parseFloat(balances[krakenAsset] || balances[asset] || "0");
  }

  async getAllBalances(): Promise<Balance[]> {
    const info = await this.getAccountInfo();
    return info.balances.filter((b) => b.total > 0);
  }

  async getFullAccountDetails(): Promise<AccountDetails> {
    const [accountInfo, tradeBalance] = await Promise.all([
      this.getAccountInfo(),
      this.client.getTradeBalance("ZUSD"),
    ]);

    const nonZeroBalances = accountInfo.balances.filter((b) => b.total > 0);

    return {
      accountInfo,
      totalUsdtValue: parseFloat(tradeBalance.eb || "0"),
      nonZeroBalances,
    };
  }

  // -------------------------------------------------------------------------
  // Trading
  // -------------------------------------------------------------------------

  async placeOrder(params: OrderParams): Promise<Order> {
    const krakenSymbol = this.toKrakenSymbol(params.symbol);
    const krakenOrderType = this.mapOrderType(params.type);

    const response = await this.client.addOrder({
      pair: krakenSymbol,
      type: params.side.toLowerCase() as "buy" | "sell",
      ordertype: krakenOrderType,
      volume: params.quantity?.toString() || "0",
      price: params.price?.toString(),
      price2: params.stopPrice?.toString(),
    });

    // Query the created order
    const txid = response.txid[0];
    if (!txid) {
      throw new KrakenError(["No transaction ID returned from order placement"]);
    }
    const orders = await this.client.queryOrders([txid]);
    const order = orders[txid];
    if (!order) {
      throw new KrakenError([`Order not found after placement: ${txid}`]);
    }

    return this.normalizeOrder(txid, order);
  }

  async cancelOrder(symbol: string, orderId: string): Promise<void> {
    await this.client.cancelOrder(orderId);
  }

  async cancelAllOrders(symbol: string): Promise<Order[]> {
    // Get open orders first
    const openOrders = await this.getOpenOrders(symbol);
    await this.client.cancelAllOrders();
    return openOrders;
  }

  async getOpenOrders(symbol?: string): Promise<Order[]> {
    const response = await this.client.getOpenOrders();
    let orders = Object.entries(response.open).map(([txid, order]) =>
      this.normalizeOrder(txid, order)
    );

    if (symbol) {
      const krakenSymbol = this.toKrakenSymbol(symbol);
      orders = orders.filter(
        (o) =>
          o.symbol === symbol ||
          o.symbol === this.fromKrakenSymbol(krakenSymbol)
      );
    }

    return orders;
  }

  async getOrderStatus(symbol: string, orderId: number | string): Promise<Order> {
    const orders = await this.client.queryOrders([orderId.toString()]);
    const order = orders[orderId.toString()];

    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    return this.normalizeOrder(orderId.toString(), order);
  }

  async testOrder(params: OrderParams): Promise<boolean> {
    try {
      const krakenSymbol = this.toKrakenSymbol(params.symbol);
      const krakenOrderType = this.mapOrderType(params.type);

      await this.client.addOrder({
        pair: krakenSymbol,
        type: params.side.toLowerCase() as "buy" | "sell",
        ordertype: krakenOrderType,
        volume: params.quantity?.toString() || "0",
        price: params.price?.toString(),
        validate: true,
      });

      return true;
    } catch {
      return false;
    }
  }

  private mapOrderType(type: OrderType): string {
    const map: Record<OrderType, string> = {
      MARKET: "market",
      LIMIT: "limit",
      STOP_LOSS: "stop-loss",
      STOP_LOSS_LIMIT: "stop-loss-limit",
      TAKE_PROFIT: "take-profit",
      TAKE_PROFIT_LIMIT: "take-profit-limit",
      LIMIT_MAKER: "limit",
    };
    return map[type] || "market";
  }

  private normalizeOrder(txid: string, order: any): Order {
    return {
      orderId: txid,
      clientOrderId: order.userref?.toString(),
      symbol: this.fromKrakenSymbol(order.descr.pair),
      side: order.descr.type.toUpperCase() as OrderSide,
      type: this.reverseMapOrderType(order.descr.ordertype),
      status: this.mapOrderStatus(order.status),
      price: parseFloat(order.price || order.descr.price || "0"),
      quantity: parseFloat(order.vol),
      executedQty: parseFloat(order.vol_exec),
      cummulativeQuoteQty: parseFloat(order.cost),
      stopPrice: order.stopprice ? parseFloat(order.stopprice) : undefined,
      time: Math.round(order.opentm * 1000),
      updateTime: order.closetm ? Math.round(order.closetm * 1000) : undefined,
      isWorking: order.status === "open",
    };
  }

  private reverseMapOrderType(type: string): OrderType {
    const map: Record<string, OrderType> = {
      market: "MARKET",
      limit: "LIMIT",
      "stop-loss": "STOP_LOSS",
      "stop-loss-limit": "STOP_LOSS_LIMIT",
      "take-profit": "TAKE_PROFIT",
      "take-profit-limit": "TAKE_PROFIT_LIMIT",
    };
    return map[type] || "MARKET";
  }

  private mapOrderStatus(status: string): OrderStatus {
    const map: Record<string, OrderStatus> = {
      pending: "NEW",
      open: "NEW",
      closed: "FILLED",
      canceled: "CANCELED",
      expired: "EXPIRED",
    };
    return map[status] || "NEW";
  }

  // -------------------------------------------------------------------------
  // History
  // -------------------------------------------------------------------------

  async getTradeHistory(symbol: string, limit?: number): Promise<Trade[]> {
    const response = await this.client.getTradesHistory({ trades: true });

    let trades = Object.entries(response.trades).map(
      ([id, t]): Trade => ({
        id,
        orderId: t.ordertxid,
        symbol: this.fromKrakenSymbol(t.pair),
        side: t.type.toUpperCase() as OrderSide,
        price: parseFloat(t.price),
        quantity: parseFloat(t.vol),
        commission: parseFloat(t.fee),
        commissionAsset: this.normalizeAsset(t.pair.split(/[A-Z]{3,4}$/)[0] || "USD"),
        time: Math.round(t.time * 1000),
        isMaker: t.ordertype === "limit",
      })
    );

    if (symbol) {
      const normalizedSymbol = this.fromKrakenSymbol(this.toKrakenSymbol(symbol));
      trades = trades.filter((t) => t.symbol === normalizedSymbol || t.symbol === symbol);
    }

    return trades.slice(0, limit || 50);
  }

  async getOrderHistory(symbol: string, limit?: number): Promise<Order[]> {
    const response = await this.client.getClosedOrders({ trades: true });

    let orders = Object.entries(response.closed).map(([txid, order]) =>
      this.normalizeOrder(txid, order)
    );

    if (symbol) {
      const normalizedSymbol = this.fromKrakenSymbol(this.toKrakenSymbol(symbol));
      orders = orders.filter((o) => o.symbol === normalizedSymbol || o.symbol === symbol);
    }

    return orders.slice(0, limit || 50);
  }

  async getDepositHistory(limit?: number): Promise<Deposit[]> {
    const deposits = await this.client.getDepositStatus({});
    return deposits.slice(0, limit || 50).map(
      (d): Deposit => ({
        id: d.refid,
        amount: parseFloat(d.amount),
        coin: this.normalizeAsset(d.asset),
        network: d.method,
        status: this.mapDepositStatus(d.status),
        address: d.info,
        txId: d.txid,
        insertTime: d.time * 1000,
      })
    );
  }

  private mapDepositStatus(status: string): number {
    // Kraken status to standard status code
    const map: Record<string, number> = {
      Success: 1,
      Pending: 0,
      Failure: 2,
    };
    return map[status] || 0;
  }

  async getWithdrawalHistory(limit?: number): Promise<Withdrawal[]> {
    const withdrawals = await this.client.getWithdrawStatus({});
    return withdrawals.slice(0, limit || 50).map(
      (w): Withdrawal => ({
        id: w.refid,
        amount: parseFloat(w.amount),
        coin: this.normalizeAsset(w.asset),
        network: w.method,
        status: this.mapWithdrawalStatus(w.status),
        address: w.info,
        txId: w.txid,
        applyTime: w.time * 1000,
        transactionFee: parseFloat(w.fee),
      })
    );
  }

  private mapWithdrawalStatus(status: string): number {
    const map: Record<string, number> = {
      Success: 6,
      Pending: 4,
      Failure: 5,
    };
    return map[status] || 4;
  }

  // -------------------------------------------------------------------------
  // Rate Limiting & Status
  // -------------------------------------------------------------------------

  shouldThrottle(): boolean {
    return this.client.shouldThrottle();
  }

  getRateLimitStatus(): RateLimitStatus {
    const status = this.client.getRateLimitStatus();
    return {
      currentWeight: status.currentCounter,
      maxWeight: status.maxCounter,
      usagePercent: status.usagePercent,
      isThrottling: status.isThrottling,
      throttledCount: status.throttledCount,
      timeUntilReset: status.timeUntilReset,
    };
  }

  getCircuitBreakerState(): string {
    return this.client.getCircuitBreakerState();
  }

  resetCircuitBreaker(): void {
    this.client.resetCircuitBreaker();
  }
}
