/**
 * Exchange Abstraction Layer - Core Types
 * Defines the abstract Exchange interface for multi-exchange support
 */

import type { Candle } from "../../types/index.ts";

// ============================================================================
// Exchange Identification
// ============================================================================

/**
 * First-class venue ids — curated env-var names, sandbox metadata, OAuth.
 * Runtime adapter is always CcxtAdapter (`ccxt:<subId>`).
 */
export type NativeExchangeId =
  | "binance"
  | "binance_us"
  | "coinbase"
  | "kraken"
  | "bitfinex"
  | "hyperliquid"
  | "robinhood"
  | "okx"
  | "gemini";

/**
 * Canonical exchange identifiers — `ccxt:<ccxt-sub-id>` for any of the
 * 107 exchanges CCXT supports. Config stores only this form; bare first-class
 * ids are migrated on load.
 *
 * Examples: `"ccxt:binance"`, `"ccxt:bybit"`, `"ccxt:kucoin"`, `"ccxt:mexc"`.
 *
 * The factory routes any id starting with `ccxt:` to `CcxtAdapter` with
 * the sub-id passed through.
 */
export type CcxtExchangeId = `ccxt:${string}`;

/**
 * Union of all exchange identifiers Gordon's factory can construct.
 * Natives + the CCXT-prefixed long-tail.
 */
export type ExchangeId = NativeExchangeId | CcxtExchangeId;

/**
 * Type guard: canonical CCXT-routed id.
 */
export function isCcxtExchangeId(id: string): id is CcxtExchangeId {
  return id.startsWith("ccxt:");
}

/**
 * Runtime array of native exchange IDs. Kept in sync with NativeExchangeId
 * via the `satisfies` constraint — the compiler errors if this drifts from
 * the type union. CCXT IDs are not enumerable at compile time (107 of them,
 * and the set may grow with CCXT updates) so they're not part of this list.
 */
export const EXCHANGE_IDS = [
  "binance", "binance_us", "coinbase", "kraken", "bitfinex",
  "hyperliquid", "robinhood", "okx", "gemini",
] as const satisfies readonly NativeExchangeId[];

/**
 * Extract the CCXT sub-id from a `ccxt:*` exchange id.
 * Example: `extractCcxtSubId("ccxt:bybit") === "bybit"`.
 */
export function extractCcxtSubId(id: CcxtExchangeId): string {
  return id.slice("ccxt:".length);
}

/**
 * Exchange credentials for authentication
 */
export interface ExchangeCredentials {
  apiKey: string;
  apiSecret: string;
  /** Some exchanges require a passphrase (e.g., Coinbase) */
  passphrase?: string;
  /** Use sandbox/testnet mode */
  sandbox?: boolean;
  /** Wallet private key for DEX exchanges (e.g., Hyperliquid) */
  walletPrivateKey?: string;
  /** Wallet/main-account address for DEX exchanges (Hyperliquid via CCXT — read endpoints key off the address, which CCXT does not derive from the private key) */
  walletAddress?: string;
  /** OAuth 2.0 bearer access token (e.g., Gemini) — takes precedence over apiKey/apiSecret */
  accessToken?: string;
}

/**
 * Maps exchange type → environment variable names for credential storage.
 * Used by saveConfiguration to persist all exchange keys to .env,
 * and by resolveExchangeCredentials to restore them from process.env.
 */
export const EXCHANGE_ENV_MAP: Record<NativeExchangeId, { key?: string; secret?: string; passphrase?: string; wallet?: string; walletAddress?: string }> = {
  binance:     { key: "BINANCE_API_KEY",     secret: "BINANCE_API_SECRET" },
  binance_us:  { key: "BINANCE_US_API_KEY",  secret: "BINANCE_US_API_SECRET" },
  coinbase:    { key: "COINBASE_API_KEY",     secret: "COINBASE_API_SECRET",   passphrase: "COINBASE_PASSPHRASE" },
  kraken:      { key: "KRAKEN_API_KEY",       secret: "KRAKEN_API_SECRET" },
  bitfinex:    { key: "BITFINEX_API_KEY",     secret: "BITFINEX_API_SECRET" },
  hyperliquid: { wallet: "HYPERLIQUID_PRIVATE_KEY", walletAddress: "HYPERLIQUID_WALLET_ADDRESS" },
  robinhood:   { key: "ROBINHOOD_API_KEY",    secret: "ROBINHOOD_API_SECRET" },
  okx:         { key: "OKX_API_KEY",          secret: "OKX_API_SECRET",       passphrase: "OKX_PASSPHRASE" },
  gemini:      { key: "GEMINI_API_KEY",       secret: "GEMINI_API_SECRET" },
};

