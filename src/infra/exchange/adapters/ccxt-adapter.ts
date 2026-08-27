/**
 * CCXT Adapter — full Exchange + ExchangeExtended impl over CCXT v4.
 *
 * Gordon's sole authenticated crypto exchange adapter. The factory routes
 * every venue through `ccxt:<sub-id>` to this class — first-class venues
 * (binance, coinbase, …) and the long-tail (bybit, kucoin, mexc, …).
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
 * Sandbox: CCXT exposes `exchange.setSandboxMode(true)` for ~30 venues.
 * A requested sandbox that the venue cannot provide is refused; it never
 * falls through to a live endpoint.
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
 * not as precise as exchange-native weight trackers, but functionally
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

import { randomUUID } from "node:crypto";
import type {
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
  PublicTrade,
  Deposit,
  Withdrawal,
  RateLimitStatus,
  SymbolInfo,
  SymbolFilter,
  WithdrawalResult,
  WithdrawalInfo,
  ExchangeWebSocket,
  ExchangeDerivatives,
  ExchangeMargin,
  ExchangeAccountManagement,
  ExchangeOrderManagement,
  Position,
  MarginMode,
  FundingRate,
  FundingHistoryEntry,
} from "../types.ts";
import { normalizePemSecret } from "../types.ts";
import { resolveFlag } from "../../config/flagResolver.ts";
import type { Candle } from "../../../types/index.ts";
import { CcxtWebSocketImpl } from "./ccxt-websocket.ts";
import { SandboxNotSupportedError, assertSandboxSupported } from "../sandboxSupport.ts";
import { isKillSwitchesEnabled, isExecutionAllowed } from "../../safety/killSwitches.ts";

/**
 * Conservative default leverage cap when the operator has not set
 * `GORDON_RISK_MAX_LEVERAGE`. 5x keeps a mistaken or model-driven leverage
 * request survivable for a retail account: a ~20% adverse move is the
 * liquidation boundary rather than <1% at venue-max (often 100-125x).
 * Operators who trade with more leverage raise it explicitly via the env
 * var. This is a floor on blast radius, not a strategy limit.
 */
export const DEFAULT_MAX_LEVERAGE = 5;

// ---------------------------------------------------------------------------
// Symbol normalization
// ---------------------------------------------------------------------------

const COMMON_QUOTES = [
  "USDT",
  "USDC",
  "USDC.E",
  "BUSD",
  "DAI",
  "TUSD",
  "FDUSD",
  "BTC",
  "ETH",
  "BNB",
  "SOL",
  "TRX",
  "XRP",
  "EUR",
  "USD",
  "GBP",
  "JPY",
  "AUD",
  "CAD",
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
    case "MARKET":
      return "market";
    case "LIMIT":
      return "limit";
    case "STOP_LOSS":
      return "stop_market";
    case "STOP_LOSS_LIMIT":
      return "stop_limit";
    case "TAKE_PROFIT":
      return "take_profit_market";
    case "TAKE_PROFIT_LIMIT":
      return "take_profit_limit";
    case "LIMIT_MAKER":
      return "limit";
  }
}

function mapOrderTypeFromCcxt(ccxtType: string | undefined): OrderType {
  switch ((ccxtType ?? "").toLowerCase()) {
    case "market":
      return "MARKET";
    case "limit":
      return "LIMIT";
    case "stop_market":
    case "stop":
      return "STOP_LOSS";
    case "stop_limit":
    case "stop_loss_limit":
      return "STOP_LOSS_LIMIT";
    case "take_profit_market":
    case "take_profit":
      return "TAKE_PROFIT";
    case "take_profit_limit":
      return "TAKE_PROFIT_LIMIT";
    default:
      throw new Error(`CCXT order response has unsupported type '${String(ccxtType)}'`);
  }
}

function mapOrderStatusFromCcxt(ccxtStatus: string | undefined): OrderStatus {
  switch ((ccxtStatus ?? "").toLowerCase()) {
    case "open":
      return "NEW";
    case "closed":
      return "FILLED";
    case "canceled":
    case "cancelled":
      return "CANCELED";
    case "expired":
      return "EXPIRED";
    case "rejected":
      return "REJECTED";
    case "partial":
    case "partially_filled":
      return "PARTIALLY_FILLED";
    default:
      throw new Error(`CCXT order response has unsupported status '${String(ccxtStatus)}'`);
  }
}

/**
 * Coerce a CCXT numeric field to a finite number or throw. Money-path
 * fields (`filled`, `price`, `amount`) must never silently degrade to 0
 * on a malformed response — a missing fill would understate exposure and
 * a NaN price would corrupt downstream risk math. Raise instead so the
 * caller fails loud rather than acting on a fabricated zero.
 */
