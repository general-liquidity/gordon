/**
 * Bitfinex Exchange Adapter
 * Wraps BitfinexClient to implement the abstract Exchange interface
 */

import { BitfinexClient } from "../../bitfinex/index.ts";
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
} from "../types.ts";
import type { Candle } from "../../../types/index.ts";

/**
 * BitfinexAdapter - Adapts BitfinexClient to the Exchange interface
 */
export class BitfinexAdapter implements Exchange {
  private client: BitfinexClient;

  readonly exchangeId: ExchangeId = "bitfinex";
  readonly displayName = "Bitfinex";

  constructor(apiKey: string, apiSecret: string) {
    this.client = new BitfinexClient(apiKey, apiSecret);
  }

  // -------------------------------------------------------------------------
  // Symbol Conversion Helpers
  // -------------------------------------------------------------------------

  /**
   * Convert standard symbol (BTCUSD) to Bitfinex format (tBTCUSD)
   */
  private toBitfinexSymbol(symbol: string): string {
    return BitfinexClient.toBitfinexSymbol(symbol);
  }

  /**
   * Convert Bitfinex symbol (tBTCUSD) to standard format (BTCUSD)
   */
  private fromBitfinexSymbol(symbol: string): string {
    return BitfinexClient.fromBitfinexSymbol(symbol);
  }

  // -------------------------------------------------------------------------
  // Connection
  // -------------------------------------------------------------------------

  async testConnection(): Promise<boolean> {
    return this.client.testConnection();
  }

  async getExchangeInfo(): Promise<ExchangeInfo> {
    const [symbols, symbolDetails] = await Promise.all([
      this.client.getSymbols(),
      this.client.getSymbolDetails(),
    ]);

    const detailsMap = new Map(
      symbolDetails.map((d) => [d.pair.toUpperCase(), d])
    );

    return {
      timezone: "UTC",
      serverTime: Date.now(),
      symbols: symbols.map((pair): SymbolInfo => {
        const details = detailsMap.get(pair.toUpperCase());
        // Extract base and quote from pair (e.g., "BTCUSD" -> BTC, USD)
        const quoteAssets = ["USD", "EUR", "GBP", "JPY", "UST", "BTC", "ETH"];
        let baseAsset = pair;
        let quoteAsset = "USD";

        for (const quote of quoteAssets) {
          if (pair.toUpperCase().endsWith(quote)) {
            baseAsset = pair.slice(0, -quote.length);
            quoteAsset = quote === "UST" ? "USDT" : quote;
            break;
          }
        }

        return {
          symbol: pair.toUpperCase().replace("UST", "USDT"),
          status: "TRADING",
          baseAsset: baseAsset.toUpperCase(),
          quoteAsset,
          baseAssetPrecision: details?.price_precision || 8,
          quoteAssetPrecision: details?.price_precision || 8,
          orderTypes: ["MARKET", "LIMIT", "STOP_LOSS", "STOP_LOSS_LIMIT"] as OrderType[],
          isSpotTradingAllowed: true,
          filters: details
            ? [
                {
                  filterType: "LOT_SIZE",
                  minQty: details.minimum_order_size,
                  maxQty: details.maximum_order_size,
                  stepSize: "0.00000001",
                },
              ]
            : [],
        };
      }),
    };
  }

  // -------------------------------------------------------------------------
  // Market Data
  // -------------------------------------------------------------------------

  async getPrice(symbol: string): Promise<number> {
    const ticker = await this.client.getTicker(this.toBitfinexSymbol(symbol));
    return ticker.lastPrice;
  }

  async getCandles(symbol: string, interval: string, limit?: number): Promise<Candle[]> {
    const bitfinexSymbol = this.toBitfinexSymbol(symbol);
    const timeframe = BitfinexClient.mapTimeframe(interval);
    const candles = await this.client.getCandles(bitfinexSymbol, timeframe, limit || 100, -1);

    // Bitfinex returns [MTS, OPEN, CLOSE, HIGH, LOW, VOLUME]
    // Newest first, reverse for consistency
    return [...candles].reverse().map((c) => ({
      openTime: c[0],
      open: c[1],
      high: c[3],
      low: c[4],
      close: c[2],
      volume: c[5],
      closeTime: c[0] + this.getIntervalMs(interval),
    }));
  }