/**
 * Resolve exchange credentials, preferring process.env over config values.
 * Config may store "***" placeholders; this resolves them from env.
 */
/**
 * Normalize a secret that is a PEM private key (Coinbase CDP / Advanced Trade
 * keys ship an EC PRIVATE KEY as the secret, no passphrase). Operators paste
 * these into `.env` where the newlines survive as the literal two-character
 * sequence `\n` rather than real line breaks; CCXT's PEM parser then fails with
 * "Illegal character at offset 30". This converts the escapes back to real
 * newlines and strips any surrounding quotes/whitespace so CCXT receives a
 * valid multi-line PEM.
 *
 * No-op for non-PEM secrets (legacy HMAC keys) — they pass through unchanged.
 */
export function normalizePemSecret(secret: string): string {
  let s = secret.trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1);
  }
  if (s.includes("BEGIN") && s.includes("PRIVATE KEY")) {
    s = s
      .replace(/\\r\\n/g, "\n")
      .replace(/\\n/g, "\n")
      .replace(/\r\n/g, "\n");
  }
  return s;
}

/**
 * Build CCXT-side env var names for a given ccxt sub-id. Operators set
 * `CCXT_<UPPER>_API_KEY`, `CCXT_<UPPER>_API_SECRET`, etc. per exchange.
 * Adopting a uniform pattern avoids exploding `EXCHANGE_ENV_MAP` to 107 entries.
 */
export function ccxtEnvNames(ccxtSubId: string): {
  key: string;
  secret: string;
  passphrase: string;
  walletKey: string;
  walletAddress: string;
} {
  const upper = ccxtSubId.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  return {
    key: `CCXT_${upper}_API_KEY`,
    secret: `CCXT_${upper}_API_SECRET`,
    passphrase: `CCXT_${upper}_PASSPHRASE`,
    walletKey: `CCXT_${upper}_WALLET_PRIVATE_KEY`,
    walletAddress: `CCXT_${upper}_WALLET_ADDRESS`,
  };
}

/**
 * Each first-class venue id → its CCXT sub-id. The canonical venue id form is
 * `ccxt:<subId>`; first-class venues carry curated env-var names
 * (EXCHANGE_ENV_MAP) and sandbox-support metadata.
 * Only binance_us's sub-id differs from its venue id.
 */
export const NATIVE_TO_CCXT_SUBID: Record<NativeExchangeId, string> = {
  binance: "binance",
  binance_us: "binanceus",
  coinbase: "coinbase",
  kraken: "kraken",
  bitfinex: "bitfinex",
  hyperliquid: "hyperliquid",
  robinhood: "robinhood",
  okx: "okx",
  gemini: "gemini",
};

const CCXT_SUBID_TO_NATIVE: Record<string, NativeExchangeId> = Object.fromEntries(
  (Object.entries(NATIVE_TO_CCXT_SUBID) as [NativeExchangeId, string][]).map(
    ([native, subId]) => [subId, native],
  ),
);

/**
 * Normalize any accepted venue id to its canonical `ccxt:<subId>` form. Bare
 * first-class ids (e.g. "binance", saved in older configs) map to their CCXT
 * sub-id ("ccxt:binance"); ids already in `ccxt:*` form pass through. Every
 * venue routes through CcxtAdapter, so this is the single canonical shape.
 */
export function normalizeExchangeId(id: string): CcxtExchangeId {
  if (isCcxtExchangeId(id)) return id;
  const subId = NATIVE_TO_CCXT_SUBID[id as NativeExchangeId] ?? id;
  return `ccxt:${subId}` as CcxtExchangeId;
}