function requireFiniteOrderField(value: unknown, field: string): number {
  const n = Number(value ?? NaN);
  if (!Number.isFinite(n)) {
    throw new Error(`CCXT order response has malformed '${field}' (got ${String(value)})`);
  }
  return n;
}

function requireOrderSide(value: unknown): Order["side"] {
  const side = typeof value === "string" ? value.toLowerCase() : "";
  if (side === "buy") return "BUY";
  if (side === "sell") return "SELL";
  throw new Error(`CCXT order response has unsupported side '${String(value)}'`);
}

function ccxtOrderToOrder(ccxtOrder: Record<string, unknown>): Order {
  const orderId = String(ccxtOrder.id ?? "");
  if (orderId.length === 0) {
    throw new Error("CCXT order response is missing an order id");
  }
  if (ccxtOrder.status === undefined || ccxtOrder.status === null) {
    throw new Error(`CCXT order response is missing status (order ${orderId})`);
  }
  const symbol = String(ccxtOrder.symbol ?? "");
  if (symbol.length === 0) {
    throw new Error(`CCXT order response is missing symbol (order ${orderId})`);
  }
  const quantity = requireFiniteOrderField(ccxtOrder.amount, "amount");
  const executedQty = requireFiniteOrderField(ccxtOrder.filled, "filled");
  const cumulativeQuoteQty = requireFiniteOrderField(ccxtOrder.cost ?? 0, "cost");
  if (quantity <= 0 || executedQty < 0 || cumulativeQuoteQty < 0 || executedQty > quantity) {
    throw new Error(`CCXT order response has inconsistent quantities (order ${orderId})`);
  }
  return {
    orderId,
    clientOrderId: ccxtOrder.clientOrderId ? String(ccxtOrder.clientOrderId) : undefined,
    symbol,
    side: requireOrderSide(ccxtOrder.side),
    type: mapOrderTypeFromCcxt(ccxtOrder.type as string | undefined),
    status: mapOrderStatusFromCcxt(ccxtOrder.status as string | undefined),
    price: requireFiniteOrderField(ccxtOrder.price ?? 0, "price"),
    quantity,
    executedQty,
    cummulativeQuoteQty: cumulativeQuoteQty,
    stopPrice:
      ccxtOrder.stopPrice !== undefined
        ? requireFiniteOrderField(ccxtOrder.stopPrice, "stopPrice")
        : undefined,
    time:
      ccxtOrder.timestamp !== undefined
        ? requireFiniteOrderField(ccxtOrder.timestamp, "timestamp")
        : undefined,
    updateTime:
      ccxtOrder.lastUpdateTimestamp !== undefined
        ? requireFiniteOrderField(ccxtOrder.lastUpdateTimestamp, "lastUpdateTimestamp")
        : undefined,
  };
}

function requirePositiveTradeField(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`CCXT trade response has invalid ${field}`);
  }
  return parsed;
}

function requireTradeSide(value: unknown): Trade["side"] {
  const side = typeof value === "string" ? value.toLowerCase() : "";
  if (side === "buy") return "BUY";
  if (side === "sell") return "SELL";
  throw new Error("CCXT authenticated trade response is missing a valid side");
}

function ccxtTradeToTrade(ccxtTrade: Record<string, unknown>): Trade {
  const fee = ccxtTrade.fee as Record<string, unknown> | undefined;
  const commission = fee?.cost === undefined ? 0 : Number(fee.cost);
  if (!Number.isFinite(commission) || commission < 0) {
    throw new Error("CCXT trade response has invalid commission");
  }
  return {
    id: String(ccxtTrade.id ?? ""),
    orderId: String(ccxtTrade.order ?? ""),
    symbol: String(ccxtTrade.symbol ?? ""),
    side: requireTradeSide(ccxtTrade.side),
    price: requirePositiveTradeField(ccxtTrade.price, "price"),
    quantity: requirePositiveTradeField(ccxtTrade.amount, "amount"),
    commission,
    commissionAsset: fee?.currency ? String(fee.currency) : "",
    time: requirePositiveTradeField(ccxtTrade.timestamp, "timestamp"),
    isMaker: Boolean(ccxtTrade.takerOrMaker === "maker"),
  };
}

function ccxtPublicTradeToTrade(ccxtTrade: Record<string, unknown>): PublicTrade {
  const side = typeof ccxtTrade.side === "string" ? ccxtTrade.side.toLowerCase() : "";
  return {
    id: String(ccxtTrade.id ?? ""),
    symbol: String(ccxtTrade.symbol ?? ""),
    side: side === "buy" ? "BUY" : side === "sell" ? "SELL" : "UNKNOWN",
    price: requirePositiveTradeField(ccxtTrade.price, "price"),
    quantity: requirePositiveTradeField(ccxtTrade.amount, "amount"),
    time: requirePositiveTradeField(ccxtTrade.timestamp, "timestamp"),
    isMaker: Boolean(ccxtTrade.takerOrMaker === "maker"),
  };
}