  private getIntervalMs(interval: string): number {
    const map: Record<string, number> = {
      "1m": 60000,
      "5m": 300000,
      "15m": 900000,
      "30m": 1800000,
      "1h": 3600000,
      "2h": 7200000,
      "3h": 10800000,
      "4h": 14400000,
      "6h": 21600000,
      "12h": 43200000,
      "1d": 86400000,
      "1D": 86400000,
      "1w": 604800000,
      "1W": 604800000,
    };
    return map[interval] || 3600000;
  }

  async get24hrTickers(): Promise<Ticker24hr[]> {
    // Get all trading pairs
    const symbols = await this.client.getSymbols();
    // Filter to USD/USDT pairs and add 't' prefix
    const tradingSymbols = symbols
      .filter((s) => s.endsWith("USD") || s.endsWith("UST"))
      .slice(0, 50) // Limit to avoid rate limits
      .map((s) => `t${s.toUpperCase()}`);

    if (tradingSymbols.length === 0) {
      return [];
    }

    const tickers = await this.client.getTickers(tradingSymbols);

    return tickers.map((t): Ticker24hr => {
      const standardSymbol = this.fromBitfinexSymbol(t.symbol);
      const openPrice = t.lastPrice / (1 + t.dailyChangePercent / 100);
      return {
        symbol: standardSymbol,
        priceChange: t.dailyChange,
        priceChangePercent: t.dailyChangePercent,
        lastPrice: t.lastPrice,
        highPrice: t.high,
        lowPrice: t.low,
        volume: t.volume,
        quoteVolume: t.volume * t.lastPrice,
        openTime: Date.now() - 86400000,
        closeTime: Date.now(),
      };
    });
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
    const len = limit && limit <= 25 ? 25 : limit && limit <= 100 ? 100 : 25;
    const book = await this.client.getOrderBook(this.toBitfinexSymbol(symbol), "P0", len);

    return {
      lastUpdateId: Date.now(),
      bids: book.bids.map((b) => ({
        price: b.price,
        quantity: b.amount,
      })),
      asks: book.asks.map((a) => ({
        price: a.price,
        quantity: a.amount,
      })),
    };
  }