/**
 * Resolve a venue id (canonical `ccxt:<subId>` or a bare first-class id) back
 * to its first-class NativeExchangeId, if it is one. Returns undefined for the
 * long-tail CCXT venues. Used to recover curated env-var names + sandbox
 * support metadata after normalization to the `ccxt:*` form.
 */
export function ccxtIdToNativeVenue(id: string): NativeExchangeId | undefined {
  if (!isCcxtExchangeId(id)) {
    return id in NATIVE_TO_CCXT_SUBID ? (id as NativeExchangeId) : undefined;
  }
  return CCXT_SUBID_TO_NATIVE[extractCcxtSubId(id as CcxtExchangeId)];
}

export function resolveExchangeCredentials(
  config: { type: string; apiKey: string; apiSecret: string; passphrase?: string; walletPrivateKey?: string; sandbox?: boolean },
): ExchangeCredentials {
  // CCXT exchanges use their own env var pattern (CCXT_<UPPER>_*). For the
  // first-class venues (ccxt:binance, …) we ALSO fall back to their curated
  // native env names (BINANCE_API_KEY, …) so existing operator keys keep
  // working without re-provisioning after the all-`ccxt:` normalization.
  if (isCcxtExchangeId(config.type as ExchangeId)) {
    const subId = extractCcxtSubId(config.type as CcxtExchangeId);
    const envs = ccxtEnvNames(subId);
    const nativeVenue = ccxtIdToNativeVenue(config.type);
    const legacy = nativeVenue ? EXCHANGE_ENV_MAP[nativeVenue] : undefined;
    const isRedacted = (v: string | undefined) => !v || v === "***";
    const fromEnv = (...names: (string | undefined)[]) => {
      for (const name of names) {
        if (name && process.env[name]) return process.env[name];
      }
      return undefined;
    };
    let apiKey = config.apiKey;
    let apiSecret = config.apiSecret;
    let passphrase = config.passphrase;
    let walletPrivateKey = config.walletPrivateKey;
    if (isRedacted(apiKey)) apiKey = fromEnv(envs.key, legacy?.key) || "";
    if (isRedacted(apiSecret)) apiSecret = fromEnv(envs.secret, legacy?.secret) || "";
    if (isRedacted(passphrase)) passphrase = fromEnv(envs.passphrase, legacy?.passphrase);
    if (isRedacted(walletPrivateKey)) walletPrivateKey = fromEnv(envs.walletKey, legacy?.wallet);
    const walletAddress = fromEnv(envs.walletAddress, legacy?.walletAddress);
    apiSecret = normalizePemSecret(apiSecret);
    if (!passphrase) passphrase = undefined;
    return { apiKey, apiSecret, passphrase, sandbox: config.sandbox, walletPrivateKey, walletAddress };
  }

  const envMap = config.type in EXCHANGE_ENV_MAP
    ? EXCHANGE_ENV_MAP[config.type as NativeExchangeId]
    : undefined;
  const isRedacted = (v: string | undefined) => !v || v === "***";

  let apiKey = config.apiKey;
  let apiSecret = config.apiSecret;
  let passphrase = config.passphrase;
  let walletPrivateKey = config.walletPrivateKey;
  let walletAddress: string | undefined;

  if (envMap) {
    if (isRedacted(apiKey) && envMap.key) apiKey = process.env[envMap.key] || "";
    if (isRedacted(apiSecret) && envMap.secret) apiSecret = process.env[envMap.secret] || "";
    if (isRedacted(passphrase) && envMap.passphrase) passphrase = process.env[envMap.passphrase] || undefined;
    if (isRedacted(walletPrivateKey) && envMap.wallet) walletPrivateKey = process.env[envMap.wallet] || undefined;
    if (envMap.walletAddress) walletAddress = process.env[envMap.walletAddress] || undefined;
  }

  // Final fallback: clear any remaining redacted placeholders
  if (isRedacted(apiKey)) apiKey = "";
  if (isRedacted(apiSecret)) apiSecret = "";
  if (isRedacted(passphrase)) passphrase = undefined;
  if (isRedacted(walletPrivateKey)) walletPrivateKey = undefined;

  apiSecret = normalizePemSecret(apiSecret);
  if (!passphrase) passphrase = undefined;

  return { apiKey, apiSecret, passphrase, sandbox: config.sandbox, walletPrivateKey, walletAddress };
}

