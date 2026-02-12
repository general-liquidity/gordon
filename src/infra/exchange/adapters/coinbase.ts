/**
 * Coinbase Exchange Adapter
 * Wraps CoinbaseClient to implement the abstract Exchange interface
 */

import { CoinbaseClient } from "../../coinbase/index.ts";
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
import { v4 as uuidv4 } from "uuid";

/**
 * CoinbaseAdapter - Adapts CoinbaseClient to the Exchange interface
 */
export class CoinbaseAdapter implements Exchange {
  private client: CoinbaseClient;

  readonly exchangeId: ExchangeId = "coinbase";
  readonly displayName = "Coinbase";

  constructor(apiKey: string, apiSecret: string, passphrase: string) {
    this.client = new CoinbaseClient(apiKey, apiSecret, passphrase);
  }

  // -------------------------------------------------------------------------
  // Symbol Conversion Helpers
  // -------------------------------------------------------------------------

  /**
   * Convert standard symbol (BTCUSD) to Coinbase format (BTC-USD)
   */
  private toCoinbaseSymbol(symbol: string): string {
    // Common quote currencies
    const quotes = ["USDT", "USDC", "USD", "EUR", "GBP", "BTC", "ETH"];
    for (const quote of quotes) {
      if (symbol.endsWith(quote)) {
        const base = symbol.slice(0, -quote.length);
        return `${base}-${quote}`;
      }
    }
    return symbol;
  }

  /**
   * Convert Coinbase symbol (BTC-USD) to standard format (BTCUSD)
   */
  private fromCoinbaseSymbol(symbol: string): string {
    return symbol.replace("-", "");
  }

  // -------------------------------------------------------------------------
  // Connection
  // -------------------------------------------------------------------------

  async testConnection(): Promise<boolean> {
    return this.client.testConnection();
  }

  async getExchangeInfo(): Promise<ExchangeInfo> {
    const products = await this.client.getProducts();
    return {
      timezone: "UTC",
      serverTime: Date.now(),
      symbols: products
        .filter((p) => !p.is_disabled && !p.trading_disabled)
        .map(
          (p): SymbolInfo => ({
            symbol: this.fromCoinbaseSymbol(p.product_id),
            status: p.status,
            baseAsset: p.base_currency_id,
            quoteAsset: p.quote_currency_id,
            baseAssetPrecision: this.getPrecision(p.base_increment),
            quoteAssetPrecision: this.getPrecision(p.quote_increment),
            orderTypes: ["MARKET", "LIMIT", "STOP_LOSS", "STOP_LOSS_LIMIT"] as OrderType[],
            isSpotTradingAllowed: !p.trading_disabled,
            filters: [
              {
                filterType: "LOT_SIZE",
                minQty: p.base_min_size,
                maxQty: p.base_max_size,
                stepSize: p.base_increment,
              },
              {
                filterType: "PRICE_FILTER",
                tickSize: p.price_increment,
              },
              {
                filterType: "NOTIONAL",
                minNotional: p.quote_min_size,
              },
            ],
          })
        ),
    };
  }

  private getPrecision(increment: string): number {
    const dec = increment.indexOf(".");
    if (dec === -1) return 0;
    return increment.length - dec - 1;
  }

  // -------------------------------------------------------------------------
  // Market Data
  // -------------------------------------------------------------------------

  async getPrice(symbol: string): Promise<number> {
    const product = await this.client.getProduct(this.toCoinbaseSymbol(symbol));
    return parseFloat(product.price);
  }