function _ccxtBalanceToBalance(asset: string, b: Record<string, unknown>): Balance {
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
    case "s":
      return n * 1000;
    case "m":
      return n * 60_000;
    case "h":
      return n * 60 * 60_000;
    case "d":
      return n * 24 * 60 * 60_000;
    case "w":
      return n * 7 * 24 * 60 * 60_000;
    case "M":
      return n * 30 * 24 * 60 * 60_000;
    default:
      return 60_000;
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
  return klass as new (
    config: Record<string, unknown>,
  ) => CcxtBase;
}

// ---------------------------------------------------------------------------
// Client-order-id generation
// ---------------------------------------------------------------------------

/**
 * Generate an idempotent client-order-id when the caller doesn't supply one.
 *
 * Per CCXT's order-creation guidance + Gordon's safety stack: every
 * placeOrder call should carry a clientOrderId so retries (network blip,
 * doom-loop, manual retry) are dedupable at the exchange. Without it,
 * the same intent can produce two orders.
 *
 * Format: `gordon-<16-hex>` — within most exchanges' 32-char clientOrderId
 * limit (Binance's is 36; Bybit, OKX, Kraken all 32+).
 */
function generateClientOrderId(): string {
  return `gordon-${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

// ---------------------------------------------------------------------------
// Position mapping
// ---------------------------------------------------------------------------

function ccxtPositionToPosition(p: Record<string, unknown>): Position {
  const sideRaw = String(p.side ?? "long").toLowerCase();
  const marginModeRaw = String(p.marginMode ?? "cross").toLowerCase();
  return {
    symbol: String(p.symbol ?? ""),
    side: sideRaw === "short" ? "short" : "long",
    contracts: Number(p.contracts ?? 0),
    contractSize: Number(p.contractSize ?? 1),
    entryPrice: Number(p.entryPrice ?? 0),
    markPrice: Number(p.markPrice ?? 0),
    notional: Number(p.notional ?? 0),
    leverage: Number(p.leverage ?? 1),
    liquidationPrice:
      p.liquidationPrice !== undefined && p.liquidationPrice !== null
        ? Number(p.liquidationPrice)
        : null,
    marginMode: marginModeRaw === "isolated" ? "isolated" : "cross",
    unrealizedPnl: Number(p.unrealizedPnl ?? 0),
    percentage: Number(p.percentage ?? 0),
    timestamp: Number(p.timestamp ?? Date.now()),
  };
}

function ccxtFundingRateToFundingRate(f: Record<string, unknown>): FundingRate {
  return {
    symbol: String(f.symbol ?? ""),
    fundingRate: Number(f.fundingRate ?? 0),
    nextFundingRate:
      f.nextFundingRate !== undefined && f.nextFundingRate !== null
        ? Number(f.nextFundingRate)
        : null,
    nextFundingTimestamp:
      f.nextFundingTimestamp !== undefined && f.nextFundingTimestamp !== null
        ? Number(f.nextFundingTimestamp)
        : null,
    timestamp: Number(f.timestamp ?? Date.now()),
  };
}

export class CcxtAdapter
  implements
    ExchangeExtended,
    ExchangeDerivatives,
    ExchangeMargin,
    ExchangeAccountManagement,
    ExchangeOrderManagement
{
  protected client: CcxtBase;
  readonly exchangeId: ExchangeId;
  readonly displayName: string;
  readonly isSandbox: boolean;
  readonly ccxtSubId: string;
  /**
   * Hard cap on leverage this adapter will ever request. Defaults to
   * `GORDON_RISK_MAX_LEVERAGE` (else `DEFAULT_MAX_LEVERAGE` = 5x).
   * `setLeverage` silently floors any request above the cap rather than
   * forwarding it.
   */
  private readonly maxLeverage: number;
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
    options?: { maxLeverage?: number },
  ) {
    const Klass = resolveCcxtClass(ccxtSubId);

    const envMaxLeverage = Number(resolveFlag("GORDON_RISK_MAX_LEVERAGE"));
    this.maxLeverage =
      options?.maxLeverage ??
      (Number.isFinite(envMaxLeverage) && envMaxLeverage > 0
        ? envMaxLeverage
        : DEFAULT_MAX_LEVERAGE);

    const config: Record<string, unknown> = {
      enableRateLimit: true,
    };
    if (credentials.apiKey) config.apiKey = credentials.apiKey;
    // Coinbase CDP / Advanced Trade secrets are EC PEM keys; normalize literal
    // `\n` escapes back to real newlines so CCXT's PEM parser accepts them. No-op
    // for HMAC secrets. Only set `password` when a non-empty passphrase exists —
    // an empty string breaks CDP auth (legacy Coinbase Pro / OKX still pass one).
    if (credentials.apiSecret) config.secret = normalizePemSecret(credentials.apiSecret);
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
      // CAPITAL-SAFETY: refuse to construct a sandbox adapter for a venue known
      // to have no sandbox, rather than silently run against LIVE while
      // isSandbox is true. This static check is the authoritative guard for
      // first-class venues (kraken, coinbase, binance_us, robinhood): CCXT no
      // longer throws NotSupported for them — current CCXT ships an (often
      // empty) `test` URL entry for every exchange, so setSandboxMode succeeds
      // silently. The NotSupported catch below stays as a secondary net for
      // long-tail CCXT venues that have no first-class matrix entry.
      assertSandboxSupported(this.exchangeId, true);
      try {
        this.client.setSandboxMode(true);
      } catch (err) {
        if (err instanceof NotSupported) {
          throw new SandboxNotSupportedError(this.exchangeId);
        }
        throw err;
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
    config?: { maxLeverage?: number },
  ): CcxtAdapter {
    const adapter = Object.create(CcxtAdapter.prototype) as CcxtAdapter;
    (adapter as unknown as { client: unknown }).client = mockClient;
    (adapter as unknown as { ccxtSubId: string }).ccxtSubId = ccxtSubId;
    (adapter as unknown as { exchangeId: ExchangeId }).exchangeId =
      `ccxt:${ccxtSubId}` as ExchangeId;
    (adapter as unknown as { displayName: string }).displayName = `${ccxtSubId} (via CCXT)`;
    (adapter as unknown as { isSandbox: boolean }).isSandbox = sandbox;
    (adapter as unknown as { maxLeverage: number }).maxLeverage =
      config?.maxLeverage ?? DEFAULT_MAX_LEVERAGE;
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

  async getCandles(
    symbol: string,
    interval: string,
    limit = 100,
    since?: number,
  ): Promise<Candle[]> {
    return this.withCallTracking(async () => {
      const ccxtInterval = interval;
      const ohlcv = await this.client.fetchOHLCV(toCcxtSymbol(symbol), ccxtInterval, since, limit);
      const durationMs = intervalDurationMs(interval);
      return ohlcv.map((row: unknown) => {
        const r = row as unknown[];
        const openTime = Number(r[0]);
        const open = Number(r[1]);
        const high = Number(r[2]);
        const low = Number(r[3]);
        const close = Number(r[4]);
        const volume = Number(r[5]);
        if (
          !Number.isFinite(open) ||
          !Number.isFinite(high) ||
          !Number.isFinite(low) ||
          !Number.isFinite(close)
        ) {
          throw new Error(
            `CCXT OHLCV row for ${symbol} has a malformed OHLC value (o=${String(r[1])} h=${String(r[2])} l=${String(r[3])} c=${String(r[4])})`,
          );
        }
        return {
          openTime,
          open,
          high,
          low,
          close,
          volume,
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
      const totals = (balance as Record<string, unknown>).total as
        | Record<string, number>
        | undefined;
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
    // Account equity is a risk input, not a display estimate. Returning zero
    // after a ticker failure makes a funded account look empty, while treating
    // an unpriced base-asset unit as one dollar is dimensionally invalid.
    // Refuse the snapshot unless every positive non-stable balance has a mark.
    const stableAssets = new Set(["USD", "USDT", "USDC", "BUSD", "FDUSD", "DAI"]);
    let totalUsdtValue = 0;
    const tickers = await this.get24hrTickers();
    const priceMap = new Map(tickers.map((t) => [t.symbol, t.lastPrice]));
    for (const balance of nonZeroBalances) {
      if (stableAssets.has(balance.asset)) {
        totalUsdtValue += balance.total;
        continue;
      }

      const price = priceMap.get(`${balance.asset}/USDT`) ?? priceMap.get(`${balance.asset}/USD`);
      if (!(typeof price === "number" && Number.isFinite(price) && price > 0)) {
        throw new Error(
          `Cannot value positive ${balance.asset} balance: no positive ${balance.asset}/USDT or ${balance.asset}/USD ticker`,
        );
      }
      totalUsdtValue += balance.total * price;
    }
    return { accountInfo, totalUsdtValue, nonZeroBalances };
  }

  async getRecentTrades(symbol: string, limit = 20): Promise<PublicTrade[]> {
    return this.withCallTracking(async () => {
      const trades = await this.client.fetchTrades(toCcxtSymbol(symbol), undefined, limit);
      return trades.map((trade) =>
        ccxtPublicTradeToTrade(trade as unknown as Record<string, unknown>),
      );
    });
  }

  // -------------------------------------------------------------------------
  // Trading (authenticated)
  // -------------------------------------------------------------------------

  async placeOrder(params: OrderParams): Promise<Order> {
    return this.withCallTracking(async () => {
      // Kill-switch chokepoint — last line before this adapter creates an
      // order. Idempotent: a read-only check against the trip map, so re-running
      // after a passed preflight is a no-op; it only adds a rejection on paths
      // that reached the adapter without one. Kill-switch + enabled-flag only —
      // the risk classifier lives upstream, not here.
      if (isKillSwitchesEnabled()) {
        const decision = isExecutionAllowed({ venue: this.exchangeId, instrument: params.symbol });
        if (!decision.allowed) {
          throw new Error(
            `${decision.reason}. Reset the relevant kill switch before placing this order.`,
          );
        }
      }

      const ccxtType = mapOrderTypeToCcxt(params.type);
      const side = params.side.toLowerCase() as "buy" | "sell";
      const symbol = toCcxtSymbol(params.symbol);

      // Precision normalization — CCXT v4 guidance: callers must normalize
      // quantity + price to each exchange's lot-size / tick-size / min-notional
      // before submission. Sending raw operator numbers triggers REJECTED
      // orders or silent rounding. The helpers below noop gracefully when
      // markets aren't loaded yet, so callers don't have to remember to
      // loadMarkets() first.
      let amount = params.quantity ?? 0;
      let price = params.price;
      try {
        const markets = (this.client as unknown as { markets?: Record<string, unknown> }).markets;
        if (!markets || Object.keys(markets).length === 0) {
          await this.client.loadMarkets();
        }
        const c = this.client as unknown as {
          amountToPrecision: (symbol: string, amount: number) => string;
          priceToPrecision: (symbol: string, price: number) => string;
        };
        if (amount > 0) amount = Number(c.amountToPrecision(symbol, amount));
        if (price !== undefined && price > 0) price = Number(c.priceToPrecision(symbol, price));
      } catch {
        // Markets not loadable or symbol unknown — fall through with raw
        // numbers. CCXT will surface a clearer InvalidOrder error if the
        // exchange rejects them, which the agent loop can route around.
      }

      // Idempotent retries — auto-generate a clientOrderId when caller
      // doesn't supply one. Without this, network blips or doom-loop
      // retries can place duplicate orders. (Bug fix vs the first CCXT
      // adapter commit.)
      const clientOrderId = params.newClientOrderId ?? generateClientOrderId();

      const ccxtParams: Record<string, unknown> = { clientOrderId };
      if (params.stopPrice !== undefined) ccxtParams.stopPrice = params.stopPrice;
      if (params.timeInForce) ccxtParams.timeInForce = params.timeInForce;

      const order = await this.client.createOrder(
        symbol,
        ccxtType,
        side,
        amount,
        price,
        ccxtParams,
      );
      return ccxtOrderToOrder(order as unknown as Record<string, unknown>);
    });
  }

  async cancelOrder(symbol: string, orderId: string): Promise<void> {
    await this.withCallTracking(() => this.client.cancelOrder(orderId, toCcxtSymbol(symbol)));
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
      const failures: Error[] = [];
      for (const o of open) {
        const raw = o as unknown as Record<string, unknown>;
        const orderId = String(raw.id ?? "");
        if (orderId.length === 0) {
          failures.push(new Error("Cannot cancel a CCXT open order with no order id"));
          continue;
        }
        try {
          await this.client.cancelOrder(orderId, toCcxtSymbol(symbol));
        } catch (error) {
          failures.push(
            error instanceof Error
              ? error
              : new Error(`Failed to cancel CCXT order ${orderId}: ${String(error)}`),
          );
          continue;
        }
        try {
          cancelled.push(ccxtOrderToOrder(raw));
        } catch (error) {
          failures.push(
            error instanceof Error
              ? error
              : new Error(
                  `Cancelled CCXT order ${orderId}, but could not map it: ${String(error)}`,
                ),
          );
        }
      }
      if (failures.length > 0) {
        throw new AggregateError(
          failures,
          `CCXT cancel-all completed ${cancelled.length}/${open.length} cancellations cleanly`,
        );
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
    // CCXT has no unified test-order endpoint. Returning true here made the
    // public `test_order` tool claim venue acceptance without contacting a
    // validator. Unsupported is an error, not evidence that an order is valid.
    throw new Error(
      `Exchange ${this.exchangeId} does not expose a non-dispatching order-validation endpoint; use an explicit sandbox venue for an end-to-end dry run`,
    );
  }

  // -------------------------------------------------------------------------
  // History (authenticated)
  // -------------------------------------------------------------------------

  async getTradeHistory(symbol?: string, limit = 100): Promise<Trade[]> {
    return this.withCallTracking(async () => {
      const trades = await this.client.fetchMyTrades(
        symbol ? toCcxtSymbol(symbol) : undefined,
        undefined,
        limit,
      );
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
    this.wsAdapter = new CcxtWebSocketImpl(
      this.ccxtSubId,
      {
        apiKey: (this.client as unknown as { apiKey?: string }).apiKey,
        secret: (this.client as unknown as { secret?: string }).secret,
        password: (this.client as unknown as { password?: string }).password,
      },
      this.isSandbox,
    );
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

  // -------------------------------------------------------------------------
  // ExchangeDerivatives — perps, futures, options
  // -------------------------------------------------------------------------

  async fetchFundingRate(symbol: string): Promise<FundingRate> {
    return this.withCallTracking(async () => {
      const ccxtClient = this.client as unknown as {
        fetchFundingRate: (s: string) => Promise<unknown>;
      };
      const f = await ccxtClient.fetchFundingRate(toCcxtSymbol(symbol));
      return ccxtFundingRateToFundingRate(f as Record<string, unknown>);
    });
  }

  async fetchFundingRates(symbols?: string[]): Promise<FundingRate[]> {
    return this.withCallTracking(async () => {
      const ccxtClient = this.client as unknown as {
        fetchFundingRates: (s?: string[]) => Promise<Record<string, unknown>>;
      };
      const ccxtSymbols = symbols?.map(toCcxtSymbol);
      const rates = await ccxtClient.fetchFundingRates(ccxtSymbols);
      return Object.values(rates).map((r) =>
        ccxtFundingRateToFundingRate(r as Record<string, unknown>),
      );
    });
  }

  async fetchFundingHistory(
    symbol: string,
    since?: number,
    limit = 100,
  ): Promise<FundingHistoryEntry[]> {
    return this.withCallTracking(async () => {
      const ccxtClient = this.client as unknown as {
        fetchFundingHistory: (s: string, since?: number, limit?: number) => Promise<unknown[]>;
      };
      const entries = await ccxtClient.fetchFundingHistory(toCcxtSymbol(symbol), since, limit);
      return entries.map((e) => {
        const ee = e as Record<string, unknown>;
        return {
          symbol: String(ee.symbol ?? ""),
          amount: Number(ee.amount ?? 0),
          currency: String(ee.code ?? ee.currency ?? ""),
          timestamp: Number(ee.timestamp ?? 0),
        };
      });
    });
  }

  async setLeverage(leverage: number, symbol: string): Promise<void> {
    await this.withCallTracking(async () => {
      const ccxtClient = this.client as unknown as {
        setLeverage: (l: number, s: string) => Promise<unknown>;
      };
      const cap = this.maxLeverage;
      const clamped = Number.isFinite(cap) ? Math.min(leverage, cap) : leverage;
      await ccxtClient.setLeverage(clamped, toCcxtSymbol(symbol));
    });
  }

  async setMarginMode(mode: MarginMode, symbol: string): Promise<void> {
    await this.withCallTracking(async () => {
      const ccxtClient = this.client as unknown as {
        setMarginMode: (m: string, s: string) => Promise<unknown>;
      };
      await ccxtClient.setMarginMode(mode, toCcxtSymbol(symbol));
    });
  }

  async fetchPosition(symbol: string): Promise<Position | null> {
    return this.withCallTracking(async () => {
      const ccxtClient = this.client as unknown as {
        fetchPosition: (s: string) => Promise<unknown>;
      };
      const p = await ccxtClient.fetchPosition(toCcxtSymbol(symbol));
      if (!p) return null;
      return ccxtPositionToPosition(p as Record<string, unknown>);
    });
  }

  async fetchPositions(symbols?: string[]): Promise<Position[]> {
    return this.withCallTracking(async () => {
      const ccxtClient = this.client as unknown as {
        fetchPositions: (s?: string[]) => Promise<unknown[]>;
      };
      const ccxtSymbols = symbols?.map(toCcxtSymbol);
      const positions = await ccxtClient.fetchPositions(ccxtSymbols);
      return positions.map((p) => ccxtPositionToPosition(p as Record<string, unknown>));
    });
  }

  async closePosition(symbol: string): Promise<Order> {
    return this.withCallTracking(async () => {
      const ccxtClient = this.client as unknown as {
        closePosition?: (s: string) => Promise<unknown>;
      };
      if (typeof ccxtClient.closePosition === "function") {
        const o = await ccxtClient.closePosition(toCcxtSymbol(symbol));
        return ccxtOrderToOrder(o as Record<string, unknown>);
      }
      // Fallback: fetch position, place opposite-side market order for the
      // full contracts amount. Most CCXT exchanges support this path.
      const pos = await this.fetchPosition(symbol);
      if (!pos || pos.contracts === 0) {
        throw new Error(`No open position to close for ${symbol}`);
      }
      const closeSide = pos.side === "long" ? "SELL" : "BUY";
      return this.placeOrder({
        symbol,
        side: closeSide,
        type: "MARKET",
        quantity: Math.abs(pos.contracts),
      });
    });
  }

  // -------------------------------------------------------------------------
  // ExchangeMargin — borrow/repay/add-margin
  // -------------------------------------------------------------------------

  async addMargin(symbol: string, amount: number): Promise<{ symbol: string; amount: number }> {
    return this.withCallTracking(async () => {
      const ccxtClient = this.client as unknown as {
        addMargin: (s: string, a: number) => Promise<unknown>;
      };
      const result = await ccxtClient.addMargin(toCcxtSymbol(symbol), amount);
      const r = result as Record<string, unknown>;
      return { symbol: String(r.symbol ?? symbol), amount: Number(r.amount ?? amount) };
    });
  }

  async borrowCrossMargin(
    currency: string,
    amount: number,
  ): Promise<{ id: string; amount: number }> {
    return this.withCallTracking(async () => {
      const ccxtClient = this.client as unknown as {
        borrowCrossMargin: (c: string, a: number) => Promise<unknown>;
      };
      const result = await ccxtClient.borrowCrossMargin(currency, amount);
      const r = result as Record<string, unknown>;
      return { id: String(r.id ?? ""), amount: Number(r.amount ?? amount) };
    });
  }

  async borrowIsolatedMargin(
    symbol: string,
    currency: string,
    amount: number,
  ): Promise<{ id: string; amount: number }> {
    return this.withCallTracking(async () => {
      const ccxtClient = this.client as unknown as {
        borrowIsolatedMargin: (s: string, c: string, a: number) => Promise<unknown>;
      };
      const result = await ccxtClient.borrowIsolatedMargin(toCcxtSymbol(symbol), currency, amount);
      const r = result as Record<string, unknown>;
      return { id: String(r.id ?? ""), amount: Number(r.amount ?? amount) };
    });
  }

  async repayMargin(
    currency: string,
    amount: number,
    symbol?: string,
  ): Promise<{ id: string; amount: number }> {
    return this.withCallTracking(async () => {
      const ccxtClient = this.client as unknown as {
        repayMargin: (c: string, a: number, s?: string) => Promise<unknown>;
      };
      const result = await ccxtClient.repayMargin(
        currency,
        amount,
        symbol ? toCcxtSymbol(symbol) : undefined,
      );
      const r = result as Record<string, unknown>;
      return { id: String(r.id ?? ""), amount: Number(r.amount ?? amount) };
    });
  }

  // -------------------------------------------------------------------------
  // ExchangeAccountManagement — sub-accounts + transfers
  // -------------------------------------------------------------------------

  async fetchAccounts(): Promise<Array<{ id: string; type: string; code?: string }>> {
    return this.withCallTracking(async () => {
      const ccxtClient = this.client as unknown as {
        fetchAccounts: () => Promise<unknown[]>;
      };
      const accounts = await ccxtClient.fetchAccounts();
      return accounts.map((a) => {
        const aa = a as Record<string, unknown>;
        return {
          id: String(aa.id ?? ""),
          type: String(aa.type ?? "spot"),
          code: aa.code ? String(aa.code) : undefined,
        };
      });
    });
  }

  async transfer(
    currency: string,
    amount: number,
    fromAccount: string,
    toAccount: string,
  ): Promise<{ id: string; status: string }> {
    return this.withCallTracking(async () => {
      const ccxtClient = this.client as unknown as {
        transfer: (c: string, a: number, f: string, t: string) => Promise<unknown>;
      };
      const result = await ccxtClient.transfer(currency, amount, fromAccount, toAccount);
      const r = result as Record<string, unknown>;
      return { id: String(r.id ?? ""), status: String(r.status ?? "pending") };
    });
  }

  // -------------------------------------------------------------------------
  // ExchangeOrderManagement — edit + batch
  // -------------------------------------------------------------------------

  async editOrder(orderId: string, params: OrderParams): Promise<Order> {
    return this.withCallTracking(async () => {
      const ccxtClient = this.client as unknown as {
        editOrder: (
          id: string,
          symbol: string,
          type: string,
          side: string,
          amount?: number,
          price?: number,
          params?: Record<string, unknown>,
        ) => Promise<unknown>;
      };
      const ccxtType = mapOrderTypeToCcxt(params.type);
      const side = params.side.toLowerCase() as "buy" | "sell";
      const symbol = toCcxtSymbol(params.symbol);
      const result = await ccxtClient.editOrder(
        orderId,
        symbol,
        ccxtType,
        side,
        params.quantity,
        params.price,
        {},
      );
      return ccxtOrderToOrder(result as Record<string, unknown>);
    });
  }

  async createOrders(orders: OrderParams[]): Promise<Order[]> {
    return this.withCallTracking(async () => {
      const ccxtClient = this.client as unknown as {
        createOrders?: (orders: Array<Record<string, unknown>>) => Promise<unknown[]>;
      };
      // Use native batch if the exchange supports it; fall back to
      // sequential placeOrder calls otherwise. (Many CCXT exchanges
      // implement createOrders, but not all.)
      if (typeof ccxtClient.createOrders === "function") {
        const ccxtOrders = orders.map((o) => ({
          symbol: toCcxtSymbol(o.symbol),
          type: mapOrderTypeToCcxt(o.type),
          side: o.side.toLowerCase(),
          amount: o.quantity,
          price: o.price,
          params: {
            ...(o.stopPrice !== undefined ? { stopPrice: o.stopPrice } : {}),
            ...(o.timeInForce ? { timeInForce: o.timeInForce } : {}),
            clientOrderId: o.newClientOrderId ?? generateClientOrderId(),
          },
        }));
        const results = await ccxtClient.createOrders(ccxtOrders);
        return results.map((r) => ccxtOrderToOrder(r as Record<string, unknown>));
      }
      const placed: Order[] = [];
      for (const o of orders) {
        placed.push(await this.placeOrder(o));
      }
      return placed;
    });
  }

  async cancelOrders(orderIds: string[], symbol: string): Promise<void> {
    await this.withCallTracking(async () => {
      const ccxtSymbol = toCcxtSymbol(symbol);
      const ccxtClient = this.client as unknown as {
        cancelOrders?: (ids: string[], symbol?: string) => Promise<unknown>;
      };
      if (typeof ccxtClient.cancelOrders === "function") {
        await ccxtClient.cancelOrders(orderIds, ccxtSymbol);
        return;
      }
      // Sequential fallback
      for (const id of orderIds) {
        await this.client.cancelOrder(id, ccxtSymbol);
      }
    });
  }

  // -------------------------------------------------------------------------
  // Capability introspection
  // -------------------------------------------------------------------------

  /**
   * Return the exchange's `.features` object — CCXT's per-method capability
   * map. Useful for "does this exchange support X?" checks before calling
   * a method that might throw NotSupported.
   *
   * Example: adapter.supports("fetchPositions") returns true iff the
   * underlying CCXT exchange implements fetchPositions.
   */
  getFeatures(): Record<string, unknown> | undefined {
    return (this.client as unknown as { features?: Record<string, unknown> }).features;
  }

  /**
   * Check whether the underlying CCXT exchange supports a unified method.
   * Reads CCXT's `.has` map.
   */
  supports(method: string): boolean {
    const has = (this.client as unknown as { has?: Record<string, unknown> }).has;
    return Boolean(has?.[method]);
  }

  // -------------------------------------------------------------------------
  // Pagination — explicit since/until support beyond Gordon's base Exchange interface
  // -------------------------------------------------------------------------

  async fetchTradeHistoryPaginated(
    symbol: string,
    since?: number,
    limit?: number,
    until?: number,
  ): Promise<Trade[]> {
    return this.withCallTracking(async () => {
      const ccxtParams: Record<string, unknown> = {};
      if (until !== undefined) ccxtParams.until = until;
      const trades = await this.client.fetchMyTrades(
        toCcxtSymbol(symbol),
        since,
        limit,
        ccxtParams,
      );
      return trades.map((t) => ccxtTradeToTrade(t as unknown as Record<string, unknown>));
    });
  }

  async fetchOrderHistoryPaginated(
    symbol: string,
    since?: number,
    limit?: number,
    until?: number,
  ): Promise<Order[]> {
    return this.withCallTracking(async () => {
      const ccxtParams: Record<string, unknown> = {};
      if (until !== undefined) ccxtParams.until = until;
      const orders = await this.client.fetchClosedOrders(
        toCcxtSymbol(symbol),
        since,
        limit,
        ccxtParams,
      );
      return orders.map((o) => ccxtOrderToOrder(o as unknown as Record<string, unknown>));
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
export { AuthenticationError, ExchangeNotAvailable, NetworkError, NotSupported, RateLimitExceeded };
