/**
 * Exchange Abstraction Layer - Core Types
 * Defines the abstract Exchange interface for multi-exchange support
 */

import type { Candle } from "../../types/index.ts";

// ============================================================================
// Exchange Identification
// ============================================================================

/**
 * Supported exchange identifiers
 */
export type ExchangeId = "binance" | "binance_us" | "coinbase" | "kraken" | "bitfinex" | "hyperliquid" | "uniswap" | "robinhood" | "okx";

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
}

/**
 * Maps exchange type → environment variable names for credential storage.
 * Used by saveConfiguration to persist all exchange keys to .env,
 * and by resolveExchangeCredentials to restore them from process.env.
 */
export const EXCHANGE_ENV_MAP: Record<ExchangeId, { key?: string; secret?: string; passphrase?: string; wallet?: string }> = {
  binance:     { key: "BINANCE_API_KEY",     secret: "BINANCE_API_SECRET" },
  binance_us:  { key: "BINANCE_US_API_KEY",  secret: "BINANCE_US_API_SECRET" },
  coinbase:    { key: "COINBASE_API_KEY",     secret: "COINBASE_API_SECRET",   passphrase: "COINBASE_PASSPHRASE" },
  kraken:      { key: "KRAKEN_API_KEY",       secret: "KRAKEN_API_SECRET" },
  bitfinex:    { key: "BITFINEX_API_KEY",     secret: "BITFINEX_API_SECRET" },
  hyperliquid: { wallet: "HYPERLIQUID_PRIVATE_KEY" },
  uniswap:     { key: "UNISWAP_API_KEY" },
  robinhood:   { key: "ROBINHOOD_API_KEY",    secret: "ROBINHOOD_API_SECRET" },
  okx:         { key: "OKX_API_KEY",          secret: "OKX_API_SECRET",       passphrase: "OKX_PASSPHRASE" },
};

/**
 * Resolve exchange credentials, preferring process.env over config values.
 * Config may store "***" placeholders; this resolves them from env.
 */
export function resolveExchangeCredentials(
  config: { type: string; apiKey: string; apiSecret: string; passphrase?: string; walletPrivateKey?: string; sandbox?: boolean },
): ExchangeCredentials {
  const envMap = config.type in EXCHANGE_ENV_MAP
    ? EXCHANGE_ENV_MAP[config.type as ExchangeId]
    : undefined;
  const isRedacted = (v: string | undefined) => !v || v === "***";

  let apiKey = config.apiKey;
  let apiSecret = config.apiSecret;
  let passphrase = config.passphrase;
  let walletPrivateKey = config.walletPrivateKey;

  if (envMap) {
    if (isRedacted(apiKey) && envMap.key) apiKey = process.env[envMap.key] || "";
    if (isRedacted(apiSecret) && envMap.secret) apiSecret = process.env[envMap.secret] || "";
    if (isRedacted(passphrase) && envMap.passphrase) passphrase = process.env[envMap.passphrase] || undefined;
    if (isRedacted(walletPrivateKey) && envMap.wallet) walletPrivateKey = process.env[envMap.wallet] || undefined;
  }

  // Final fallback: clear any remaining redacted placeholders
  if (isRedacted(apiKey)) apiKey = "";
  if (isRedacted(apiSecret)) apiSecret = "";
  if (isRedacted(passphrase)) passphrase = undefined;
  if (isRedacted(walletPrivateKey)) walletPrivateKey = undefined;

  return { apiKey, apiSecret, passphrase, sandbox: config.sandbox, walletPrivateKey };
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
  getCandles(symbol: string, interval: string, limit?: number): Promise<Candle[]>;

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
