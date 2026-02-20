/**
 * Uniswap Exchange Adapter
 * Wraps UniswapClient to implement the abstract Exchange interface.
 *
 * Implements the full swap flow per the Uniswap integration guide:
 *   1. Quote → 2. Check Approval → 3. Swap (with optional Permit2)
 *
 * Uniswap is a DEX — some CEX-specific methods (deposit/withdrawal history,
 * order book, open orders) are not applicable and return empty/default values.
 *
 * Requires:
 * - UNISWAP_API_KEY: API key from developers.uniswap.org
 * - Wallet address for signing transactions
 *
 * Optional:
 * - THEGRAPH_API_KEY: Enables market data (candles, tickers, swap history)
 *   via the Uniswap V3 Subgraph. Without it, data methods return stubs.
 */

import { UniswapClient } from "../../uniswap/index.ts";
import { UniswapSubgraph } from "../../uniswap/subgraph.ts";
import { SUPPORTED_CHAIN_IDS, CHAIN_NAMES, isUniswapXRouting } from "../../uniswap/types.ts";
import type {
  Exchange,
  ExchangeId,
  ExchangeInfo,
  Ticker24hr,
  OrderBook,
  OrderBookEntry,
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
 * UniswapAdapter - Adapts UniswapClient to the Exchange interface
 *
 * IMPORTANT: Uniswap is a non-custodial DEX. Some centralized exchange
 * methods return empty/default values.
 */
export class UniswapAdapter implements Exchange {
  private client: UniswapClient;
  /** Subgraph client for on-chain market data (null if no THEGRAPH_API_KEY) */
  readonly subgraph: UniswapSubgraph | null;

  readonly exchangeId: ExchangeId = "uniswap";
  readonly displayName = "Uniswap";

  // Track orders locally since Uniswap is stateless
  private localOrders: Map<string, Order> = new Map();
  private localTrades: Map<string, Trade[]> = new Map();
  private orderCounter = 0;

  constructor(apiKey: string, walletAddress: string, chainId = 1, graphApiKey?: string) {
    this.client = new UniswapClient(apiKey, walletAddress, chainId);
    this.subgraph = graphApiKey
      ? new UniswapSubgraph(graphApiKey, chainId, this.client)
      : null;
  }

  // -------------------------------------------------------------------------
  // Connection
  // -------------------------------------------------------------------------

  async testConnection(): Promise<boolean> {
    return this.client.testConnection();
  }

  async getExchangeInfo(): Promise<ExchangeInfo> {
    const symbols: SymbolInfo[] = SUPPORTED_CHAIN_IDS.map((cid) => ({
      symbol: `${CHAIN_NAMES[cid] || `Chain${cid}`}`,
      status: "TRADING",
      baseAsset: "ETH",
      quoteAsset: "USDC",
      baseAssetPrecision: 18,
      quoteAssetPrecision: 6,
      orderTypes: ["MARKET"] as OrderType[],
      isSpotTradingAllowed: true,
      filters: [],
    }));

    return {
      timezone: "UTC",
      serverTime: Date.now(),
      symbols,
    };
  }

  // -------------------------------------------------------------------------
  // Market Data
  // -------------------------------------------------------------------------

  async getPrice(symbol: string): Promise<number> {
    const { tokenIn, tokenOut, tokenInDecimals, tokenOutDecimals } = await this.client.resolveSymbol(symbol);
    const oneUnit = "1" + "0".repeat(tokenInDecimals);
    const quote = await this.client.getQuote(tokenIn, tokenOut, oneUnit);

    const outputAmount = quote.quote.output?.amount || quote.quote.amountOut;
    if (!outputAmount) throw new Error("No output amount in quote");

    return Number(outputAmount) / 10 ** tokenOutDecimals;
  }

  async getCandles(symbol: string, interval: string, limit?: number): Promise<Candle[]> {
    if (!this.subgraph?.isAvailable()) return [];
    try {
      return await this.subgraph.getCandles(symbol, interval, limit ?? 50);
    } catch {
      return [];
    }
  }

  async get24hrTickers(): Promise<Ticker24hr[]> {
    if (!this.subgraph?.isAvailable()) return [];
    try {
      return await this.subgraph.get24hrTickers();
    } catch {
      return [];
    }
  }

  async getTopSymbols(n: number): Promise<string[]> {
    if (!this.subgraph?.isAvailable()) {
      return ["ETHUSDC", "WBTCUSDC", "ARBUSDC", "LINKUSDC", "UNIUSDC"];
    }
    try {
      return await this.subgraph.getTopSymbols(n);
    } catch {
      return ["ETHUSDC", "WBTCUSDC", "ARBUSDC", "LINKUSDC", "UNIUSDC"];
    }
  }

  async getOrderBook(symbol: string, _limit?: number): Promise<OrderBook> {
    if (this.subgraph?.isAvailable()) {
      try { return await this.subgraph.getOrderBook(symbol); } catch { /* fall through */ }
    }
    const price = await this.getPrice(symbol);
    const spread = price * 0.003;
    return {
      lastUpdateId: Date.now(),
      bids: [{ price: price - spread / 2, quantity: 0 } as OrderBookEntry],
      asks: [{ price: price + spread / 2, quantity: 0 } as OrderBookEntry],
    };
  }

  async getBookTicker(symbol: string): Promise<BookTicker> {
    if (this.subgraph?.isAvailable()) {
      try { return await this.subgraph.getBookTicker(symbol); } catch { /* fall through */ }
    }
    const price = await this.getPrice(symbol);
    const spread = price * 0.003;
    return {
      symbol,
      bidPrice: price - spread / 2,
      bidQty: 0,
      askPrice: price + spread / 2,
      askQty: 0,
    };
  }

  async getSpread(symbol: string): Promise<SpreadInfo> {
    if (this.subgraph?.isAvailable()) {
      try { return await this.subgraph.getSpread(symbol); } catch { /* fall through */ }
    }
    const price = await this.getPrice(symbol);
    const spread = price * 0.003;
    return {
      spread,
      spreadPercent: 0.3,
      bidPrice: price - spread / 2,
      askPrice: price + spread / 2,
    };
  }

  async getAvgPrice(symbol: string): Promise<AvgPrice> {
    if (this.subgraph?.isAvailable()) {
      try { return await this.subgraph.getAvgPrice(symbol); } catch { /* fall through */ }
    }
    const price = await this.getPrice(symbol);
    return { mins: 5, price };
  }

  // -------------------------------------------------------------------------
  // Account
  // -------------------------------------------------------------------------

  async getAccountInfo(): Promise<AccountInfo> {
    return {
      canTrade: true,
      canWithdraw: true,
      canDeposit: true,
      accountType: "DEX",
      balances: [],
      updateTime: Date.now(),
    };
  }

  async getBalance(_asset: string): Promise<number> {
    // Would need an RPC call to check on-chain balance
    return 0;
  }

  async getAllBalances(): Promise<Balance[]> {
    return [];
  }

  async getFullAccountDetails(): Promise<AccountDetails> {
    return {
      accountInfo: await this.getAccountInfo(),
      totalUsdtValue: 0,
      nonZeroBalances: [],
    };
  }

  // -------------------------------------------------------------------------
  // Trading
  // -------------------------------------------------------------------------

  async placeOrder(params: OrderParams): Promise<Order> {
    const { tokenIn, tokenOut, tokenInDecimals, tokenOutDecimals } =
      await this.client.resolveSymbol(params.symbol);

    const isBuy = params.side === "BUY";
    const amount = params.quantity || params.quoteOrderQty || 0;

    // Use actual token decimals — BUY sends quote (e.g. USDC), SELL sends base (e.g. UNI)
    const inputDecimals = isBuy ? tokenOutDecimals : tokenInDecimals;
    const rawAmount = Math.floor(amount * 10 ** inputDecimals).toString();

    // Determine the actual input token for this swap
    const swapTokenIn = isBuy ? tokenOut : tokenIn;
    const swapTokenOut = isBuy ? tokenIn : tokenOut;

    // Step 1: Get quote (auto-slippage by default)
    let quote = await this.client.getQuote(swapTokenIn, swapTokenOut, rawAmount);
    let quoteTimestamp = Date.now();

    // Step 2: Check approval for ERC-20 input tokens
    const approvalResult = await this.client.checkApproval(swapTokenIn, rawAmount);

    // Step 3: Refresh quote if stale (>30s elapsed during approval check)
    if (!UniswapClient.isQuoteFresh(quoteTimestamp)) {
      quote = await this.client.getQuote(swapTokenIn, swapTokenOut, rawAmount);
      quoteTimestamp = Date.now();
    }

    // Step 4: Build unsigned swap transaction (with 2-min deadline)
    const deadline = Math.floor(Date.now() / 1000) + 120;
    const swapTx = await this.client.getSwapTransaction(quote, undefined, deadline);

    // Validate transaction data per docs — do this before creating the order
    if (!UniswapClient.validateSwapTransaction(swapTx.swap.data)) {
      throw new Error("Invalid swap transaction data — cannot execute");
    }

    const orderId = `uniswap-${++this.orderCounter}-${Date.now()}`;

    const order: Order = {
      orderId,
      clientOrderId: quote.requestId,
      symbol: params.symbol,
      side: params.side,
      type: "MARKET",
      status: "NEW" as OrderStatus,
      price: await this.getPrice(params.symbol),
      quantity: amount,
      executedQty: 0,
      cummulativeQuoteQty: 0,
      time: Date.now(),
      updateTime: Date.now(),
    };

    this.localOrders.set(orderId, order);

    // Attach unsigned transactions for the caller to sign & broadcast
    const meta: Record<string, unknown> = {
      _unsignedTx: swapTx.swap,
      _quoteTimestamp: quoteTimestamp,
      _routing: quote.routing, // CLASSIC, DUTCH_V2, PRIORITY, etc.
    };

    if (approvalResult.approval) {
      meta._approvalTx = approvalResult.approval;
    }

    // UniswapX orders require Permit2 signing — pass through permitData
    if (isUniswapXRouting(quote.routing) && quote.permitData) {
      meta._permitData = quote.permitData;
      meta._isUniswapX = true;
    }

    if (swapTx.txFailureReasons?.length) {
      meta._txFailureReasons = swapTx.txFailureReasons;
    }

    Object.assign(order, meta);

    return order;
  }

  async cancelOrder(_symbol: string, orderId: string): Promise<void> {
    const order = this.localOrders.get(orderId);
    if (order && order.status === "NEW") {
      order.status = "CANCELED";
      order.updateTime = Date.now();
    }
  }

  async cancelAllOrders(symbol: string): Promise<Order[]> {
    const cancelled: Order[] = [];
    for (const order of this.localOrders.values()) {
      if (order.symbol === symbol && order.status === "NEW") {
        order.status = "CANCELED";
        order.updateTime = Date.now();
        cancelled.push(order);
      }
    }
    return cancelled;
  }

  async getOpenOrders(symbol?: string): Promise<Order[]> {
    const orders = Array.from(this.localOrders.values());
    return orders.filter(
      (o) => o.status === "NEW" && (!symbol || o.symbol === symbol),
    );
  }

  async getOrderStatus(_symbol: string, orderId: number | string): Promise<Order> {
    const order = this.localOrders.get(String(orderId));
    if (!order) throw new Error(`Order ${orderId} not found`);
    return order;
  }

  async testOrder(params: OrderParams): Promise<boolean> {
    try {
      const { tokenIn, tokenOut, tokenInDecimals } = await this.client.resolveSymbol(params.symbol);
      const amount = params.quantity || params.quoteOrderQty || 0;
      const rawAmount = Math.floor(amount * 10 ** tokenInDecimals).toString();
      await this.client.getQuote(tokenIn, tokenOut, rawAmount);
      return true;
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // History
  // -------------------------------------------------------------------------

  async getTradeHistory(symbol: string, limit?: number): Promise<Trade[]> {
    const local = this.localTrades.get(symbol) || [];
    if (!this.subgraph?.isAvailable()) return local;
    try {
      const onChain = await this.subgraph.getTradeHistory(symbol, limit ?? 50);
      const localIds = new Set(local.map((t) => t.id));
      const deduped = onChain.filter((t) => !localIds.has(t.id));
      return [...local, ...deduped].slice(0, limit ?? 50);
    } catch {
      return local;
    }
  }

  async getOrderHistory(symbol: string, _limit?: number): Promise<Order[]> {
    return Array.from(this.localOrders.values()).filter(
      (o) => o.symbol === symbol,
    );
  }

  async getDepositHistory(_limit?: number): Promise<Deposit[]> {
    return [];
  }

  async getWithdrawalHistory(_limit?: number): Promise<Withdrawal[]> {
    return [];
  }

  // -------------------------------------------------------------------------
  // Rate Limiting
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
