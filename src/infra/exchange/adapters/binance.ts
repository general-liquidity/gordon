/**
 * Binance Exchange Adapter
 * Wraps BinanceClient to implement the abstract Exchange interface
 */

import { BinanceClient } from "../../venues/exchange/clients/binance/index.ts";
import { registerSymbols } from "../../../tui/components/markdownPalette.ts";
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
  WithdrawalResult,
  WithdrawalInfo,
} from "../types.ts";
import type { Candle } from "../../../types/index.ts";

/**
 * BinanceAdapter - Adapts BinanceClient to the Exchange interface
 *
 * This adapter allows the existing BinanceClient to be used through
 * the abstract Exchange interface, enabling multi-exchange support
 * without modifying the original implementation.
 */
/**
 * Binance Spot Testnet URL — fake-money sandbox. Separate API keys issued
 * from https://testnet.binance.vision; keys are preserved across monthly
 * data resets.
 */
const BINANCE_TESTNET_URL = "https://testnet.binance.vision";

export class BinanceAdapter implements Exchange {
  protected client: BinanceClient;
  readonly isSandbox: boolean;

  readonly exchangeId: ExchangeId = "binance";
  readonly displayName: string = "Binance";

  constructor(
    apiKeyOrClient: string | BinanceClient,
    apiSecret?: string,
    sandbox?: boolean,
  ) {
    this.isSandbox = Boolean(sandbox);
    if (typeof apiKeyOrClient === "string") {
      const baseUrl = this.isSandbox ? BINANCE_TESTNET_URL : undefined;
      this.client = new BinanceClient(apiKeyOrClient, apiSecret!, baseUrl);
    } else {
      this.client = apiKeyOrClient;
    }
  }

  /**
   * Get the underlying BinanceClient for direct access to Binance-specific features
   * @deprecated Use Exchange interface methods when possible
   */
  getUnderlyingClient(): BinanceClient {
    return this.client;
  }

  // -------------------------------------------------------------------------
  // Connection
  // -------------------------------------------------------------------------

  async testConnection(): Promise<boolean> {
    return this.client.testConnection();
  }

  async getExchangeInfo(): Promise<ExchangeInfo> {
    const info = await this.client.getExchangeInfo();
    // Populate the markdown ticker registry so any symbol Binance lists
    // colors correctly when mentioned in chat — no hardcoded universe.
    registerSymbols(info.symbols.flatMap((s) => [s.baseAsset, s.quoteAsset]));
    return {
      timezone: info.timezone,
      serverTime: info.serverTime,
      symbols: info.symbols.map(
        (s): SymbolInfo => ({
          symbol: s.symbol,
          status: s.status,
          baseAsset: s.baseAsset,
          quoteAsset: s.quoteAsset,
          baseAssetPrecision: s.baseAssetPrecision,
          quoteAssetPrecision: s.quoteAssetPrecision,
          orderTypes: s.orderTypes,
          isSpotTradingAllowed: s.isSpotTradingAllowed,
          // Map Binance filters to our generic filter type
          filters: s.filters.map((f) => ({ ...f })),
        })
      ),
    };
  }

  // -------------------------------------------------------------------------
  // Market Data
  // -------------------------------------------------------------------------

  async getPrice(symbol: string): Promise<number> {
    return this.client.getPrice(symbol);
  }

  async getCandles(symbol: string, interval: string, limit?: number): Promise<Candle[]> {
    return this.client.getCandles(symbol, interval, limit);
  }

  async get24hrTickers(): Promise<Ticker24hr[]> {
    const tickers = await this.client.get24hrTickers();
    return tickers.map(
      (t): Ticker24hr => ({
        symbol: t.symbol,
        priceChange: parseFloat(t.priceChange),
        priceChangePercent: parseFloat(t.priceChangePercent),
        lastPrice: parseFloat(t.lastPrice),
        highPrice: parseFloat(t.highPrice),
        lowPrice: parseFloat(t.lowPrice),
        volume: parseFloat(t.volume),
        quoteVolume: parseFloat(t.quoteVolume),
        openTime: t.openTime,
        closeTime: t.closeTime,
      })
    );
  }

  async getTopSymbols(n: number): Promise<string[]> {
    return this.client.getTopSymbols(n);
  }

  async getOrderBook(symbol: string, limit?: number): Promise<OrderBook> {
    const book = await this.client.getOrderBook(symbol, limit);
    return {
      lastUpdateId: book.lastUpdateId,
      bids: book.bids.map(([price, qty]) => ({
        price: parseFloat(price),
        quantity: parseFloat(qty),
      })),
      asks: book.asks.map(([price, qty]) => ({
        price: parseFloat(price),
        quantity: parseFloat(qty),
      })),
    };
  }