// ============================================================================
// Market Data Types (Exchange-Agnostic)
// ============================================================================

/**
 * 24-hour ticker data
 */
export interface Ticker24hr {
  symbol: string;
  priceChange: number;
  priceChangePercent: number;
  lastPrice: number;
  highPrice: number;
  lowPrice: number;
  volume: number;
  quoteVolume: number;
  openTime: number;
  closeTime: number;
}

/**
 * Order book entry
 */
export interface OrderBookEntry {
  price: number;
  quantity: number;
}

/**
 * Order book snapshot
 */
export interface OrderBook {
  lastUpdateId: number;
  bids: OrderBookEntry[];
  asks: OrderBookEntry[];
}

/**
 * Book ticker (best bid/ask)
 */
export interface BookTicker {
  symbol: string;
  bidPrice: number;
  bidQty: number;
  askPrice: number;
  askQty: number;
}

/**
 * Spread information
 */
export interface SpreadInfo {
  spread: number;
  spreadPercent: number;
  bidPrice: number;
  askPrice: number;
}

/**
 * Average price
 */
export interface AvgPrice {
  mins: number;
  price: number;
}

/**
 * Exchange information
 */
export interface ExchangeInfo {
  timezone: string;
  serverTime: number;
  symbols: SymbolInfo[];
}

/**
 * Symbol/market information
 */
export interface SymbolInfo {
  symbol: string;
  status: string;
  baseAsset: string;
  quoteAsset: string;
  baseAssetPrecision: number;
  quoteAssetPrecision: number;
  orderTypes: OrderType[];
  isSpotTradingAllowed: boolean;
  filters: SymbolFilter[];
}

/**
 * Symbol filter (price, lot size, etc.)
 */
export interface SymbolFilter {
  filterType: string;
  minPrice?: string;
  maxPrice?: string;
  tickSize?: string;
  minQty?: string;
  maxQty?: string;
  stepSize?: string;
  minNotional?: string;
  [key: string]: string | number | boolean | undefined;
}

// ============================================================================
// Account Types
// ============================================================================

/**
 * Account information
 */
export interface AccountInfo {
  canTrade: boolean;
  canWithdraw: boolean;
  canDeposit: boolean;
  accountType: string;
  balances: Balance[];
  updateTime: number;
}

/**
 * Asset balance
 */
export interface Balance {
  asset: string;
  free: number;
  locked: number;
  total: number;
}

/**
 * Detailed account info with portfolio value
 */
export interface AccountDetails {
  accountInfo: AccountInfo;
  totalUsdtValue: number;
  nonZeroBalances: Balance[];
}

// ============================================================================
// Trading Types
// ============================================================================

/**
 * Order side
 */
export type OrderSide = "BUY" | "SELL";

/**
 * Order type
 */
export type OrderType =
  | "MARKET"
  | "LIMIT"
  | "STOP_LOSS"
  | "STOP_LOSS_LIMIT"
  | "TAKE_PROFIT"
  | "TAKE_PROFIT_LIMIT"
  | "LIMIT_MAKER";

/**
 * Order status
 */
export type OrderStatus =
  | "NEW"
  | "PARTIALLY_FILLED"
  | "FILLED"
  | "CANCELED"
  | "PENDING_CANCEL"
  | "REJECTED"
  | "EXPIRED";

/**
 * Time in force
 */
export type TimeInForce = "GTC" | "IOC" | "FOK";

/**
 * Order parameters for placing orders
 */
export interface OrderParams {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity?: number;
  quoteOrderQty?: number;
  price?: number;
  stopPrice?: number;
  timeInForce?: TimeInForce;
  newClientOrderId?: string;
}

/**
 * Order response
 */
