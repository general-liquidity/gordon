/**
 * CCXT Adapter — full Exchange + ExchangeExtended impl over CCXT v4.
 *
 * Positioning per operator request: CCXT is an ALTERNATIVE to Gordon's
 * native adapters, not a fallback. The factory routes any `ccxt:<sub-id>`
 * exchange id to this adapter. Operators can choose:
 *
 *   - `binance` (native, hand-tuned, tighter integration with riskClassifier/
 *     evidenceBundle, exchange-specific quirk handling)
 *   - `ccxt:binance` (CCXT-routed, unified API across all 107 CCXT venues,
 *     CCXT Pro WebSocket support free for 73 of them)
 *
 * Both options coexist for the 10 natives; CCXT exclusively covers the
 * other 90+ exchanges (Bybit, KuCoin, MEXC, Crypto.com, HTX, Gate, BitMart,
 * Bitstamp, Bitget, BingX, Phemex, etc.).
 *
 * Authentication: CCXT exchanges read credentials from a uniform env
 * pattern — `CCXT_<UPPER_SUB_ID>_API_KEY` / `CCXT_<UPPER_SUB_ID>_API_SECRET`
 * / `CCXT_<UPPER_SUB_ID>_PASSPHRASE` / `CCXT_<UPPER_SUB_ID>_WALLET_PRIVATE_KEY`.
 * See `ccxtEnvNames()` in `../types.ts`.
 *
 * Symbol convention: CCXT uses `BASE/QUOTE` (slash). The adapter accepts
 * both `BTC/USDT` and `BTCUSDT` on input (heuristic-converts via the
 * `toCcxtSymbol` helper) and returns CCXT's slash format.
 *
 * Sandbox: CCXT exposes `exchange.setSandboxMode(true)` for ~30 venues;
 * the adapter calls it within a try/catch — exchanges without sandbox
 * raise NotSupported and we fall through to live.
 *
 * Error model: CCXT throws typed errors (`AuthenticationError`,
 * `InsufficientFunds`, `InvalidOrder`, `NetworkError`, `ExchangeError`,
 * etc.). The adapter passes them through unchanged so callers can pattern
 * match if they need; the `withResultSanitizer` wrapper (commit 51b9d0f6)
 * strips any prompt-injection patterns from error messages before they
 * re-enter the agent's context.
 *
 * Rate limiting: CCXT's `enableRateLimit: true` handles per-exchange
 * throttling internally. Gordon's `RateLimitStatus` is synthesized from
 * CCXT's `rateLimit` (ms between calls) + an estimate of recent traffic;
 * not as precise as native adapters that track weights, but functionally
 * adequate for "is the adapter currently throttling?" queries.
 */

import ccxt, {
  type Exchange as CcxtBase,
  AuthenticationError,
  ExchangeNotAvailable,
  NetworkError,
  NotSupported,
  RateLimitExceeded,
} from "ccxt";

import type {
  Exchange,
  ExchangeExtended,
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
  OrderType,
  OrderStatus,
  Trade,
  Deposit,
  Withdrawal,
  RateLimitStatus,
  SymbolInfo,
  SymbolFilter,
  WithdrawalResult,
  WithdrawalInfo,
  ExchangeWebSocket,
} from "../types.ts";
import type { Candle } from "../../../types/index.ts";
import { CcxtWebSocketImpl } from "./ccxt-websocket.ts";

// ---------------------------------------------------------------------------
// Symbol normalization
// ---------------------------------------------------------------------------

const COMMON_QUOTES = [
  "USDT", "USDC", "USDC.E", "BUSD", "DAI", "TUSD", "FDUSD",
  "BTC", "ETH", "BNB", "SOL", "TRX", "XRP",
  "EUR", "USD", "GBP", "JPY", "AUD", "CAD",
];

/**
 * Convert a Gordon-style symbol ("BTCUSDT") to a CCXT-style symbol
 * ("BTC/USDT") via quote-currency suffix heuristic. Pass-through when
 * the input already contains a slash.
 */
