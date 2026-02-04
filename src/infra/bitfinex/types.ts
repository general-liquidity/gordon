/**
 * Bitfinex API Types
 * Based on Bitfinex REST API v2 documentation
 */

// ============================================================================
// API Response Types
// ============================================================================

export interface BitfinexAPIError {
  error: string;
  code?: number;
  message?: string;
}

// ============================================================================
// Ticker Types
// ============================================================================

/**
 * Bitfinex ticker array format:
 * [BID, BID_SIZE, ASK, ASK_SIZE, DAILY_CHANGE, DAILY_CHANGE_RELATIVE, LAST_PRICE, VOLUME, HIGH, LOW]
 */
export type BitfinexTicker = [
  number, // BID
  number, // BID_SIZE
  number, // ASK
  number, // ASK_SIZE
  number, // DAILY_CHANGE
  number, // DAILY_CHANGE_RELATIVE (percentage as decimal)
  number, // LAST_PRICE
  number, // VOLUME
  number, // HIGH
  number, // LOW
];

export interface BitfinexTickerParsed {
  symbol: string;
  bid: number;
  bidSize: number;
  ask: number;
  askSize: number;
  dailyChange: number;
  dailyChangePercent: number;
  lastPrice: number;
  volume: number;
  high: number;
  low: number;
}

// ============================================================================
// Candle Types
// ============================================================================

/**
 * Bitfinex candle array format:
 * [MTS, OPEN, CLOSE, HIGH, LOW, VOLUME]
 */
export type BitfinexCandle = [
  number, // MTS (timestamp)
  number, // OPEN
  number, // CLOSE
  number, // HIGH
  number, // LOW
  number, // VOLUME
];

// ============================================================================
// Order Book Types
// ============================================================================

/**
 * Bitfinex order book entry:
 * [PRICE, COUNT, AMOUNT]
 * AMOUNT > 0 = bid, AMOUNT < 0 = ask
 */
export type BitfinexOrderBookEntry = [
  number, // PRICE
  number, // COUNT
  number, // AMOUNT
];

export interface BitfinexOrderBookParsed {
  bids: Array<{ price: number; count: number; amount: number }>;
  asks: Array<{ price: number; count: number; amount: number }>;
}

// ============================================================================
// Trade Types
// ============================================================================

/**
 * Bitfinex public trade:
 * [ID, MTS, AMOUNT, PRICE]
 */
export type BitfinexPublicTrade = [
  number, // ID
  number, // MTS
  number, // AMOUNT (positive = buy, negative = sell)
  number, // PRICE
];

// ============================================================================
// Wallet Types
// ============================================================================

/**
 * Bitfinex wallet:
 * [WALLET_TYPE, CURRENCY, BALANCE, UNSETTLED_INTEREST, AVAILABLE_BALANCE, LAST_CHANGE, TRADE_DETAILS]
 */
export type BitfinexWallet = [
  string, // WALLET_TYPE: 'exchange', 'margin', 'funding'
  string, // CURRENCY
  number, // BALANCE
  number | null, // UNSETTLED_INTEREST
  number | null, // AVAILABLE_BALANCE
  string | null, // LAST_CHANGE (description)
  Record<string, unknown> | null, // TRADE_DETAILS
];

export interface BitfinexWalletParsed {
  walletType: string;
  currency: string;
  balance: number;
  unsettledInterest: number;
  availableBalance: number;
}

// ============================================================================
// Order Types
// ============================================================================

export type BitfinexOrderType =
  | "LIMIT"
  | "EXCHANGE LIMIT"
  | "MARKET"
  | "EXCHANGE MARKET"
  | "STOP"
  | "EXCHANGE STOP"
  | "STOP LIMIT"
  | "EXCHANGE STOP LIMIT"
  | "TRAILING STOP"
  | "EXCHANGE TRAILING STOP"
  | "FOK"
  | "EXCHANGE FOK"
  | "IOC"
  | "EXCHANGE IOC";

export type BitfinexOrderStatus =
  | "ACTIVE"
  | "EXECUTED"
  | "PARTIALLY FILLED"
  | "CANCELED"
  | "RSN_DUST"
  | "RSN_PAUSE";

/**
 * Bitfinex order array format (full):
 * [ID, GID, CID, SYMBOL, MTS_CREATE, MTS_UPDATE, AMOUNT, AMOUNT_ORIG, TYPE, TYPE_PREV,
 *  MTS_TIF, _PLACEHOLDER, FLAGS, STATUS, _PLACEHOLDER, _PLACEHOLDER, PRICE, PRICE_AVG,
 *  PRICE_TRAILING, PRICE_AUX_LIMIT, _PLACEHOLDER, _PLACEHOLDER, _PLACEHOLDER, NOTIFY,
 *  HIDDEN, PLACED_ID, _PLACEHOLDER, _PLACEHOLDER, ROUTING, _PLACEHOLDER, _PLACEHOLDER, META]
 */