export interface Order {
  orderId: string;
  clientOrderId?: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  status: OrderStatus;
  price: number;
  quantity: number;
  executedQty: number;
  cummulativeQuoteQty: number;
  timeInForce?: TimeInForce;
  stopPrice?: number;
  time?: number;
  updateTime?: number;
  isWorking?: boolean;
}

/**
 * Trade (filled order execution)
 */
export interface Trade {
  id: string;
  orderId: string;
  symbol: string;
  side: OrderSide;
  price: number;
  quantity: number;
  commission: number;
  commissionAsset: string;
  time: number;
  isMaker: boolean;
}

// ============================================================================
// Wallet Types
// ============================================================================

/**
 * Deposit record
 */
export interface Deposit {
  id: string;
  amount: number;
  coin: string;
  network: string;
  status: number;
  address: string;
  txId?: string;
  insertTime: number;
  confirmTimes?: string;
}

/**
 * Withdrawal record
 */
export interface Withdrawal {
  id: string;
  amount: number;
  coin: string;
  network: string;
  status: number;
  address: string;
  txId?: string;
  applyTime: number;
  completeTime?: number;
  transactionFee?: number;
}

/**
 * Deposit address
 */
export interface DepositAddress {
  coin: string;
  address: string;
  tag?: string;
  url?: string;
}

/**
 * Result of a withdrawal request
 */
export interface WithdrawalResult {
  id: string;
  coin: string;
  amount: number;
  network: string;
  address: string;
  fee: number;
  status: string;
}

/**
 * Withdrawal fee and limit information for a coin across networks
 */
export interface WithdrawalInfo {
  coin: string;
  networks: {
    network: string;
    name: string;
    withdrawEnabled: boolean;
    withdrawFee: number;
    withdrawMin: number;
    withdrawMax: number;
    estimatedArrivalMins: number;
  }[];
}

// ============================================================================
// Rate Limiting
// ============================================================================

/**
 * Rate limit status
 */
export interface RateLimitStatus {
  currentWeight: number;
  maxWeight: number;
  usagePercent: number;
  isThrottling: boolean;
  throttledCount: number;
  timeUntilReset: number;
}

// ============================================================================
// Exchange Interface
// ============================================================================

/**
 * Abstract Exchange interface
 * All exchange adapters must implement this interface
 */
export interface Exchange {
  // -------------------------------------------------------------------------
  // Identification
  // -------------------------------------------------------------------------

  /** Exchange identifier */
  readonly exchangeId: ExchangeId;

  /** Human-readable exchange name */
  readonly displayName: string;

  /**
   * True when the adapter is routed to a sandbox/testnet environment.
   * Optional for backwards-compat — adapters that don't declare it are
   * treated as live. Callers can rely on this to unblock paper-mode
   * execution: a live-blocked operation is safe when it's going to
   * fake-money infrastructure.
   */
  readonly isSandbox?: boolean;

  // -------------------------------------------------------------------------
  // Connection
  // -------------------------------------------------------------------------

  /** Test connectivity to the exchange */
  testConnection(): Promise<boolean>;

  /** Get exchange information (symbols, filters, etc.) */
  getExchangeInfo(): Promise<ExchangeInfo>;

  // -------------------------------------------------------------------------
  // Market Data (Public)
  // -------------------------------------------------------------------------

  /** Get current price for a symbol */
  getPrice(symbol: string): Promise<number>;

  /** Get candlestick/kline data */
  getCandles(symbol: string, interval: string, limit?: number, since?: number): Promise<Candle[]>;

  /** Get 24hr ticker data for all symbols */
  get24hrTickers(): Promise<Ticker24hr[]>;

  /** Get top N symbols by volume */
  getTopSymbols(n: number): Promise<string[]>;

  /** Get order book for a symbol */
  getOrderBook(symbol: string, limit?: number): Promise<OrderBook>;

  /** Get best bid/ask for a symbol */
  getBookTicker(symbol: string): Promise<BookTicker>;

  /** Get spread information */
  getSpread(symbol: string): Promise<SpreadInfo>;

  /** Get average price over a period */
  getAvgPrice(symbol: string): Promise<AvgPrice>;

  // -------------------------------------------------------------------------
  // Account (Authenticated)
  // -------------------------------------------------------------------------