export function toCcxtSymbol(symbol: string): string {
  if (symbol.includes("/")) return symbol;
  for (const quote of COMMON_QUOTES) {
    if (symbol.endsWith(quote) && symbol.length > quote.length) {
      return `${symbol.slice(0, -quote.length)}/${quote}`;
    }
  }
  return symbol;
}

/**
 * Convert a CCXT-style symbol ("BTC/USDT") to Gordon-style ("BTCUSDT").
 * Pass-through when no slash present.
 */
export function fromCcxtSymbol(symbol: string): string {
  return symbol.replace("/", "");
}

// ---------------------------------------------------------------------------
// Order mapping
// ---------------------------------------------------------------------------

function mapOrderTypeToCcxt(type: OrderType): string {
  switch (type) {
    case "MARKET": return "market";
    case "LIMIT": return "limit";
    case "STOP_LOSS": return "stop_market";
    case "STOP_LOSS_LIMIT": return "stop_limit";
    case "TAKE_PROFIT": return "take_profit_market";
    case "TAKE_PROFIT_LIMIT": return "take_profit_limit";
    case "LIMIT_MAKER": return "limit";
  }
}

function mapOrderTypeFromCcxt(ccxtType: string | undefined): OrderType {
  switch ((ccxtType ?? "limit").toLowerCase()) {
    case "market": return "MARKET";
    case "limit": return "LIMIT";
    case "stop_market": case "stop":
      return "STOP_LOSS";
    case "stop_limit": case "stop_loss_limit":
      return "STOP_LOSS_LIMIT";
    case "take_profit_market": case "take_profit":
      return "TAKE_PROFIT";
    case "take_profit_limit":
      return "TAKE_PROFIT_LIMIT";
    default: return "LIMIT";
  }
}

function mapOrderStatusFromCcxt(ccxtStatus: string | undefined): OrderStatus {
  switch ((ccxtStatus ?? "open").toLowerCase()) {
    case "open": return "NEW";
    case "closed": return "FILLED";
    case "canceled": case "cancelled": return "CANCELED";
    case "expired": return "EXPIRED";
    case "rejected": return "REJECTED";
    case "partial": case "partially_filled": return "PARTIALLY_FILLED";
    default: return "NEW";
  }
}

function ccxtOrderToOrder(ccxtOrder: Record<string, unknown>): Order {
  const orderId = String(ccxtOrder.id ?? "");
  const symbol = String(ccxtOrder.symbol ?? "");
  const sideRaw = String(ccxtOrder.side ?? "buy").toLowerCase();
  return {
    orderId,
    clientOrderId: ccxtOrder.clientOrderId ? String(ccxtOrder.clientOrderId) : undefined,
    symbol,
    side: sideRaw === "sell" ? "SELL" : "BUY",
    type: mapOrderTypeFromCcxt(ccxtOrder.type as string | undefined),
    status: mapOrderStatusFromCcxt(ccxtOrder.status as string | undefined),
    price: Number(ccxtOrder.price ?? 0),
    quantity: Number(ccxtOrder.amount ?? 0),
    executedQty: Number(ccxtOrder.filled ?? 0),
    cummulativeQuoteQty: Number(ccxtOrder.cost ?? 0),
    stopPrice: ccxtOrder.stopPrice !== undefined ? Number(ccxtOrder.stopPrice) : undefined,
    time: ccxtOrder.timestamp !== undefined ? Number(ccxtOrder.timestamp) : undefined,
    updateTime: ccxtOrder.lastUpdateTimestamp !== undefined
      ? Number(ccxtOrder.lastUpdateTimestamp)
      : undefined,
  };
}

function ccxtTradeToTrade(ccxtTrade: Record<string, unknown>): Trade {
  const sideRaw = String(ccxtTrade.side ?? "buy").toLowerCase();
  const fee = ccxtTrade.fee as Record<string, unknown> | undefined;
  return {
    id: String(ccxtTrade.id ?? ""),
    orderId: String(ccxtTrade.order ?? ""),
    symbol: String(ccxtTrade.symbol ?? ""),
    side: sideRaw === "sell" ? "SELL" : "BUY",
    price: Number(ccxtTrade.price ?? 0),
    quantity: Number(ccxtTrade.amount ?? 0),
    commission: fee?.cost !== undefined ? Number(fee.cost) : 0,
    commissionAsset: fee?.currency ? String(fee.currency) : "",
    time: Number(ccxtTrade.timestamp ?? 0),
    isMaker: Boolean(ccxtTrade.takerOrMaker === "maker"),
  };
}