  async getBookTicker(symbol: string): Promise<BookTicker> {
    const ticker = await this.client.getTicker(this.toBitfinexSymbol(symbol));

    return {
      symbol,
      bidPrice: ticker.bid,
      bidQty: ticker.bidSize,
      askPrice: ticker.ask,
      askQty: ticker.askSize,
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
    const price = await this.getPrice(symbol);
    return {
      mins: 5,
      price,
    };
  }

  // -------------------------------------------------------------------------
  // Account
  // -------------------------------------------------------------------------

  async getAccountInfo(): Promise<AccountInfo> {
    const wallets = await this.client.getExchangeWallets();
    return {
      canTrade: true,
      canWithdraw: true,
      canDeposit: true,
      accountType: "SPOT",
      updateTime: Date.now(),
      balances: wallets.map((w): Balance => ({
        asset: w.currency.toUpperCase(),
        free: w.availableBalance,
        locked: w.balance - w.availableBalance,
        total: w.balance,
      })),
    };
  }

  async getBalance(asset: string): Promise<number> {
    const wallets = await this.client.getExchangeWallets();
    const wallet = wallets.find(
      (w) => w.currency.toUpperCase() === asset.toUpperCase()
    );
    return wallet ? wallet.balance : 0;
  }

  async getAllBalances(): Promise<Balance[]> {
    const info = await this.getAccountInfo();
    return info.balances.filter((b) => b.total > 0);
  }

  async getFullAccountDetails(): Promise<AccountDetails> {
    const accountInfo = await this.getAccountInfo();
    const nonZeroBalances = accountInfo.balances.filter((b) => b.total > 0);

    // Calculate USD value
    const stableBalances = nonZeroBalances.filter(
      (b) => b.asset === "USD" || b.asset === "UST" || b.asset === "USDT"
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
    const bitfinexSymbol = this.toBitfinexSymbol(params.symbol);

    // Determine order type
    let orderType: string;
    if (params.type === "MARKET") {
      orderType = "EXCHANGE MARKET";
    } else if (params.type === "LIMIT") {
      orderType = "EXCHANGE LIMIT";
    } else if (params.type === "STOP_LOSS") {
      orderType = "EXCHANGE STOP";
    } else if (params.type === "STOP_LOSS_LIMIT") {
      orderType = "EXCHANGE STOP LIMIT";
    } else {
      orderType = "EXCHANGE LIMIT";
    }

    // Bitfinex uses positive for buy, negative for sell
    const amount = params.side === "BUY"
      ? Math.abs(params.quantity || 0)
      : -Math.abs(params.quantity || 0);

    const response = await this.client.submitOrder({
      symbol: bitfinexSymbol,
      amount,
      price: params.price,
      type: orderType as any,
      clientOrderId: params.newClientOrderId ? parseInt(params.newClientOrderId) : undefined,
      priceAuxLimit: params.stopPrice,
    });

    return {
      orderId: response.id.toString(),
      clientOrderId: response.clientOrderId?.toString(),
      symbol: params.symbol,
      side: params.side,
      type: params.type,
      status: this.mapOrderStatus(response.status),
      price: response.price,
      quantity: Math.abs(response.amountOrig),
      executedQty: Math.abs(response.amountOrig) - Math.abs(response.amount),
      cummulativeQuoteQty: (Math.abs(response.amountOrig) - Math.abs(response.amount)) * response.priceAvg,
      time: response.createdAt,
      updateTime: response.updatedAt,
      isWorking: response.status === "ACTIVE",
    };
  }

  async cancelOrder(symbol: string, orderId: string): Promise<void> {
    await this.client.cancelOrder(parseInt(orderId));
  }

  async cancelAllOrders(symbol: string): Promise<Order[]> {
    const bitfinexSymbol = this.toBitfinexSymbol(symbol);
    const openOrders = await this.client.getActiveOrders(bitfinexSymbol);

    if (openOrders.length === 0) {
      return [];
    }

    const orderIds = openOrders.map((o) => o.id);
    await this.client.cancelOrders(orderIds);

    return openOrders.map((o) => this.normalizeOrder(o, symbol));
  }

  async getOpenOrders(symbol?: string): Promise<Order[]> {
    const bitfinexSymbol = symbol ? this.toBitfinexSymbol(symbol) : undefined;
    const orders = await this.client.getActiveOrders(bitfinexSymbol);
    return orders.map((o) => this.normalizeOrder(o, symbol || this.fromBitfinexSymbol(o.symbol)));
  }

  async getOrderStatus(symbol: string, orderId: number | string): Promise<Order> {
    // Bitfinex doesn't have a direct "get order by ID" for active orders
    // Need to check both active and history
    const bitfinexSymbol = this.toBitfinexSymbol(symbol);

    // Try active orders first
    const activeOrders = await this.client.getActiveOrders(bitfinexSymbol);
    const activeOrder = activeOrders.find((o) => o.id.toString() === orderId.toString());
    if (activeOrder) {
      return this.normalizeOrder(activeOrder, symbol);
    }

    // Try order history
    const historyOrders = await this.client.getOrderHistory(bitfinexSymbol, 100);
    const historyOrder = historyOrders.find((o) => o.id.toString() === orderId.toString());
    if (historyOrder) {
      return this.normalizeOrder(historyOrder, symbol);
    }

    throw new Error(`Order ${orderId} not found`);
  }

  async testOrder(params: OrderParams): Promise<boolean> {
    // Bitfinex doesn't have a test order endpoint
    // Validate parameters instead
    if (!params.symbol || !params.side || !params.type) {
      return false;
    }
    if (params.type === "LIMIT" && !params.price) {
      return false;
    }
    if (!params.quantity && !params.quoteOrderQty) {
      return false;
    }
    return true;
  }

  private normalizeOrder(order: any, symbol: string): Order {
    const side = order.amount > 0 || order.amountOrig > 0 ? "BUY" : "SELL";
    const executedQty = Math.abs(order.amountOrig) - Math.abs(order.amount);

    return {
      orderId: order.id.toString(),
      clientOrderId: order.clientOrderId?.toString(),
      symbol,
      side,
      type: this.mapOrderType(order.type),
      status: this.mapOrderStatus(order.status),
      price: order.price,
      quantity: Math.abs(order.amountOrig),
      executedQty,
      cummulativeQuoteQty: executedQty * order.priceAvg,
      time: order.createdAt,
      updateTime: order.updatedAt,
      isWorking: order.status === "ACTIVE",
    };
  }

  private mapOrderType(type: string): OrderType {
    if (type.includes("MARKET")) return "MARKET";
    if (type.includes("STOP LIMIT")) return "STOP_LOSS_LIMIT";
    if (type.includes("STOP")) return "STOP_LOSS";
    if (type.includes("LIMIT")) return "LIMIT";
    return "MARKET";
  }

  private mapOrderStatus(status: string): OrderStatus {
    const map: Record<string, OrderStatus> = {
      ACTIVE: "NEW",
      EXECUTED: "FILLED",
      "PARTIALLY FILLED": "PARTIALLY_FILLED",
      CANCELED: "CANCELED",
      RSN_DUST: "CANCELED",
      RSN_PAUSE: "CANCELED",
    };
    return map[status] || "NEW";
  }

  // -------------------------------------------------------------------------
  // History
  // -------------------------------------------------------------------------

  async getTradeHistory(symbol: string, limit?: number): Promise<Trade[]> {
    const bitfinexSymbol = this.toBitfinexSymbol(symbol);
    const trades = await this.client.getTradeHistory(bitfinexSymbol, limit || 50);

    return trades.map((t): Trade => ({
      id: t.id.toString(),
      orderId: t.orderId.toString(),
      symbol,
      side: t.amount > 0 ? "BUY" : "SELL",
      price: t.price,
      quantity: Math.abs(t.amount),
      commission: Math.abs(t.fee),
      commissionAsset: t.feeCurrency,
      time: t.timestamp,
      isMaker: t.isMaker,
    }));
  }

  async getOrderHistory(symbol: string, limit?: number): Promise<Order[]> {
    const bitfinexSymbol = this.toBitfinexSymbol(symbol);
    const orders = await this.client.getOrderHistory(bitfinexSymbol, limit || 50);
    return orders.map((o) => this.normalizeOrder(o, symbol));
  }

  async getDepositHistory(limit?: number): Promise<Deposit[]> {
    const movements = await this.client.getMovements(undefined, limit || 50);

    return movements
      .filter((m) => m.amount > 0) // Positive amounts are deposits
      .map((m): Deposit => ({
        id: m.id.toString(),
        amount: m.amount,
        coin: m.currency,
        network: m.currencyName,
        status: this.mapMovementStatus(m.status),
        address: m.address || "",
        txId: m.transactionId || undefined,
        insertTime: m.startedAt,
        confirmTimes: undefined,
      }));
  }

  async getWithdrawalHistory(limit?: number): Promise<Withdrawal[]> {
    const movements = await this.client.getMovements(undefined, limit || 50);

    return movements
      .filter((m) => m.amount < 0) // Negative amounts are withdrawals
      .map((m): Withdrawal => ({
        id: m.id.toString(),
        amount: Math.abs(m.amount),
        coin: m.currency,
        network: m.currencyName,
        status: this.mapMovementStatus(m.status),
        address: m.address || "",
        txId: m.transactionId || undefined,
        applyTime: m.startedAt,
        completeTime: m.updatedAt,
        transactionFee: m.fees,
      }));
  }

  private mapMovementStatus(status: string): number {
    // Map Bitfinex movement status to numeric status
    // 0 = pending, 1 = completed, 2 = failed
    const statusLower = status.toLowerCase();
    if (statusLower.includes("completed") || statusLower.includes("success")) {
      return 1;
    }
    if (statusLower.includes("failed") || statusLower.includes("canceled")) {
      return 2;
    }
    return 0;
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
      currentWeight: status.currentRequests,
      maxWeight: status.maxRequests,
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