  /** Get account information */
  getAccountInfo(): Promise<AccountInfo>;

  /** Get balance for a specific asset */
  getBalance(asset: string): Promise<number>;

  /** Get all non-zero balances */
  getAllBalances(): Promise<Balance[]>;

  /** Get full account details including portfolio value */
  getFullAccountDetails(): Promise<AccountDetails>;

  // -------------------------------------------------------------------------
  // Trading (Authenticated)
  // -------------------------------------------------------------------------

  /** Place an order */
  placeOrder(params: OrderParams): Promise<Order>;

  /** Cancel an order */
  cancelOrder(symbol: string, orderId: string): Promise<void>;

  /** Cancel all orders for a symbol */
  cancelAllOrders(symbol: string): Promise<Order[]>;

  /** Get open orders */
  getOpenOrders(symbol?: string): Promise<Order[]>;

  /** Get order status */
  getOrderStatus(symbol: string, orderId: number | string): Promise<Order>;

  /** Test order (dry run) */
  testOrder(params: OrderParams): Promise<boolean>;

  // -------------------------------------------------------------------------
  // History (Authenticated)
  // -------------------------------------------------------------------------

  /** Get trade history for a symbol */
  getTradeHistory(symbol: string, limit?: number): Promise<Trade[]>;

  /** Get order history for a symbol */
  getOrderHistory(symbol: string, limit?: number): Promise<Order[]>;

  /** Get deposit history */
  getDepositHistory(limit?: number): Promise<Deposit[]>;

  /** Get withdrawal history */
  getWithdrawalHistory(limit?: number): Promise<Withdrawal[]>;

  // -------------------------------------------------------------------------
  // Rate Limiting & Status
  // -------------------------------------------------------------------------

  /** Check if requests should be throttled */
  shouldThrottle(): boolean;

  /** Get current rate limit status */
  getRateLimitStatus(): RateLimitStatus;

  /** Get circuit breaker state */
  getCircuitBreakerState(): string;

  /** Reset circuit breaker */
  resetCircuitBreaker(): void;
}

// ============================================================================
// Derivatives Types (CCXT-aligned)
// ============================================================================

/**
 * Position side — long for buy-and-hold derivatives exposure, short for sell-first.
 */
export type PositionSide = "long" | "short";

/**
 * Margin mode for derivatives. Isolated caps loss to the position's own
 * margin; cross shares the entire account's margin pool.
 */
export type MarginMode = "isolated" | "cross";

/**
 * Open position on a perpetual / future / option contract.
 *
 * Field semantics follow CCXT's unified Position structure:
 * https://docs.ccxt.com/#/Manual?id=position-structure
 */
export interface Position {
  symbol: string;
  side: PositionSide;
  contracts: number;
  contractSize: number;
  entryPrice: number;
  markPrice: number;
  notional: number;
  leverage: number;
  liquidationPrice: number | null;
  marginMode: MarginMode;
  unrealizedPnl: number;
  /** Unrealized P&L as a percentage of position margin. */
  percentage: number;
  timestamp: number;
}

/**
 * Current funding rate snapshot for a perp symbol.
 *
 * Field semantics follow CCXT's unified funding-rate structure.
 */
export interface FundingRate {
  symbol: string;
  fundingRate: number;
  /** Next forecast funding rate (when the exchange exposes it). */
  nextFundingRate: number | null;
  nextFundingTimestamp: number | null;
  timestamp: number;
}

/**
 * Historical funding-rate accrual entry — usually one entry per funding
 * interval the account was open for.
 */
export interface FundingHistoryEntry {
  symbol: string;
  amount: number;
  currency: string;
  timestamp: number;
}

// ============================================================================
// Optional capability interfaces — implemented by exchanges that support them.
// CCXT-routed adapters cover these optional surfaces via the unified API.
// ============================================================================

/**
 * Derivatives surface — perps, futures, options. Covers funding rate
 * reads, position management, leverage + margin-mode configuration, and
 * atomic position-close.
 */