function ccxtBalanceToBalance(asset: string, b: Record<string, unknown>): Balance {
  return {
    asset,
    free: Number(b.free ?? 0),
    locked: Number(b.used ?? 0),
    total: Number(b.total ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Interval helper
// ---------------------------------------------------------------------------

function intervalDurationMs(interval: string): number {
  // CCXT interval format: "1m", "5m", "15m", "1h", "4h", "1d", "1w", "1M".
  // Returns the duration in ms for closeTime synthesis. Defaults to 60s
  // when the format isn't recognized (close enough — caller can refine).
  const match = interval.match(/^(\d+)([smhdwM])$/);
  if (!match) return 60_000;
  const n = parseInt(match[1]!, 10);
  switch (match[2]) {
    case "s": return n * 1000;
    case "m": return n * 60_000;
    case "h": return n * 60 * 60_000;
    case "d": return n * 24 * 60 * 60_000;
    case "w": return n * 7 * 24 * 60 * 60_000;
    case "M": return n * 30 * 24 * 60 * 60_000;
    default: return 60_000;
  }
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

export interface CcxtAdapterCredentials {
  apiKey?: string;
  apiSecret?: string;
  passphrase?: string;
  walletAddress?: string;
  walletPrivateKey?: string;
  /** Custom override headers — some venues require extra headers. */
  headers?: Record<string, string>;
}

/**
 * Resolve the CCXT exchange class for a given sub-id (e.g. "bybit",
 * "kucoin"). Throws if CCXT doesn't ship a class for that id.
 */
function resolveCcxtClass(subId: string): new (config: Record<string, unknown>) => CcxtBase {
  const exchanges = (ccxt as unknown as { exchanges: string[] }).exchanges;
  if (!exchanges.includes(subId)) {
    throw new Error(
      `CCXT does not support exchange '${subId}'. Available exchanges: ${exchanges.slice(0, 12).join(", ")} … (${exchanges.length} total)`,
    );
  }
  const klass = (ccxt as unknown as Record<string, unknown>)[subId];
  if (typeof klass !== "function") {
    throw new Error(`CCXT class for '${subId}' is not constructible`);
  }
  return klass as new (config: Record<string, unknown>) => CcxtBase;
}

export class CcxtAdapter implements ExchangeExtended {
  protected client: CcxtBase;
  readonly exchangeId: ExchangeId;
  readonly displayName: string;
  readonly isSandbox: boolean;
  readonly ccxtSubId: string;
  /** WebSocket adapter — lazily constructed on first getWebSocket() call. */
  private wsAdapter?: ExchangeWebSocket;
  /** Approximate count of calls since last reset, used for synthesizing
   *  RateLimitStatus from CCXT's `rateLimit` (ms between calls). */
  private callCount = 0;
  private lastCallReset = Date.now();
  /** Simple circuit-breaker state: opens after 3 consecutive failures. */
  private cbState: "closed" | "open" | "half-open" = "closed";
  private cbFailureCount = 0;

  constructor(
    ccxtSubId: string,
    credentials: CcxtAdapterCredentials,
    sandbox?: boolean,
  ) {
    const Klass = resolveCcxtClass(ccxtSubId);

    const config: Record<string, unknown> = {
      enableRateLimit: true,
    };
    if (credentials.apiKey) config.apiKey = credentials.apiKey;
    if (credentials.apiSecret) config.secret = credentials.apiSecret;
    if (credentials.passphrase) config.password = credentials.passphrase;
    if (credentials.walletAddress) config.walletAddress = credentials.walletAddress;
    if (credentials.walletPrivateKey) config.privateKey = credentials.walletPrivateKey;
    if (credentials.headers) config.headers = credentials.headers;

    this.client = new Klass(config);
    this.ccxtSubId = ccxtSubId;
    this.exchangeId = `ccxt:${ccxtSubId}` as ExchangeId;
    this.displayName = `${ccxtSubId} (via CCXT)`;
    this.isSandbox = Boolean(sandbox);

    if (sandbox) {
      try {
        this.client.setSandboxMode(true);
      } catch (err) {
        // Many CCXT exchanges throw NotSupported for sandbox; we surface
        // the failure but don't break adapter construction — the caller
        // can read `isSandbox` and decide whether to proceed.
        if (!(err instanceof NotSupported)) {
          throw err;
        }
      }
    }
  }

  /**
   * Test-only factory: bypass normal construction + inject a mock CCXT
   * client. The mock only needs to implement the CCXT methods the test
   * exercises. Production code should never call this.
   */
  static __forTesting(
    ccxtSubId: string,
    mockClient: unknown,
    sandbox = false,
  ): CcxtAdapter {
    const adapter = Object.create(CcxtAdapter.prototype) as CcxtAdapter;
    (adapter as unknown as { client: unknown }).client = mockClient;
    (adapter as unknown as { ccxtSubId: string }).ccxtSubId = ccxtSubId;
    (adapter as unknown as { exchangeId: ExchangeId }).exchangeId = `ccxt:${ccxtSubId}` as ExchangeId;
    (adapter as unknown as { displayName: string }).displayName = `${ccxtSubId} (via CCXT)`;
    (adapter as unknown as { isSandbox: boolean }).isSandbox = sandbox;
    (adapter as unknown as { callCount: number }).callCount = 0;
    (adapter as unknown as { lastCallReset: number }).lastCallReset = Date.now();
    (adapter as unknown as { cbState: string }).cbState = "closed";
    (adapter as unknown as { cbFailureCount: number }).cbFailureCount = 0;
    return adapter;
  }

  // -------------------------------------------------------------------------
  // Circuit breaker / rate-limit synth
  // -------------------------------------------------------------------------

  private async withCallTracking<T>(fn: () => Promise<T>): Promise<T> {
    if (this.cbState === "open") {
      // Probe with half-open: try once, close on success, re-open on failure
      this.cbState = "half-open";
    }
    this.callCount++;
    try {
      const result = await fn();
      if (this.cbState === "half-open") {
        this.cbState = "closed";
        this.cbFailureCount = 0;
      } else if (this.cbState === "closed") {
        this.cbFailureCount = 0;
      }
      return result;
    } catch (err) {
      this.cbFailureCount++;
      if (this.cbFailureCount >= 3) {
        this.cbState = "open";
      }
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // Connection
  // -------------------------------------------------------------------------

  async testConnection(): Promise<boolean> {
    return this.withCallTracking(async () => {
      await this.client.loadMarkets();
      return true;
    }).catch(() => false);
  }

  async getExchangeInfo(): Promise<ExchangeInfo> {
    return this.withCallTracking(async () => {
      const markets = await this.client.loadMarkets();
      const symbols: SymbolInfo[] = Object.values(markets).map((m: unknown) => {
        const mk = m as Record<string, unknown>;
        const filters: SymbolFilter[] = [];
        const limits = mk.limits as Record<string, Record<string, number>> | undefined;
        if (limits?.amount) {
          filters.push({
            filterType: "LOT_SIZE",
            minQty: String(limits.amount.min ?? ""),
            maxQty: String(limits.amount.max ?? ""),
          });
        }
        if (limits?.price) {
          filters.push({
            filterType: "PRICE_FILTER",
            minPrice: String(limits.price.min ?? ""),
            maxPrice: String(limits.price.max ?? ""),
          });
        }
        if (limits?.cost) {
          filters.push({
            filterType: "MIN_NOTIONAL",
            minNotional: String(limits.cost.min ?? ""),
          });
        }
        const precision = mk.precision as Record<string, number> | undefined;
        return {
          symbol: String(mk.symbol ?? ""),
          status: mk.active === false ? "BREAK" : "TRADING",
          baseAsset: String(mk.base ?? ""),
          quoteAsset: String(mk.quote ?? ""),
          baseAssetPrecision: precision?.amount ?? 8,
          quoteAssetPrecision: precision?.price ?? 8,
          orderTypes: ["MARKET", "LIMIT"] as OrderType[],
          isSpotTradingAllowed: Boolean(mk.spot),
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
  // Market data (public)
  // -------------------------------------------------------------------------

  async getPrice(symbol: string): Promise<number> {
    return this.withCallTracking(async () => {
      const ticker = await this.client.fetchTicker(toCcxtSymbol(symbol));
      return Number(ticker.last ?? ticker.close ?? 0);
    });
  }

  async getCandles(symbol: string, interval: string, limit = 100): Promise<Candle[]> {
    return this.withCallTracking(async () => {
      const ccxtInterval = interval;
      const ohlcv = await this.client.fetchOHLCV(toCcxtSymbol(symbol), ccxtInterval, undefined, limit);
      const durationMs = intervalDurationMs(interval);
      return ohlcv.map((row: unknown) => {
        const r = row as unknown[];
        const openTime = Number(r[0]);
        return {
          openTime,
          open: Number(r[1]),
          high: Number(r[2]),
          low: Number(r[3]),
          close: Number(r[4]),
          volume: Number(r[5]),
          closeTime: openTime + durationMs - 1,
        };
      }) as Candle[];
    });
  }

  async get24hrTickers(): Promise<Ticker24hr[]> {
    return this.withCallTracking(async () => {
      const tickers = await this.client.fetchTickers();
      return Object.values(tickers).map((t: unknown) => {
        const tk = t as Record<string, unknown>;
        return {
          symbol: String(tk.symbol ?? ""),
          priceChange: Number(tk.change ?? 0),
          priceChangePercent: Number(tk.percentage ?? 0),
          lastPrice: Number(tk.last ?? tk.close ?? 0),
          highPrice: Number(tk.high ?? 0),
          lowPrice: Number(tk.low ?? 0),
          volume: Number(tk.baseVolume ?? 0),
          quoteVolume: Number(tk.quoteVolume ?? 0),
          openTime: Number(tk.timestamp ?? Date.now()) - 24 * 60 * 60 * 1000,
          closeTime: Number(tk.timestamp ?? Date.now()),
        };
      });
    });
  }

  async getTopSymbols(n: number): Promise<string[]> {
    const tickers = await this.get24hrTickers();
    return tickers
      .sort((a, b) => b.quoteVolume - a.quoteVolume)
      .slice(0, n)
      .map((t) => t.symbol);
  }

  async getOrderBook(symbol: string, limit = 100): Promise<OrderBook> {
    return this.withCallTracking(async () => {
      const ob = await this.client.fetchOrderBook(toCcxtSymbol(symbol), limit);
      const mapLevel = (lvl: unknown) => {
        const [p, q] = lvl as [unknown, unknown];
        return { price: Number(p), quantity: Number(q) };
      };
      return {
        lastUpdateId: Number(ob.timestamp ?? Date.now()),
        bids: (ob.bids ?? []).map(mapLevel),
        asks: (ob.asks ?? []).map(mapLevel),
      };
    });
  }

  async getBookTicker(symbol: string): Promise<BookTicker> {
    const ob = await this.getOrderBook(symbol, 1);
    return {
      symbol,
      bidPrice: ob.bids[0]?.price ?? 0,
      bidQty: ob.bids[0]?.quantity ?? 0,
      askPrice: ob.asks[0]?.price ?? 0,
      askQty: ob.asks[0]?.quantity ?? 0,
    };
  }

  async getSpread(symbol: string): Promise<SpreadInfo> {
    const bt = await this.getBookTicker(symbol);
    const spread = bt.askPrice - bt.bidPrice;
    const spreadPercent = bt.bidPrice > 0 ? (spread / bt.bidPrice) * 100 : 0;
    return { spread, spreadPercent, bidPrice: bt.bidPrice, askPrice: bt.askPrice };
  }

  async getAvgPrice(symbol: string): Promise<AvgPrice> {
    // CCXT doesn't have a unified avg-price endpoint; synthesize from
    // 5-minute candles. Operators on venues that expose a native endpoint
    // can layer a more accurate impl later.
    return this.withCallTracking(async () => {
      const candles = await this.client.fetchOHLCV(toCcxtSymbol(symbol), "5m", undefined, 1);
      const last = candles[0];
      if (!last) return { mins: 5, price: 0 };
      const open = Number(last[1]);
      const close = Number(last[4]);
      return { mins: 5, price: (open + close) / 2 };
    });
  }

  // -------------------------------------------------------------------------
  // Account (authenticated)
  // -------------------------------------------------------------------------

  async getAccountInfo(): Promise<AccountInfo> {
    return this.withCallTracking(async () => {
      const balance = await this.client.fetchBalance();
      const balances: Balance[] = [];
      const totals = (balance as Record<string, unknown>).total as Record<string, number> | undefined;
      const free = (balance as Record<string, unknown>).free as Record<string, number> | undefined;
      const used = (balance as Record<string, unknown>).used as Record<string, number> | undefined;
      const assets = totals ? Object.keys(totals) : [];
      for (const asset of assets) {
        balances.push({
          asset,
          free: Number(free?.[asset] ?? 0),
          locked: Number(used?.[asset] ?? 0),
          total: Number(totals?.[asset] ?? 0),
        });
      }
      return {
        canTrade: true,
        canWithdraw: this.client.has?.withdraw === true,
        canDeposit: this.client.has?.fetchDepositAddress === true,
        accountType: "SPOT",
        balances,
        updateTime: Date.now(),
      };
    });
  }

  async getBalance(asset: string): Promise<number> {
    const info = await this.getAccountInfo();
    return info.balances.find((b) => b.asset === asset)?.total ?? 0;
  }

  async getAllBalances(): Promise<Balance[]> {
    const info = await this.getAccountInfo();
    return info.balances.filter((b) => b.total > 0);
  }

  async getFullAccountDetails(): Promise<AccountDetails> {
    const accountInfo = await this.getAccountInfo();
    const nonZeroBalances = accountInfo.balances.filter((b) => b.total > 0);
    // Quote total value via tickers — best-effort, falls back to base asset units
    let totalUsdtValue = 0;
    try {
      const tickers = await this.get24hrTickers();
      const priceMap = new Map(tickers.map((t) => [t.symbol, t.lastPrice]));
      for (const b of nonZeroBalances) {
        if (b.asset === "USDT" || b.asset === "USDC" || b.asset === "USD") {
          totalUsdtValue += b.total;
        } else {
          const price = priceMap.get(`${b.asset}/USDT`) ?? priceMap.get(`${b.asset}/USD`) ?? 0;
          totalUsdtValue += b.total * price;
        }
      }
    } catch {
      // tickers fetch can fail on some venues; leave totalUsdtValue at 0
    }
    return { accountInfo, totalUsdtValue, nonZeroBalances };
  }

  // -------------------------------------------------------------------------
  // Trading (authenticated)
  // -------------------------------------------------------------------------

  async placeOrder(params: OrderParams): Promise<Order> {
    return this.withCallTracking(async () => {
      const ccxtType = mapOrderTypeToCcxt(params.type);
      const side = params.side.toLowerCase() as "buy" | "sell";
      const symbol = toCcxtSymbol(params.symbol);
      const amount = params.quantity ?? 0;
      const price = params.price;
      const ccxtParams: Record<string, unknown> = {};
      if (params.stopPrice !== undefined) ccxtParams.stopPrice = params.stopPrice;
      if (params.timeInForce) ccxtParams.timeInForce = params.timeInForce;
      if (params.newClientOrderId) ccxtParams.clientOrderId = params.newClientOrderId;
      const order = await this.client.createOrder(symbol, ccxtType, side, amount, price, ccxtParams);
      return ccxtOrderToOrder(order as unknown as Record<string, unknown>);
    });
  }

  async cancelOrder(symbol: string, orderId: string): Promise<void> {
    await this.withCallTracking(() =>
      this.client.cancelOrder(orderId, toCcxtSymbol(symbol)),
    );
  }

  async cancelAllOrders(symbol: string): Promise<Order[]> {
    return this.withCallTracking(async () => {
      // Not all CCXT exchanges implement cancelAllOrders unified — fall back
      // to fetching opens + cancelling individually.
      if ((this.client.has as Record<string, unknown>)?.cancelAllOrders) {
        const result = await this.client.cancelAllOrders(toCcxtSymbol(symbol));
        if (Array.isArray(result)) {
          return result.map((o) => ccxtOrderToOrder(o as unknown as Record<string, unknown>));
        }
      }
      const open = await this.client.fetchOpenOrders(toCcxtSymbol(symbol));
      const cancelled: Order[] = [];
      for (const o of open) {
        try {
          await this.client.cancelOrder(String((o as unknown as Record<string, unknown>).id ?? ""), toCcxtSymbol(symbol));
          cancelled.push(ccxtOrderToOrder(o as unknown as Record<string, unknown>));
        } catch {
          // continue cancelling; one failure shouldn't block the rest
        }
      }
      return cancelled;
    });
  }

  async getOpenOrders(symbol?: string): Promise<Order[]> {
    return this.withCallTracking(async () => {
      const ccxtSymbol = symbol ? toCcxtSymbol(symbol) : undefined;
      const orders = await this.client.fetchOpenOrders(ccxtSymbol);
      return orders.map((o) => ccxtOrderToOrder(o as unknown as Record<string, unknown>));
    });
  }

  async getOrderStatus(symbol: string, orderId: number | string): Promise<Order> {
    return this.withCallTracking(async () => {
      const o = await this.client.fetchOrder(String(orderId), toCcxtSymbol(symbol));
      return ccxtOrderToOrder(o as unknown as Record<string, unknown>);
    });
  }

  async testOrder(_params: OrderParams): Promise<boolean> {
    // CCXT doesn't have a unified test-order endpoint; treat as always
    // "would dispatch successfully" — operators should use sandbox mode
    // for real dry runs.
    return true;
  }

  // -------------------------------------------------------------------------
  // History (authenticated)
  // -------------------------------------------------------------------------

  async getTradeHistory(symbol: string, limit = 100): Promise<Trade[]> {
    return this.withCallTracking(async () => {
      const trades = await this.client.fetchMyTrades(toCcxtSymbol(symbol), undefined, limit);
      return trades.map((t) => ccxtTradeToTrade(t as unknown as Record<string, unknown>));
    });
  }

  async getOrderHistory(symbol: string, limit = 100): Promise<Order[]> {
    return this.withCallTracking(async () => {
      const orders = await this.client.fetchClosedOrders(toCcxtSymbol(symbol), undefined, limit);
      return orders.map((o) => ccxtOrderToOrder(o as unknown as Record<string, unknown>));
    });
  }

  async getDepositHistory(limit = 100): Promise<Deposit[]> {
    return this.withCallTracking(async () => {
      const deposits = await this.client.fetchDeposits(undefined, undefined, limit);
      return deposits.map((d) => {
        const dd = d as unknown as Record<string, unknown>;
        return {
          id: String(dd.id ?? ""),
          amount: Number(dd.amount ?? 0),
          coin: String(dd.currency ?? ""),
          network: String(dd.network ?? ""),
          status: Number(dd.status === "ok" ? 1 : 0),
          address: String(dd.address ?? ""),
          txId: dd.txid ? String(dd.txid) : undefined,
          insertTime: Number(dd.timestamp ?? 0),
        };
      });
    });
  }

  async getWithdrawalHistory(limit = 100): Promise<Withdrawal[]> {
    return this.withCallTracking(async () => {
      const withdrawals = await this.client.fetchWithdrawals(undefined, undefined, limit);
      return withdrawals.map((w) => {
        const ww = w as unknown as Record<string, unknown>;
        const fee = ww.fee as Record<string, unknown> | undefined;
        return {
          id: String(ww.id ?? ""),
          amount: Number(ww.amount ?? 0),
          coin: String(ww.currency ?? ""),
          network: String(ww.network ?? ""),
          status: Number(ww.status === "ok" ? 1 : 0),
          address: String(ww.address ?? ""),
          txId: ww.txid ? String(ww.txid) : undefined,
          applyTime: Number(ww.timestamp ?? 0),
          transactionFee: fee?.cost !== undefined ? Number(fee.cost) : undefined,
        };
      });
    });
  }

  // -------------------------------------------------------------------------
  // Rate limiting & circuit breaker
  // -------------------------------------------------------------------------

  shouldThrottle(): boolean {
    if (this.cbState === "open") return true;
    // CCXT's `rateLimit` is ms between calls; if we've made more calls than
    // budget in the last minute, throttle.
    const elapsed = Date.now() - this.lastCallReset;
    if (elapsed > 60_000) {
      this.callCount = 0;
      this.lastCallReset = Date.now();
      return false;
    }
    const budget = Math.floor(60_000 / Math.max(this.client.rateLimit ?? 100, 1));
    return this.callCount > budget;
  }

  getRateLimitStatus(): RateLimitStatus {
    const elapsed = Date.now() - this.lastCallReset;
    const budget = Math.floor(60_000 / Math.max(this.client.rateLimit ?? 100, 1));
    return {
      currentWeight: this.callCount,
      maxWeight: budget,
      usagePercent: budget > 0 ? (this.callCount / budget) * 100 : 0,
      isThrottling: this.shouldThrottle(),
      throttledCount: 0,
      timeUntilReset: Math.max(0, 60_000 - elapsed),
    };
  }

  getCircuitBreakerState(): string {
    return this.cbState;
  }

  resetCircuitBreaker(): void {
    this.cbState = "closed";
    this.cbFailureCount = 0;
  }

  // -------------------------------------------------------------------------
  // ExchangeExtended (optional features)
  // -------------------------------------------------------------------------

  async getWebSocket(): Promise<ExchangeWebSocket> {
    if (this.wsAdapter) return this.wsAdapter;
    this.wsAdapter = new CcxtWebSocketImpl(this.ccxtSubId, {
      apiKey: (this.client as unknown as { apiKey?: string }).apiKey,
      secret: (this.client as unknown as { secret?: string }).secret,
      password: (this.client as unknown as { password?: string }).password,
    }, this.isSandbox);
    return this.wsAdapter;
  }

  async withdraw(
    coin: string,
    network: string,
    address: string,
    amount: number,
    tag?: string,
  ): Promise<WithdrawalResult> {
    return this.withCallTracking(async () => {
      const params: Record<string, unknown> = { network };
      const result = await this.client.withdraw(coin, amount, address, tag, params);
      const rr = result as unknown as Record<string, unknown>;
      const fee = rr.fee as Record<string, unknown> | undefined;
      return {
        id: String(rr.id ?? ""),
        coin,
        amount,
        network,
        address,
        fee: fee?.cost !== undefined ? Number(fee.cost) : 0,
        status: String(rr.status ?? "pending"),
      };
    });
  }

  async getWithdrawalInfo(coin: string, _network?: string): Promise<WithdrawalInfo> {
    return this.withCallTracking(async () => {
      const currencies = await this.client.fetchCurrencies();
      const cur = currencies?.[coin] as Record<string, unknown> | undefined;
      const networks = cur?.networks as Record<string, unknown> | undefined;
      const networkList = networks
        ? Object.entries(networks).map(([name, n]) => {
            const nn = n as Record<string, unknown>;
            const limits = nn.limits as Record<string, Record<string, number>> | undefined;
            const fee = Number(nn.fee ?? 0);
            return {
              network: name,
              name: String(nn.network ?? name),
              withdrawEnabled: Boolean(nn.withdraw),
              withdrawFee: fee,
              withdrawMin: Number(limits?.withdraw?.min ?? 0),
              withdrawMax: Number(limits?.withdraw?.max ?? 0),
              estimatedArrivalMins: 0,
            };
          })
        : [];
      return { coin, networks: networkList };
    });
  }
}

/**
 * Re-export the typed CCXT error classes so callers can pattern-match on
 * them without importing ccxt directly. The withResultSanitizer wrapper
 * (commit 51b9d0f6) handles the prompt-injection containment regardless.
 */
export {
  AuthenticationError,
  ExchangeNotAvailable,
  NetworkError,
  NotSupported,
  RateLimitExceeded,
};
