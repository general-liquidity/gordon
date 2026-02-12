/**
 * Hyperliquid Exchange Adapter
 * Wraps HyperliquidClient to implement the abstract Exchange interface
 *
 * Note: Hyperliquid is a perpetuals-only DEX. Some spot-focused methods
 * will return empty results or throw HyperliquidNotSupportedError.
 */

import { HyperliquidClient } from "../../hyperliquid/index.ts";
import { HyperliquidNotSupportedError } from "../../../errors/index.ts";
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
  WithdrawalResult,
  WithdrawalInfo,
} from "../types.ts";
import type { Candle } from "../../../types/index.ts";

/**
 * HyperliquidAdapter - Adapts HyperliquidClient to the Exchange interface
 *
 * IMPORTANT: Hyperliquid is a perpetuals-only exchange using wallet authentication.
 * Some spot-focused methods will throw HyperliquidNotSupportedError.
 */
export class HyperliquidAdapter implements Exchange {
  private client: HyperliquidClient;
  private assetIndexMap: Map<string, number> = new Map();
  private assetNameMap: Map<number, string> = new Map();

  readonly exchangeId: ExchangeId = "hyperliquid";
  readonly displayName = "Hyperliquid";

  constructor(walletPrivateKey: string) {
    this.client = new HyperliquidClient(walletPrivateKey);
  }

  /**
   * Get the wallet address
   */
  get walletAddress(): string {
    return this.client.address;
  }

  /**
   * Initialize asset index mapping
   */
  private async initAssetMap(): Promise<void> {
    if (this.assetIndexMap.size > 0) return;

    const meta = await this.client.getMeta();
    meta.universe.forEach((asset, index) => {
      this.assetIndexMap.set(asset.name, index);
      this.assetNameMap.set(index, asset.name);
    });
  }

  /**
   * Get asset index from symbol
   */
  private async getAssetIndex(symbol: string): Promise<number> {
    await this.initAssetMap();
    // Symbol could be "BTC", "BTCUSD", "BTC-USD-PERP", etc.
    const coin = symbol.replace(/[-_]?(USD|USDT|USDC|PERP)/gi, "").toUpperCase();
    const index = this.assetIndexMap.get(coin);
    if (index === undefined) {
      throw new Error(`Unknown asset: ${symbol}`);
    }
    return index;
  }

  /**
   * Normalize symbol to standard format
   */
  private normalizeSymbol(coin: string): string {
    return coin.toUpperCase() + "USD";
  }

  // -------------------------------------------------------------------------
  // Connection
  // -------------------------------------------------------------------------

  async testConnection(): Promise<boolean> {
    return this.client.testConnection();
  }

