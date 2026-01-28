/**
 * Binance API response types
 */

// Balance information for a single asset
export interface BinanceBalance {
  asset: string;
  free: string;
  locked: string;
}

// Account information response from Binance
export interface BinanceAccountInfo {
  makerCommission: number;
  takerCommission: number;
  buyerCommission: number;
  sellerCommission: number;
  commissionRates: {
    maker: string;
    taker: string;
    buyer: string;
    seller: string;
  };
  canTrade: boolean;
  canWithdraw: boolean;
  canDeposit: boolean;
  brokered: boolean;
  requireSelfTradePrevention: boolean;
  preventSor: boolean;
  updateTime: number;
  accountType: string;
  balances: BinanceBalance[];
  permissions: string[];
  uid: number;
}

// Kline/Candlestick data from Binance
// Array format: [openTime, open, high, low, close, volume, closeTime, quoteVolume, trades, takerBuyBase, takerBuyQuote, ignore]
export type BinanceKline = [
  number, // 0: Open time
  string, // 1: Open price
  string, // 2: High price
  string, // 3: Low price
  string, // 4: Close price
  string, // 5: Volume
  number, // 6: Close time
  string, // 7: Quote asset volume
  number, // 8: Number of trades
  string, // 9: Taker buy base asset volume
  string, // 10: Taker buy quote asset volume
  string  // 11: Ignore
];

// Order side
export type OrderSide = "BUY" | "SELL";

// Order type
export type OrderType =
  | "LIMIT"
  | "MARKET"
  | "STOP_LOSS"
  | "STOP_LOSS_LIMIT"
  | "TAKE_PROFIT"
  | "TAKE_PROFIT_LIMIT"
  | "LIMIT_MAKER";

// Order status
export type OrderStatus =
  | "NEW"
  | "PARTIALLY_FILLED"
  | "FILLED"
  | "CANCELED"
  | "PENDING_CANCEL"
  | "REJECTED"
  | "EXPIRED"
  | "EXPIRED_IN_MATCH";

// Time in force
export type TimeInForce = "GTC" | "IOC" | "FOK";

// Order response from Binance
export interface BinanceOrder {
  symbol: string;
  orderId: number;
  orderListId: number;
  clientOrderId: string;
  transactTime?: number;
  price: string;
  origQty: string;
  executedQty: string;
  cummulativeQuoteQty: string;
  status: OrderStatus;
  timeInForce: TimeInForce;
  type: OrderType;
  side: OrderSide;
  stopPrice?: string;
  icebergQty?: string;
  time?: number;
  updateTime?: number;
  isWorking?: boolean;
  workingTime?: number;
  origQuoteOrderQty?: string;
  selfTradePreventionMode?: string;
}

// Symbol info from exchange info
export interface BinanceSymbolInfo {
  symbol: string;
  status: string;
  baseAsset: string;
  baseAssetPrecision: number;
  quoteAsset: string;
  quotePrecision: number;
  quoteAssetPrecision: number;
  orderTypes: OrderType[];
  icebergAllowed: boolean;
  ocoAllowed: boolean;
  quoteOrderQtyMarketAllowed: boolean;
  allowTrailingStop: boolean;
  cancelReplaceAllowed: boolean;
  isSpotTradingAllowed: boolean;
  isMarginTradingAllowed: boolean;
  filters: SymbolFilter[];
  permissions: string[];
  defaultSelfTradePreventionMode: string;
  allowedSelfTradePreventionModes: string[];
}

// Symbol filter types
export type SymbolFilter =
  | PriceFilter
  | LotSizeFilter
  | MinNotionalFilter
  | GenericFilter;

export interface PriceFilter {
  filterType: "PRICE_FILTER";
  minPrice: string;
  maxPrice: string;
  tickSize: string;
}

export interface LotSizeFilter {
  filterType: "LOT_SIZE";
  minQty: string;
  maxQty: string;
  stepSize: string;
}

export interface MinNotionalFilter {
  filterType: "MIN_NOTIONAL" | "NOTIONAL";
  minNotional?: string;
  notional?: string;
  applyMinToMarket?: boolean;
  applyMaxToMarket?: boolean;
  avgPriceMins?: number;
}

export interface GenericFilter {
  filterType: string;
  [key: string]: string | number | boolean | undefined;
}

// Binance API error response
export interface BinanceAPIError {
  code: number;
  msg: string;
}

// Ticker 24hr data for volume ranking
export interface BinanceTicker24hr {
  symbol: string;
  priceChange: string;
  priceChangePercent: string;
  weightedAvgPrice: string;
  prevClosePrice: string;
  lastPrice: string;
  lastQty: string;
  bidPrice: string;
  bidQty: string;
  askPrice: string;
  askQty: string;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  quoteVolume: string;
  openTime: number;
  closeTime: number;
  firstId: number;
  lastId: number;
  count: number;
}

// Price ticker
export interface BinancePriceTicker {
  symbol: string;
  price: string;
}

// Order parameters for placing orders
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

// Exchange permissions type
export interface ExchangePermissions {
  read: boolean;
  spotTrade: boolean;
  withdraw: boolean;
}