  async getCandles(symbol: string, interval: string, limit?: number): Promise<Candle[]> {
    const coinbaseSymbol = this.toCoinbaseSymbol(symbol);
    const candles = await this.client.getCandles(coinbaseSymbol, interval);

    // Coinbase returns newest first, reverse for consistency
    const sorted = [...candles].reverse().slice(0, limit || 100);

    return sorted.map((c) => ({
      openTime: parseInt(c.start) * 1000,
      open: parseFloat(c.open),
      high: parseFloat(c.high),
      low: parseFloat(c.low),
      close: parseFloat(c.close),
      volume: parseFloat(c.volume),
      closeTime: parseInt(c.start) * 1000 + this.getIntervalMs(interval),
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
      "6h": 21600000,
      "1d": 86400000,
    };
    return map[interval] || 3600000;
  }

  async get24hrTickers(): Promise<Ticker24hr[]> {
    const products = await this.client.getProducts();
    return products
      .filter((p) => !p.is_disabled)
      .map(
        (p): Ticker24hr => {
          const lastPrice = parseFloat(p.price);
          const pctChange = parseFloat(p.price_percentage_change_24h) || 0;
          // Derive open price: openPrice = lastPrice / (1 + pct/100)
          const openPrice = pctChange !== -100 ? lastPrice / (1 + pctChange / 100) : 0;
          const priceChange = lastPrice - openPrice;

          return {
            symbol: this.fromCoinbaseSymbol(p.product_id),
            priceChange,
            priceChangePercent: pctChange,
            lastPrice,
            highPrice: 0, // Not available in Coinbase Advanced Trade products API
            lowPrice: 0,
            volume: parseFloat(p.volume_24h),
            quoteVolume: parseFloat(p.volume_24h) * lastPrice,
            openTime: Date.now() - 86400000,
            closeTime: Date.now(),
          };
        }
      );
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
    const book = await this.client.getProductBook(this.toCoinbaseSymbol(symbol), limit);
    return {
      lastUpdateId: Date.now(),
      bids: book.pricebook.bids.map((b) => ({
        price: parseFloat(b.price),
        quantity: parseFloat(b.size),
      })),
      asks: book.pricebook.asks.map((a) => ({
        price: parseFloat(a.price),
        quantity: parseFloat(a.size),
      })),
    };
  }

  async getBookTicker(symbol: string): Promise<BookTicker> {
    const coinbaseSymbol = this.toCoinbaseSymbol(symbol);
    const pricebooks = await this.client.getBestBidAsk([coinbaseSymbol]);
    const book = pricebooks[0];

    if (!book) {
      throw new Error(`No book ticker data available for ${symbol}`);
    }

    return {
      symbol,
      bidPrice: book.bids[0] ? parseFloat(book.bids[0].price) : 0,
      bidQty: book.bids[0] ? parseFloat(book.bids[0].size) : 0,
      askPrice: book.asks[0] ? parseFloat(book.asks[0].price) : 0,
      askQty: book.asks[0] ? parseFloat(book.asks[0].size) : 0,
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
    // Compute VWAP from recent 5-minute candles (last ~30 min)
    try {
      const candles = await this.getCandles(symbol, "5m", 6);
      if (candles.length > 0) {
        let volumeSum = 0;
        let vwapSum = 0;
        for (const c of candles) {
          const typical = (c.high + c.low + c.close) / 3;
          vwapSum += typical * c.volume;
          volumeSum += c.volume;
        }
        if (volumeSum > 0) {
          return { mins: 30, price: vwapSum / volumeSum };
        }
      }
    } catch {
      // Fall back to current price
    }
    const price = await this.getPrice(symbol);
    return { mins: 5, price };
  }

  // -------------------------------------------------------------------------
  // Account
  // -------------------------------------------------------------------------

  async getAccountInfo(): Promise<AccountInfo> {
    const accounts = await this.client.getAccounts();
    return {
      canTrade: true,
      canWithdraw: true,
      canDeposit: true,
      accountType: "SPOT",
      updateTime: Date.now(),
      balances: accounts.map(
        (a): Balance => ({
          asset: a.currency,
          free: parseFloat(a.available_balance.value),
          locked: parseFloat(a.hold.value),
          total: parseFloat(a.available_balance.value) + parseFloat(a.hold.value),
        })
      ),
    };
  }

  async getBalance(asset: string): Promise<number> {
    const accounts = await this.client.getAccounts();
    const account = accounts.find((a) => a.currency === asset);
    return account
      ? parseFloat(account.available_balance.value) + parseFloat(account.hold.value)
      : 0;
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
      (b) => b.asset === "USD" || b.asset === "USDC" || b.asset === "USDT"
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
    const coinbaseSymbol = this.toCoinbaseSymbol(params.symbol);
    const clientOrderId = params.newClientOrderId || uuidv4();

    let orderConfig: Record<string, unknown> = {};

    if (params.type === "MARKET") {
      orderConfig = {
        market_market_ioc: params.quoteOrderQty
          ? { quote_size: params.quoteOrderQty.toString() }
          : { base_size: params.quantity?.toString() },
      };
    } else if (params.type === "LIMIT" && params.price && params.stopPrice) {
      // OCO (bracket) order: limit + stop-trigger — check before basic LIMIT
      orderConfig = {
        trigger_bracket_gtc: {
          base_size: params.quantity?.toString(),
          limit_price: params.price.toString(),
          stop_trigger_price: params.stopPrice.toString(),
        },
      };
    } else if (params.type === "LIMIT") {
      orderConfig = {
        limit_limit_gtc: {
          base_size: params.quantity?.toString(),
          limit_price: params.price?.toString(),
          post_only: false,
        },
      };
    } else if (params.type === "STOP_LOSS_LIMIT" && params.stopPrice && params.price) {
      orderConfig = {
        stop_limit_stop_limit_gtc: {
          base_size: params.quantity?.toString(),
          limit_price: params.price.toString(),
          stop_price: params.stopPrice.toString(),
          stop_direction:
            params.side === "BUY"
              ? "STOP_DIRECTION_STOP_UP"
              : "STOP_DIRECTION_STOP_DOWN",
        },
      };
    }

    const response = await this.client.createOrder({
      client_order_id: clientOrderId,
      product_id: coinbaseSymbol,
      side: params.side,
      order_configuration: orderConfig as any,
    });

    if (!response.success) {
      throw new Error(
        response.error_response?.message || response.failure_reason || "Order failed"
      );
    }

    // Fetch the created order to get full details
    const order = await this.client.getOrder(response.order_id);
    return this.normalizeOrder(order);
  }

  async cancelOrder(symbol: string, orderId: string): Promise<void> {
    const response = await this.client.cancelOrders([orderId]);
    const result = response.results[0];
    if (!result?.success) {
      throw new Error(result?.failure_reason || "Failed to cancel order");
    }
  }

  async cancelAllOrders(symbol: string): Promise<Order[]> {
    const coinbaseSymbol = this.toCoinbaseSymbol(symbol);
    const openOrders = await this.client.listOrders({
      product_id: coinbaseSymbol,
      order_status: ["OPEN", "PENDING"],
    });

    if (openOrders.orders.length === 0) {
      return [];
    }

    const orderIds = openOrders.orders.map((o) => o.order_id);
    await this.client.cancelOrders(orderIds);

    return openOrders.orders.map((o) => this.normalizeOrder(o));
  }

  async getOpenOrders(symbol?: string): Promise<Order[]> {
    const params: { product_id?: string; order_status: string[] } = {
      order_status: ["OPEN", "PENDING"],
    };
    if (symbol) {
      params.product_id = this.toCoinbaseSymbol(symbol);
    }

    const response = await this.client.listOrders(params);
    return response.orders.map((o) => this.normalizeOrder(o));
  }

  async getOrderStatus(symbol: string, orderId: number | string): Promise<Order> {
    const order = await this.client.getOrder(orderId.toString());
    return this.normalizeOrder(order);
  }

  async testOrder(params: OrderParams): Promise<boolean> {
    // Use Coinbase's real order preview endpoint for server-side dry-run
    try {
      const coinbaseSymbol = this.toCoinbaseSymbol(params.symbol);
      const clientOrderId = params.newClientOrderId || uuidv4();

      let orderConfig: Record<string, unknown> = {};

      if (params.type === "MARKET") {
        orderConfig = {
          market_market_ioc: params.quoteOrderQty
            ? { quote_size: params.quoteOrderQty.toString() }
            : { base_size: params.quantity?.toString() },
        };
      } else if (params.type === "LIMIT") {
        orderConfig = {
          limit_limit_gtc: {
            base_size: params.quantity?.toString(),
            limit_price: params.price?.toString(),
            post_only: false,
          },
        };
      } else if (params.type === "STOP_LOSS_LIMIT" && params.stopPrice && params.price) {
        orderConfig = {
          stop_limit_stop_limit_gtc: {
            base_size: params.quantity?.toString(),
            limit_price: params.price.toString(),
            stop_price: params.stopPrice.toString(),
            stop_direction:
              params.side === "BUY"
                ? "STOP_DIRECTION_STOP_UP"
                : "STOP_DIRECTION_STOP_DOWN",
          },
        };
      }

      const preview = await this.client.previewOrder({
        client_order_id: clientOrderId,
        product_id: coinbaseSymbol,
        side: params.side,
        order_configuration: orderConfig as any,
      });

      // If errs array is non-empty, the order would fail
      return !preview.errs || preview.errs.length === 0;
    } catch {
      return false;
    }
  }

  private normalizeOrder(order: any): Order {
    // Extract size and price from order configuration
    let quantity = 0;
    let price = 0;
    const config = order.order_configuration;

    if (config?.market_market_ioc) {
      quantity = parseFloat(config.market_market_ioc.base_size || "0");
    } else if (config?.limit_limit_gtc) {
      quantity = parseFloat(config.limit_limit_gtc.base_size || "0");
      price = parseFloat(config.limit_limit_gtc.limit_price || "0");
    } else if (config?.stop_limit_stop_limit_gtc) {
      quantity = parseFloat(config.stop_limit_stop_limit_gtc.base_size || "0");
      price = parseFloat(config.stop_limit_stop_limit_gtc.limit_price || "0");
    } else if (config?.trigger_bracket_gtc) {
      quantity = parseFloat(config.trigger_bracket_gtc.base_size || "0");
      price = parseFloat(config.trigger_bracket_gtc.limit_price || "0");
    }

    return {
      orderId: order.order_id,
      clientOrderId: order.client_order_id,
      symbol: this.fromCoinbaseSymbol(order.product_id),
      side: order.side,
      type: this.mapOrderType(order.order_type),
      status: this.mapOrderStatus(order.status),
      price: price || parseFloat(order.average_filled_price || "0"),
      quantity,
      executedQty: parseFloat(order.filled_size || "0"),
      cummulativeQuoteQty: parseFloat(order.filled_value || "0"),
      timeInForce: order.time_in_force,
      time: new Date(order.created_time).getTime(),
      updateTime: order.last_fill_time
        ? new Date(order.last_fill_time).getTime()
        : undefined,
      isWorking: order.status === "OPEN",
    };
  }

  private mapOrderType(type: string): OrderType {
    const map: Record<string, OrderType> = {
      MARKET: "MARKET",
      LIMIT: "LIMIT",
      STOP: "STOP_LOSS",
      STOP_LIMIT: "STOP_LOSS_LIMIT",
    };
    return map[type] || "MARKET";
  }

  private mapOrderStatus(status: string): OrderStatus {
    const map: Record<string, OrderStatus> = {
      PENDING: "NEW",
      OPEN: "NEW",
      FILLED: "FILLED",
      CANCELLED: "CANCELED",
      EXPIRED: "EXPIRED",
      FAILED: "REJECTED",
    };
    return map[status] || "NEW";
  }

  // -------------------------------------------------------------------------
  // History
  // -------------------------------------------------------------------------

  async getTradeHistory(symbol: string, limit?: number): Promise<Trade[]> {
    const coinbaseSymbol = this.toCoinbaseSymbol(symbol);
    const response = await this.client.listFills({
      product_id: coinbaseSymbol,
      limit: limit || 50,
    });

    return response.fills.map(
      (f): Trade => ({
        id: f.trade_id,
        orderId: f.order_id,
        symbol: this.fromCoinbaseSymbol(f.product_id),
        side: f.side,
        price: parseFloat(f.price),
        quantity: parseFloat(f.size),
        commission: parseFloat(f.commission),
        commissionAsset: f.product_id.split("-")[1] || "USD",
        time: new Date(f.trade_time).getTime(),
        isMaker: f.liquidity_indicator === "MAKER",
      })
    );
  }

  async getOrderHistory(symbol: string, limit?: number): Promise<Order[]> {
    const coinbaseSymbol = this.toCoinbaseSymbol(symbol);
    const response = await this.client.listOrders({
      product_id: coinbaseSymbol,
      limit: limit || 50,
    });

    return response.orders.map((o) => this.normalizeOrder(o));
  }

  async getDepositHistory(limit?: number): Promise<Deposit[]> {
    // V2 API: deposits appear as "receive" or "transfer" type transactions
    const accounts = await this.client.getV2Accounts();
    const deposits: Deposit[] = [];
    const maxResults = limit || 50;

    for (const account of accounts) {
      if (deposits.length >= maxResults) break;
      if (parseFloat(account.balance.amount) === 0 && account.type !== "fiat") continue;

      try {
        const transactions = await this.client.getV2Transactions(account.id, maxResults);
        for (const tx of transactions) {
          if (tx.type !== "receive" && tx.type !== "transfer") continue;
          deposits.push({
            id: tx.id,
            amount: Math.abs(parseFloat(tx.amount.amount)),
            coin: tx.amount.currency,
            network: tx.network?.status || "unknown",
            status: this.mapV2TransactionStatus(tx.status),
            address: tx.from?.address || "",
            txId: tx.network?.hash || undefined,
            insertTime: new Date(tx.created_at).getTime(),
            confirmTimes: tx.network?.confirmations !== undefined
              ? `${tx.network.confirmations}`
              : undefined,
          });
        }
      } catch {
        // Skip accounts that fail (e.g., zero-balance legacy accounts)
      }
    }

    return deposits.slice(0, maxResults);
  }

  async getWithdrawalHistory(limit?: number): Promise<Withdrawal[]> {
    // V2 API: withdrawals appear as "send" type transactions
    const accounts = await this.client.getV2Accounts();
    const withdrawals: Withdrawal[] = [];
    const maxResults = limit || 50;

    for (const account of accounts) {
      if (withdrawals.length >= maxResults) break;
      if (parseFloat(account.balance.amount) === 0 && account.type !== "fiat") continue;

      try {
        const transactions = await this.client.getV2Transactions(account.id, maxResults);
        for (const tx of transactions) {
          if (tx.type !== "send") continue;
          withdrawals.push({
            id: tx.id,
            amount: Math.abs(parseFloat(tx.amount.amount)),
            coin: tx.amount.currency,
            network: tx.network?.status || "unknown",
            status: this.mapV2TransactionStatus(tx.status),
            address: tx.to?.address || "",
            txId: tx.network?.hash || undefined,
            applyTime: new Date(tx.created_at).getTime(),
            completeTime: tx.status === "completed"
              ? new Date(tx.updated_at).getTime()
              : undefined,
            transactionFee: undefined, // V2 API does not separate fee from amount
          });
        }
      } catch {
        // Skip accounts that fail
      }
    }

    return withdrawals.slice(0, maxResults);
  }

  /**
   * Map Coinbase v2 transaction status to numeric status code
   * 0 = pending, 1 = completed, 2 = failed/canceled
   */
  private mapV2TransactionStatus(status: string): number {
    switch (status.toLowerCase()) {
      case "completed":
        return 1;
      case "pending":
      case "waiting_for_signature":
      case "waiting_for_clearing":
        return 0;
      case "failed":
      case "expired":
      case "canceled":
        return 2;
      default:
        return 0;
    }
  }

  // -------------------------------------------------------------------------
  // Withdrawals (ExchangeExtended)
  // -------------------------------------------------------------------------

  async withdraw(
    coin: string,
    network: string,
    address: string,
    amount: number,
    _tag?: string,
  ): Promise<WithdrawalResult> {
    const coinUpper = coin.toUpperCase();

    // Find the v2 account for this currency
    const account = await this.client.getV2AccountByCurrency(coinUpper);
    if (!account) {
      throw new Error(
        `No Coinbase account found for ${coinUpper}. Ensure you have a ${coinUpper} wallet.`
      );
    }

    if (!account.allow_withdrawals) {
      throw new Error(`Withdrawals are not allowed for ${coinUpper} on this account.`);
    }

    const idem = uuidv4();
    const tx = await this.client.sendCrypto(
      account.id,
      address,
      amount.toString(),
      coinUpper,
      idem
    );

    return {
      id: tx.id,
      coin: coinUpper,
      amount,
      network: network || "default",
      address,
      fee: 0, // Coinbase v2 does not return fee separately
      status: tx.status || "pending",
    };
  }

  async getWithdrawalInfo(coin: string, _network?: string): Promise<WithdrawalInfo> {
    const coinUpper = coin.toUpperCase();

    const currencies = await this.client.getCryptoCurrencies();
    const currency = currencies.find(
      (c) => c.code.toUpperCase() === coinUpper
    );

    if (!currency) {
      throw new Error(`Currency ${coinUpper} not found on Coinbase.`);
    }

    return {
      coin: coinUpper,
      networks: [
        {
          network: coinUpper,
          name: currency.name,
          withdrawEnabled: true,
          withdrawFee: 0, // Coinbase dynamic fees, not exposed via v2 API
          withdrawMin: 0,
          withdrawMax: 0,
          estimatedArrivalMins: 30,
        },
      ],
    };
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