export type BitfinexOrder = [
  number, // ID
  number | null, // GID (group ID)
  number, // CID (client order ID)
  string, // SYMBOL
  number, // MTS_CREATE
  number, // MTS_UPDATE
  number, // AMOUNT (remaining)
  number, // AMOUNT_ORIG
  string, // TYPE
  string | null, // TYPE_PREV
  number | null, // MTS_TIF (time in force)
  null, // PLACEHOLDER
  number, // FLAGS
  string, // STATUS
  null, // PLACEHOLDER
  null, // PLACEHOLDER
  number, // PRICE
  number, // PRICE_AVG
  number, // PRICE_TRAILING
  number, // PRICE_AUX_LIMIT
  null, // PLACEHOLDER
  null, // PLACEHOLDER
  null, // PLACEHOLDER
  number, // NOTIFY
  number, // HIDDEN
  number | null, // PLACED_ID
  null, // PLACEHOLDER
  null, // PLACEHOLDER
  string | null, // ROUTING
  null, // PLACEHOLDER
  null, // PLACEHOLDER
  Record<string, unknown> | null, // META
];

export interface BitfinexOrderParsed {
  id: number;
  groupId: number | null;
  clientOrderId: number;
  symbol: string;
  createdAt: number;
  updatedAt: number;
  amount: number;
  amountOrig: number;
  type: string;
  status: string;
  price: number;
  priceAvg: number;
  priceTrailing: number;
  priceAuxLimit: number;
  hidden: boolean;
}

// ============================================================================
// Trade/Fill Types
// ============================================================================

/**
 * Bitfinex user trade:
 * [ID, SYMBOL, MTS_CREATE, ORDER_ID, EXEC_AMOUNT, EXEC_PRICE, ORDER_TYPE, ORDER_PRICE,
 *  MAKER, FEE, FEE_CURRENCY, CID]
 */
export type BitfinexUserTrade = [
  number, // ID
  string, // SYMBOL
  number, // MTS_CREATE
  number, // ORDER_ID
  number, // EXEC_AMOUNT
  number, // EXEC_PRICE
  string | null, // ORDER_TYPE
  number | null, // ORDER_PRICE
  number, // MAKER (1 = maker, 0/-1 = taker)
  number, // FEE
  string, // FEE_CURRENCY
  number | null, // CID (client order ID)
];

export interface BitfinexUserTradeParsed {
  id: number;
  symbol: string;
  timestamp: number;
  orderId: number;
  amount: number;
  price: number;
  orderType: string | null;
  orderPrice: number | null;
  isMaker: boolean;
  fee: number;
  feeCurrency: string;
  clientOrderId: number | null;
}

// ============================================================================
// Movement (Deposit/Withdrawal) Types
// ============================================================================

/**
 * Bitfinex movement:
 * [ID, CURRENCY, CURRENCY_NAME, null, null, MTS_STARTED, MTS_UPDATED, null, null,
 *  STATUS, null, null, AMOUNT, FEES, null, null, DESTINATION_ADDRESS, null, null, null,
 *  TRANSACTION_ID, WITHDRAW_TRANSACTION_NOTE]
 */
export type BitfinexMovement = [
  number, // ID
  string, // CURRENCY
  string, // CURRENCY_NAME
  null,
  null,
  number, // MTS_STARTED
  number, // MTS_UPDATED
  null,
  null,
  string, // STATUS
  null,
  null,
  number, // AMOUNT
  number, // FEES
  null,
  null,
  string | null, // DESTINATION_ADDRESS
  null,
  null,
  null,
  string | null, // TRANSACTION_ID
  string | null, // WITHDRAW_TRANSACTION_NOTE
];

export interface BitfinexMovementParsed {
  id: number;
  currency: string;
  currencyName: string;
  startedAt: number;
  updatedAt: number;
  status: string;
  amount: number;
  fees: number;
  address: string | null;
  transactionId: string | null;
  note: string | null;
}

// ============================================================================
// Symbol Info Types
// ============================================================================

export interface BitfinexSymbolDetails {
  pair: string;
  price_precision: number;
  initial_margin: string;
  minimum_margin: string;
  maximum_order_size: string;
  minimum_order_size: string;
  expiration: string;
  margin: boolean;
}

// ============================================================================
// Order Params (for adapter)
// ============================================================================

export interface BitfinexOrderParams {
  symbol: string;
  amount: number; // Positive for buy, negative for sell
  price?: number;
  type: BitfinexOrderType;
  flags?: number;
  clientOrderId?: number;
  priceTrailing?: number;
  priceAuxLimit?: number;
}

// ============================================================================
// New Order Response
// ============================================================================

/**
 * Response from submit order endpoint
 * [MTS, TYPE, MESSAGE_ID, null, [ORDER], CODE, STATUS, TEXT]
 */
export type BitfinexOrderResponse = [
  number, // MTS
  string, // TYPE ('on', 'ou', 'oc', etc.)
  number | null, // MESSAGE_ID
  null,
  BitfinexOrder | null, // ORDER
  number | null, // CODE (error code if failed)
  string, // STATUS ('SUCCESS', 'ERROR', etc.)
  string, // TEXT
];