  async getBookTicker(symbol: string): Promise<BookTicker> {
    const ticker = await this.client.getBookTicker(symbol);
    // Handle both single and array response
    const t = Array.isArray(ticker) ? ticker[0] : ticker;
    if (!t) {
      throw new Error(`No book ticker data available for ${symbol}`);
    }
    return {
      symbol: t.symbol,
      bidPrice: parseFloat(t.bidPrice),
      bidQty: parseFloat(t.bidQty),
      askPrice: parseFloat(t.askPrice),
      askQty: parseFloat(t.askQty),
    };
  }

  async getSpread(symbol: string): Promise<SpreadInfo> {
    return this.client.getSpread(symbol);
  }

  async getAvgPrice(symbol: string): Promise<AvgPrice> {
    const avg = await this.client.getAvgPrice(symbol);
    return {
      mins: avg.mins,
      price: parseFloat(avg.price),
    };
  }

  // -------------------------------------------------------------------------
  // Account
  // -------------------------------------------------------------------------

  async getAccountInfo(): Promise<AccountInfo> {
    const info = await this.client.getAccountInfo();
    return {
      canTrade: info.canTrade,
      canWithdraw: info.canWithdraw,
      canDeposit: info.canDeposit,
      accountType: info.accountType,
      updateTime: info.updateTime,
      balances: info.balances.map(
        (b): Balance => ({
          asset: b.asset,
          free: parseFloat(b.free),
          locked: parseFloat(b.locked),
          total: parseFloat(b.free) + parseFloat(b.locked),
        })
      ),
    };
  }

  async getBalance(asset: string): Promise<number> {
    return this.client.getBalance(asset);
  }

  async getAllBalances(): Promise<Balance[]> {
    const balances = await this.client.getAllBalances();
    return balances.map(
      (b): Balance => ({
        asset: b.asset,
        free: b.free,
        locked: b.locked,
        total: b.free + b.locked,
      })
    );
  }

  async getFullAccountDetails(): Promise<AccountDetails> {
    // Get account info
    const accountInfo = await this.getAccountInfo();

    // Get all balances to calculate totals
    const allBalances = await this.getAllBalances();

    // Filter non-zero balances
    const nonZeroBalances = allBalances.filter((b) => b.total > 0);

    // Calculate total USD value: sum stablecoins directly, convert others via ticker price
    const STABLES = new Set(["USDT", "BUSD", "USDC", "TUSD", "FDUSD"]);
    const stableValue = nonZeroBalances
      .filter((b) => STABLES.has(b.asset))
      .reduce((sum, b) => sum + b.total, 0);

    // Fetch prices for non-stable assets in parallel
    const nonStable = nonZeroBalances.filter((b) => !STABLES.has(b.asset));
    const priceResults = await Promise.allSettled(
      nonStable.map(async (b) => {
        try {
          const raw = await this.client.getBookTicker(`${b.asset}USDT`);
          const ticker = Array.isArray(raw) ? raw[0] : raw;
          if (!ticker) return 0;
          const mid = (parseFloat(ticker.bidPrice) + parseFloat(ticker.askPrice)) / 2;
          return b.total * mid;
        } catch {
          return 0; // No USDT pair available for this asset
        }
      })
    );
    const nonStableValue = priceResults.reduce(
      (sum, r) => sum + (r.status === "fulfilled" ? r.value : 0), 0
    );
    const totalUsdtValue = stableValue + nonStableValue;

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
    const order = await this.client.placeOrder({
      symbol: params.symbol,
      side: params.side,
      type: params.type,
      quantity: params.quantity,
      quoteOrderQty: params.quoteOrderQty,
      price: params.price,
      stopPrice: params.stopPrice,
      timeInForce: params.timeInForce,
      newClientOrderId: params.newClientOrderId,
    });
    return this.normalizeOrder(order);
  }

  async cancelOrder(symbol: string, orderId: string): Promise<void> {
    await this.client.cancelOrder(symbol, orderId);
  }

  async cancelAllOrders(symbol: string): Promise<Order[]> {
    const orders = await this.client.cancelAllOrders(symbol);
    return orders.map((o) => this.normalizeOrder(o));
  }

  async getOpenOrders(symbol?: string): Promise<Order[]> {
    const orders = await this.client.getOpenOrders(symbol);
    return orders.map((o) => this.normalizeOrder(o));
  }

  async getOrderStatus(symbol: string, orderId: number | string): Promise<Order> {
    const id = typeof orderId === "string" ? parseInt(orderId, 10) : orderId;
    const order = await this.client.getOrderStatus(symbol, id);
    return this.normalizeOrder(order);
  }

  async testOrder(params: OrderParams): Promise<boolean> {
    return this.client.testOrder({
      symbol: params.symbol,
      side: params.side,
      type: params.type,
      quantity: params.quantity,
      quoteOrderQty: params.quoteOrderQty,
      price: params.price,
      stopPrice: params.stopPrice,
      timeInForce: params.timeInForce,
    });
  }

  // -------------------------------------------------------------------------
  // History
  // -------------------------------------------------------------------------