  async getExchangeInfo(): Promise<ExchangeInfo> {
    const meta = await this.client.getMeta();

    return {
      timezone: "UTC",
      serverTime: Date.now(),
      symbols: meta.universe.map(
        (asset, index): SymbolInfo => ({
          symbol: this.normalizeSymbol(asset.name),
          status: "online",
          baseAsset: asset.name,
          quoteAsset: "USD",
          baseAssetPrecision: asset.szDecimals,
          quoteAssetPrecision: 2,
          orderTypes: ["MARKET", "LIMIT", "STOP_LOSS", "TAKE_PROFIT"] as OrderType[],
          isSpotTradingAllowed: false, // Perpetuals only
          filters: [
            {
              filterType: "LOT_SIZE",
              stepSize: Math.pow(10, -asset.szDecimals).toString(),
            },
            {
              filterType: "MAX_LEVERAGE",
              maxLeverage: asset.maxLeverage.toString(),
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
    const assetCtxs = await this.client.getAllAssetCtxs();
    const assetIndex = await this.getAssetIndex(symbol);
    const ctx = assetCtxs[assetIndex];
    if (!ctx) {
      throw new Error(`No price data for ${symbol}`);
    }
    return parseFloat(ctx.markPx);
  }

  async getCandles(symbol: string, interval: string, limit?: number): Promise<Candle[]> {
    const coin = symbol.replace(/[-_]?(USD|USDT|USDC|PERP)/gi, "").toUpperCase();
    const hlInterval = this.mapInterval(interval);
    const endTime = Date.now();
    const startTime = endTime - this.getIntervalMs(interval) * (limit || 100);

    const candles = await this.client.getCandles(coin, hlInterval, startTime, endTime);

    return candles.map(
      (c): Candle => ({
        openTime: c[0],
        open: parseFloat(c[1]),
        high: parseFloat(c[2]),
        low: parseFloat(c[3]),
        close: parseFloat(c[4]),
        volume: parseFloat(c[5]),
        closeTime: c[0] + this.getIntervalMs(interval),
      })
    );
  }

  private mapInterval(interval: string): string {
    const map: Record<string, string> = {
      "1m": "1m",
      "5m": "5m",
      "15m": "15m",
      "30m": "30m",
      "1h": "1h",
      "4h": "4h",
      "1d": "1d",
    };
    return map[interval] || "1h";
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
    };
    return map[interval] || 3600000;
  }

  async get24hrTickers(): Promise<Ticker24hr[]> {
    const [meta, assetCtxs] = await Promise.all([
      this.client.getMeta(),
      this.client.getAllAssetCtxs(),
    ]);

    return meta.universe.map((asset, index): Ticker24hr => {
      const ctx = assetCtxs[index];
      const prevPrice = parseFloat(ctx?.prevDayPx || "0");
      const markPrice = parseFloat(ctx?.markPx || "0");
      const priceChange = markPrice - prevPrice;
      const priceChangePercent = prevPrice > 0 ? (priceChange / prevPrice) * 100 : 0;

      return {
        symbol: this.normalizeSymbol(asset.name),
        priceChange,
        priceChangePercent,
        lastPrice: markPrice,
        highPrice: 0, // Not available
        lowPrice: 0,
        volume: parseFloat(ctx?.dayNtlVlm || "0"),
        quoteVolume: parseFloat(ctx?.dayNtlVlm || "0"),
        openTime: Date.now() - 86400000,
        closeTime: Date.now(),
      };
    });
  }

  async getTopSymbols(n: number): Promise<string[]> {
    const tickers = await this.get24hrTickers();
    return tickers
      .sort((a, b) => b.quoteVolume - a.quoteVolume)
      .slice(0, n)
      .map((t) => t.symbol);
  }

  async getOrderBook(symbol: string, limit?: number): Promise<OrderBook> {
    const coin = symbol.replace(/[-_]?(USD|USDT|USDC|PERP)/gi, "").toUpperCase();
    const book = await this.client.getL2Book(coin);

    const maxLevels = limit || 20;

    return {
      lastUpdateId: book.time,
      bids: book.levels[0].slice(0, maxLevels).map((level) => ({
        price: parseFloat(level.px),
        quantity: parseFloat(level.sz),
      })),
      asks: book.levels[1].slice(0, maxLevels).map((level) => ({
        price: parseFloat(level.px),
        quantity: parseFloat(level.sz),
      })),
    };
  }

  async getBookTicker(symbol: string): Promise<BookTicker> {
    const book = await this.getOrderBook(symbol, 1);

    return {
      symbol,
      bidPrice: book.bids[0]?.price || 0,
      bidQty: book.bids[0]?.quantity || 0,
      askPrice: book.asks[0]?.price || 0,
      askQty: book.asks[0]?.quantity || 0,
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
    const assetCtxs = await this.client.getAllAssetCtxs();
    const assetIndex = await this.getAssetIndex(symbol);
    const ctx = assetCtxs[assetIndex];

    return {
      mins: 5,
      price: parseFloat(ctx?.markPx || "0"),
    };
  }

  // -------------------------------------------------------------------------
  // Account
  // -------------------------------------------------------------------------

  async getAccountInfo(): Promise<AccountInfo> {
    const state = await this.client.getUserState();

    // Calculate USD balance from margin summary
    const usdBalance = parseFloat(state.withdrawable || "0");

    return {
      canTrade: true,
      canWithdraw: true,
      canDeposit: true,
      accountType: "PERPETUAL",
      updateTime: Date.now(),
      balances: [
        {
          asset: "USD",
          free: usdBalance,
          locked: parseFloat(state.crossMarginSummary?.totalMarginUsed || "0"),
          total: parseFloat(state.crossMarginSummary?.accountValue || "0"),
        },
      ],
    };
  }

  async getBalance(asset: string): Promise<number> {
    if (asset !== "USD" && asset !== "USDC") {
      // For perpetuals, only USD balance makes sense
      return 0;
    }
    const state = await this.client.getUserState();
    return parseFloat(state.crossMarginSummary?.accountValue || "0");
  }

  async getAllBalances(): Promise<Balance[]> {
    const info = await this.getAccountInfo();
    return info.balances.filter((b) => b.total > 0);
  }

  async getFullAccountDetails(): Promise<AccountDetails> {
    const accountInfo = await this.getAccountInfo();
    const nonZeroBalances = accountInfo.balances.filter((b) => b.total > 0);

    return {
      accountInfo,
      totalUsdtValue: parseFloat(
        (await this.client.getUserState()).crossMarginSummary?.accountValue || "0"
      ),
      nonZeroBalances,
    };
  }

  // -------------------------------------------------------------------------
  // Trading
  // -------------------------------------------------------------------------

  async placeOrder(params: OrderParams): Promise<Order> {
    const assetIndex = await this.getAssetIndex(params.symbol);
    const isBuy = params.side === "BUY";

    let orderType: { limit: { tif: string } } | { trigger: { triggerPx: string; isMarket: boolean; tpsl: string } };

    if (params.type === "MARKET") {
      // Market orders use limit with IOC
      orderType = { limit: { tif: "Ioc" } };
    } else if (params.type === "STOP_LOSS" || params.type === "STOP_LOSS_LIMIT") {
      orderType = {
        trigger: {
          triggerPx: params.stopPrice?.toString() || "0",
          isMarket: params.type === "STOP_LOSS",
          tpsl: "sl",
        },
      };
    } else if (params.type === "TAKE_PROFIT" || params.type === "TAKE_PROFIT_LIMIT") {
      orderType = {
        trigger: {
          triggerPx: params.stopPrice?.toString() || "0",
          isMarket: params.type === "TAKE_PROFIT",
          tpsl: "tp",
        },
      };
    } else {
      orderType = { limit: { tif: params.timeInForce === "IOC" ? "Ioc" : "Gtc" } };
    }

    const response = await this.client.placeOrder(
      assetIndex,
      isBuy,
      params.price?.toString() || "0",
      params.quantity?.toString() || "0",
      false,
      orderType,
      params.newClientOrderId
    );

    if (response.status !== "ok" || !response.response) {
      throw new Error(response.error || "Order placement failed");
    }

    const status = response.response.data.statuses[0];
    if (!status) {
      throw new Error("No order status returned");
    }
    if (status.error) {
      throw new Error(status.error);
    }

    const oid = status.resting?.oid || status.filled?.oid || 0;

    return {
      orderId: oid.toString(),
      clientOrderId: params.newClientOrderId,
      symbol: params.symbol,
      side: params.side,
      type: params.type,
      status: status.filled ? "FILLED" : "NEW",
      price: parseFloat(status.filled?.avgPx || params.price?.toString() || "0"),
      quantity: params.quantity || 0,
      executedQty: parseFloat(status.filled?.totalSz || "0"),
      cummulativeQuoteQty: 0,
      time: Date.now(),
      isWorking: !status.filled,
    };
  }

  async cancelOrder(symbol: string, orderId: string): Promise<void> {
    const assetIndex = await this.getAssetIndex(symbol);
    await this.client.cancelOrder(assetIndex, parseInt(orderId, 10));
  }

  async cancelAllOrders(symbol: string): Promise<Order[]> {
    const openOrders = await this.getOpenOrders(symbol);
    const assetIndex = await this.getAssetIndex(symbol);

    if (openOrders.length > 0) {
      await this.client.cancelOrders(
        openOrders.map((o) => ({
          assetIndex,
          oid: parseInt(o.orderId, 10),
        }))
      );
    }

    return openOrders;
  }

  async getOpenOrders(symbol?: string): Promise<Order[]> {
    const orders = await this.client.getOpenOrders();

    let filtered = orders;
    if (symbol) {
      const coin = symbol.replace(/[-_]?(USD|USDT|USDC|PERP)/gi, "").toUpperCase();
      filtered = orders.filter((o) => o.coin === coin);
    }

    return filtered.map((o): Order => ({
      orderId: o.oid.toString(),
      clientOrderId: o.cloid,
      symbol: this.normalizeSymbol(o.coin),
      side: o.side === "B" ? "BUY" : "SELL",
      type: "LIMIT",
      status: "NEW",
      price: parseFloat(o.limitPx),
      quantity: parseFloat(o.origSz),
      executedQty: parseFloat(o.origSz) - parseFloat(o.sz),
      cummulativeQuoteQty: 0,
      time: o.timestamp,
      isWorking: true,
    }));
  }

  async getOrderStatus(symbol: string, orderId: number | string): Promise<Order> {
    const allOrders = await this.client.getAllOrders();
    const order = allOrders.find((o) => o.order.oid === parseInt(orderId.toString(), 10));

    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    return {
      orderId: order.order.oid.toString(),
      clientOrderId: order.order.cloid,
      symbol: this.normalizeSymbol(order.order.coin),
      side: order.order.side === "B" ? "BUY" : "SELL",
      type: "LIMIT",
      status: this.mapOrderStatus(order.status),
      price: parseFloat(order.order.limitPx),
      quantity: parseFloat(order.order.origSz),
      executedQty: parseFloat(order.order.origSz) - parseFloat(order.order.sz),
      cummulativeQuoteQty: 0,
      time: order.order.timestamp,
      updateTime: order.statusTimestamp,
      isWorking: order.status === "open",
    };
  }

  private mapOrderStatus(status: string): OrderStatus {
    const map: Record<string, OrderStatus> = {
      open: "NEW",
      filled: "FILLED",
      canceled: "CANCELED",
      triggered: "NEW",
      rejected: "REJECTED",
      marginCanceled: "CANCELED",
    };
    return map[status] || "NEW";
  }

  async testOrder(params: OrderParams): Promise<boolean> {
    // Validate parameters
    if (!params.symbol || !params.side || !params.type) {
      return false;
    }
    if (!params.quantity) {
      return false;
    }

    try {
      await this.getAssetIndex(params.symbol);
      return true;
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // History
  // -------------------------------------------------------------------------

  async getTradeHistory(symbol: string, limit?: number): Promise<Trade[]> {
    const fills = await this.client.getUserFills();

    let filtered = fills;
    if (symbol) {
      const coin = symbol.replace(/[-_]?(USD|USDT|USDC|PERP)/gi, "").toUpperCase();
      filtered = fills.filter((f) => f.coin === coin);
    }

    return filtered.slice(0, limit || 50).map(
      (f): Trade => ({
        id: f.tid.toString(),
        orderId: f.oid.toString(),
        symbol: this.normalizeSymbol(f.coin),
        side: f.side === "B" ? "BUY" : "SELL",
        price: parseFloat(f.px),
        quantity: parseFloat(f.sz),
        commission: parseFloat(f.fee),
        commissionAsset: f.feeToken || "USD",
        time: f.time,
        isMaker: !f.crossed,
      })
    );
  }

  async getOrderHistory(symbol: string, limit?: number): Promise<Order[]> {
    const allOrders = await this.client.getAllOrders();

    let filtered = allOrders;
    if (symbol) {
      const coin = symbol.replace(/[-_]?(USD|USDT|USDC|PERP)/gi, "").toUpperCase();
      filtered = allOrders.filter((o) => o.order.coin === coin);
    }

    return filtered.slice(0, limit || 50).map((o): Order => ({
      orderId: o.order.oid.toString(),
      clientOrderId: o.order.cloid,
      symbol: this.normalizeSymbol(o.order.coin),
      side: o.order.side === "B" ? "BUY" : "SELL",
      type: "LIMIT",
      status: this.mapOrderStatus(o.status),
      price: parseFloat(o.order.limitPx),
      quantity: parseFloat(o.order.origSz),
      executedQty: parseFloat(o.order.origSz) - parseFloat(o.order.sz),
      cummulativeQuoteQty: 0,
      time: o.order.timestamp,
      updateTime: o.statusTimestamp,
      isWorking: o.status === "open",
    }));
  }

  async getDepositHistory(limit?: number): Promise<Deposit[]> {
    // Hyperliquid doesn't have traditional deposits - uses L1 bridge
    throw new HyperliquidNotSupportedError("getDepositHistory");
  }

  async getWithdrawalHistory(limit?: number): Promise<Withdrawal[]> {
    // Hyperliquid doesn't have traditional withdrawals - uses L1 bridge
    throw new HyperliquidNotSupportedError("getWithdrawalHistory");
  }

  // -------------------------------------------------------------------------
  // Withdrawals (ExchangeExtended)
  // -------------------------------------------------------------------------

  async withdraw(
    _coin: string,
    _network: string,
    _address: string,
    _amount: number,
    _tag?: string,
  ): Promise<WithdrawalResult> {
    // Hyperliquid uses L1 bridge for withdrawals — requires on-chain transaction signing
    throw new HyperliquidNotSupportedError(
      "withdraw — Hyperliquid uses L1 bridge. Use the Hyperliquid UI to withdraw."
    );
  }

  async getWithdrawalInfo(_coin: string, _network?: string): Promise<WithdrawalInfo> {
    throw new HyperliquidNotSupportedError(
      "getWithdrawalInfo — Hyperliquid uses L1 bridge for withdrawals."
    );
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