export interface ExchangeDerivatives {
  fetchFundingRate(symbol: string): Promise<FundingRate>;
  fetchFundingRates(symbols?: string[]): Promise<FundingRate[]>;
  fetchFundingHistory(symbol: string, since?: number, limit?: number): Promise<FundingHistoryEntry[]>;
  setLeverage(leverage: number, symbol: string): Promise<void>;
  setMarginMode(mode: MarginMode, symbol: string): Promise<void>;
  fetchPosition(symbol: string): Promise<Position | null>;
  fetchPositions(symbols?: string[]): Promise<Position[]>;
  closePosition(symbol: string): Promise<Order>;
}

/**
 * Margin trading surface — borrow, repay, and add-margin-to-position
 * operations. Cross vs isolated covered explicitly.
 */
export interface ExchangeMargin {
  addMargin(symbol: string, amount: number): Promise<{ symbol: string; amount: number }>;
  borrowCrossMargin(currency: string, amount: number): Promise<{ id: string; amount: number }>;
  borrowIsolatedMargin(symbol: string, currency: string, amount: number): Promise<{ id: string; amount: number }>;
  repayMargin(currency: string, amount: number, symbol?: string): Promise<{ id: string; amount: number }>;
}

/**
 * Account management — sub-accounts + inter-account transfers (spot ↔
 * futures, main ↔ subaccount, etc.). Used for funds movement that doesn't
 * touch the broader withdraw surface.
 */
export interface ExchangeAccountManagement {
  fetchAccounts(): Promise<Array<{ id: string; type: string; code?: string }>>;
  transfer(
    currency: string,
    amount: number,
    fromAccount: string,
    toAccount: string,
  ): Promise<{ id: string; status: string }>;
}

/**
 * Advanced order management beyond place/cancel — edit, batch, and TWAP.
 * Most exchanges support `editOrder` (often cheaper than cancel+re-place);
 * batch ops vary widely; TWAP is niche.
 */
export interface ExchangeOrderManagement {
  editOrder(orderId: string, params: OrderParams): Promise<Order>;
  createOrders(orders: OrderParams[]): Promise<Order[]>;
  cancelOrders(orderIds: string[], symbol: string): Promise<void>;
}

/**
 * Optional extended features that some exchanges support
 */
export interface ExchangeExtended extends Exchange {
  // OCO Orders
  placeOCOOrder?(params: OCOOrderParams): Promise<OCOOrder>;
  cancelOrderList?(symbol: string, orderListId: number): Promise<void>;

  // Earn/Staking
  getEarnPositions?(): Promise<EarnPosition[]>;
  subscribeFlexible?(productId: string, amount: number): Promise<EarnSubscription>;
  redeemFlexible?(productId: string, amount?: number): Promise<EarnRedemption>;

  // WebSocket
  getWebSocket?(): Promise<ExchangeWebSocket>;

  // Withdrawals
  withdraw?(coin: string, network: string, address: string, amount: number, tag?: string): Promise<WithdrawalResult>;
  getWithdrawalInfo?(coin: string, network?: string): Promise<WithdrawalInfo>;
}

// ============================================================================
// Extended Types (Optional Features)
// ============================================================================

export interface OCOOrderParams {
  symbol: string;
  side: OrderSide;
  quantity: number;
  price: number;
  stopPrice: number;
  stopLimitPrice?: number;
  stopLimitTimeInForce?: TimeInForce;
  /** Binance-family OCO list + leg client order IDs for idempotent repair. */
  listClientOrderId?: string;
  stopClientOrderId?: string;
  limitClientOrderId?: string;
}

export interface OCOOrder {
  orderListId: number;
  orders: Order[];
}

export interface EarnPosition {
  productId: string;
  productName: string;
  asset: string;
  amount: number;
  apy: number;
  canRedeem: boolean;
}

export interface EarnSubscription {
  purchaseId: number;
  success: boolean;
}

export interface EarnRedemption {
  redeemId: number;
  success: boolean;
}

export interface ExchangeWebSocket {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  subscribeTicker(symbol: string, callback: (data: Ticker24hr) => void): void;
  subscribeOrderBook(symbol: string, callback: (data: OrderBook) => void): void;
  unsubscribe(symbol: string): void;
}