  async getTradeHistory(symbol: string, limit?: number): Promise<Trade[]> {
    const trades = await this.client.getTradeHistory(symbol, limit);
    return trades.map(
      (t): Trade => ({
        id: t.id.toString(),
        orderId: t.orderId.toString(),
        symbol: t.symbol,
        side: t.isBuyer ? "BUY" : "SELL",
        price: parseFloat(t.price),
        quantity: parseFloat(t.qty),
        commission: parseFloat(t.commission),
        commissionAsset: t.commissionAsset,
        time: t.time,
        isMaker: t.isMaker,
      })
    );
  }

  async getOrderHistory(symbol: string, limit?: number): Promise<Order[]> {
    const orders = await this.client.getOrderHistory(symbol, limit);
    return orders.map((o) => this.normalizeOrder(o));
  }

  async getDepositHistory(limit?: number): Promise<Deposit[]> {
    const deposits = await this.client.getDepositHistory(limit);
    return deposits.map(
      (d): Deposit => ({
        id: d.id ?? d.txId ?? `dep_${d.coin}_${d.insertTime}`,
        amount: parseFloat(String(d.amount)),
        coin: d.coin,
        network: d.network,
        status: d.status,
        address: d.address,
        txId: d.txId,
        insertTime: d.insertTime,
        confirmTimes: d.confirmTimes,
      })
    );
  }

  async getWithdrawalHistory(limit?: number): Promise<Withdrawal[]> {
    const withdrawals = await this.client.getWithdrawalHistory(limit);
    return withdrawals.map(
      (w): Withdrawal => ({
        id: w.id,
        amount: parseFloat(String(w.amount)),
        coin: w.coin,
        network: w.network,
        status: w.status,
        address: w.address,
        txId: w.txId,
        applyTime: new Date(w.applyTime).getTime(),
        transactionFee: w.transactionFee ? parseFloat(String(w.transactionFee)) : undefined,
      })
    );
  }

  // -------------------------------------------------------------------------
  // Rate Limiting & Status
  // -------------------------------------------------------------------------

  shouldThrottle(): boolean {
    return this.client.shouldThrottle();
  }

  getRateLimitStatus(): RateLimitStatus {
    return this.client.getRateLimitStatus();
  }

  getCircuitBreakerState(): string {
    return this.client.getCircuitBreakerState();
  }

  resetCircuitBreaker(): void {
    this.client.resetCircuitBreaker();
  }

  // -------------------------------------------------------------------------
  // Withdrawals (Optional)
  // -------------------------------------------------------------------------

  async withdraw(
    coin: string,
    network: string,
    address: string,
    amount: number,
    tag?: string
  ): Promise<WithdrawalResult> {
    const result = await this.client.withdraw(coin, network, address, amount, tag);

    return {
      id: result.id,
      coin: coin.toUpperCase(),
      amount,
      network,
      address,
      fee: 0, // Fee is deducted by Binance, not returned in the response
      status: "SUBMITTED",
    };
  }

  async getWithdrawalInfo(coin: string, _network?: string): Promise<WithdrawalInfo> {
    const info = await this.client.getCoinNetworks(coin);

    if (!info) {
      throw new Error(`Coin ${coin} not found on Binance.`);
    }

    return {
      coin: info.coin,
      networks: info.networkList.map((n) => ({
        network: n.network,
        name: n.name,
        withdrawEnabled: n.withdrawEnable,
        withdrawFee: parseFloat(n.withdrawFee),
        withdrawMin: parseFloat(n.withdrawMin),
        withdrawMax: parseFloat(n.withdrawMax),
        estimatedArrivalMins: n.estimatedArrivalTime,
      })),
    };
  }

  // -------------------------------------------------------------------------
  // Private Helpers
  // -------------------------------------------------------------------------

  private normalizeOrder(order: {
    orderId: number;
    clientOrderId?: string;
    symbol: string;
    side: "BUY" | "SELL";
    type: string;
    status: string;
    price: string;
    origQty: string;
    executedQty: string;
    cummulativeQuoteQty: string;
    timeInForce?: string;
    stopPrice?: string;
    time?: number;
    updateTime?: number;
    isWorking?: boolean;
  }): Order {
    return {
      orderId: order.orderId.toString(),
      clientOrderId: order.clientOrderId,
      symbol: order.symbol,
      side: order.side,
      type: order.type as Order["type"],
      status: order.status as Order["status"],
      price: parseFloat(order.price),
      quantity: parseFloat(order.origQty),
      executedQty: parseFloat(order.executedQty),
      cummulativeQuoteQty: parseFloat(order.cummulativeQuoteQty),
      timeInForce: order.timeInForce as Order["timeInForce"],
      stopPrice: order.stopPrice ? parseFloat(order.stopPrice) : undefined,
      time: order.time,
      updateTime: order.updateTime,
      isWorking: order.isWorking,
    };
  }
}
