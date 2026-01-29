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

// Trade history response
export interface BinanceTrade {
  symbol: string;
  id: number;
  orderId: number;
  orderListId: number;
  price: string;
  qty: string;
  quoteQty: string;
  commission: string;
  commissionAsset: string;
  time: number;
  isBuyer: boolean;
  isMaker: boolean;
  isBestMatch: boolean;
}

// Deposit history response
export interface BinanceDeposit {
  id: string;
  amount: string;
  coin: string;
  network: string;
  status: number; // 0:pending, 6:credited, 1:success
  address: string;
  txId: string;
  insertTime: number;
  confirmTimes: string;
  unlockConfirm: number;
}

// Withdrawal history response
export interface BinanceWithdrawal {
  id: string;
  amount: string;
  transactionFee: string;
  coin: string;
  status: number; // 0:Email Sent, 1:Cancelled, 2:Awaiting Approval, 3:Rejected, 4:Processing, 5:Failure, 6:Completed
  address: string;
  txId: string;
  applyTime: string;
  network: string;
  completeTime?: string;
}

// Earn positions response
export interface BinanceEarnPosition {
  asset: string;
  totalAmount: string;
  freeAmount: string;
  lockedAmount: string;
  rewardAsset: string;
  apy: string;
  productId: string;
  productName: string;
}

// API restrictions response
export interface BinanceAPIRestrictions {
  ipRestrict: boolean;
  createTime: number;
  enableWithdrawals: boolean;
  enableInternalTransfer: boolean;
  permitsUniversalTransfer: boolean;
  enableVanillaOptions: boolean;
  enableReading: boolean;
  enableFutures: boolean;
  enableMargin: boolean;
  enableSpotAndMarginTrading: boolean;
  tradingAuthorityExpirationTime?: number;
}

// ============================================================================
// Market Data Types
// ============================================================================

// Order book depth entry
export interface OrderBookEntry {
  price: string;
  quantity: string;
}

// Order book response
export interface BinanceOrderBook {
  lastUpdateId: number;
  bids: [string, string][]; // [price, quantity]
  asks: [string, string][]; // [price, quantity]
}

// Recent trade
export interface BinanceRecentTrade {
  id: number;
  price: string;
  qty: string;
  quoteQty: string;
  time: number;
  isBuyerMaker: boolean;
  isBestMatch: boolean;
}

// Aggregate trade
export interface BinanceAggTrade {
  a: number; // Aggregate trade ID
  p: string; // Price
  q: string; // Quantity
  f: number; // First trade ID
  l: number; // Last trade ID
  T: number; // Timestamp
  m: boolean; // Was the buyer the maker?
  M: boolean; // Was the trade the best price match?
}

// Average price
export interface BinanceAvgPrice {
  mins: number;
  price: string;
  closeTime: number;
}

// Book ticker (best bid/ask)
export interface BinanceBookTicker {
  symbol: string;
  bidPrice: string;
  bidQty: string;
  askPrice: string;
  askQty: string;
}

// ============================================================================
// Trading Types
// ============================================================================

// OCO order parameters
export interface OCOOrderParams {
  symbol: string;
  side: OrderSide;
  quantity: number;
  price: number; // Limit price
  stopPrice: number; // Stop trigger price
  stopLimitPrice?: number; // Stop limit price (if using STOP_LOSS_LIMIT)
  stopLimitTimeInForce?: TimeInForce;
  listClientOrderId?: string;
  limitClientOrderId?: string;
  stopClientOrderId?: string;
}

// OCO order response
export interface BinanceOCOOrder {
  orderListId: number;
  contingencyType: string;
  listStatusType: string;
  listOrderStatus: string;
  listClientOrderId: string;
  transactionTime: number;
  symbol: string;
  orders: Array<{
    symbol: string;
    orderId: number;
    clientOrderId: string;
  }>;
  orderReports: BinanceOrder[];
}

// Order list (for OCO, OTO, etc.)
export interface BinanceOrderList {
  orderListId: number;
  contingencyType: string;
  listStatusType: string;
  listOrderStatus: string;
  listClientOrderId: string;
  transactionTime: number;
  symbol: string;
  orders: Array<{
    symbol: string;
    orderId: number;
    clientOrderId: string;
  }>;
}

// Cancel replace response
export interface BinanceCancelReplaceResult {
  cancelResult: string;
  newOrderResult: string;
  cancelResponse?: BinanceOrder;
  newOrderResponse?: BinanceOrder;
}

// ============================================================================
// Wallet Types
// ============================================================================

// Coin info (networks, fees)
export interface BinanceCoinInfo {
  coin: string;
  depositAllEnable: boolean;
  free: string;
  freeze: string;
  ipoable: string;
  ipoing: string;
  isLegalMoney: boolean;
  locked: string;
  name: string;
  networkList: BinanceNetwork[];
  storage: string;
  trading: boolean;
  withdrawAllEnable: boolean;
  withdrawing: string;
}

export interface BinanceNetwork {
  addressRegex: string;
  coin: string;
  depositDesc?: string;
  depositEnable: boolean;
  isDefault: boolean;
  memoRegex: string;
  minConfirm: number;
  name: string;
  network: string;
  resetAddressStatus: boolean;
  specialTips?: string;
  unLockConfirm: number;
  withdrawDesc?: string;
  withdrawEnable: boolean;
  withdrawFee: string;
  withdrawIntegerMultiple: string;
  withdrawMax: string;
  withdrawMin: string;
  sameAddress: boolean;
  estimatedArrivalTime: number;
  busy: boolean;
}

// Account snapshot
export interface BinanceAccountSnapshot {
  code: number;
  msg: string;
  snapshotVos: Array<{
    data: {
      balances: BinanceBalance[];
      totalAssetOfBtc: string;
    };
    type: string;
    updateTime: number;
  }>;
}

// Universal transfer types
export type TransferType =
  | "MAIN_FUNDING" | "FUNDING_MAIN"
  | "MAIN_UMFUTURE" | "UMFUTURE_MAIN"
  | "MAIN_CMFUTURE" | "CMFUTURE_MAIN"
  | "MAIN_MARGIN" | "MARGIN_MAIN"
  | "FUNDING_UMFUTURE" | "UMFUTURE_FUNDING"
  | "FUNDING_CMFUTURE" | "CMFUTURE_FUNDING"
  | "MARGIN_FUNDING" | "FUNDING_MARGIN";

// Transfer response
export interface BinanceTransferResponse {
  tranId: number;
}

// Transfer history entry
export interface BinanceTransferHistory {
  asset: string;
  amount: string;
  type: TransferType;
  status: string;
  tranId: number;
  timestamp: number;
}

// Dust transfer response
export interface BinanceDustTransfer {
  totalServiceCharge: string;
  totalTransfered: string;
  transferResult: Array<{
    amount: string;
    fromAsset: string;
    operateTime: number;
    serviceChargeAmount: string;
    tranId: number;
    transferedAmount: string;
  }>;
}

// Dust log entry
export interface BinanceDustLog {
  total: number;
  userAssetDribblets: Array<{
    operateTime: number;
    totalTransferedAmount: string;
    totalServiceChargeAmount: string;
    transId: number;
    userAssetDribbletDetails: Array<{
      transId: number;
      serviceChargeAmount: string;
      amount: string;
      operateTime: number;
      transferedAmount: string;
      fromAsset: string;
    }>;
  }>;
}

// Asset dividend record
export interface BinanceAssetDividend {
  id: number;
  amount: string;
  asset: string;
  divTime: number;
  enInfo: string;
  tranId: number;
}

// Asset detail
export interface BinanceAssetDetail {
  [asset: string]: {
    minWithdrawAmount: string;
    depositStatus: boolean;
    withdrawFee: number;
    withdrawStatus: boolean;
    depositTip?: string;
  };
}

// Trade fee
export interface BinanceTradeFee {
  symbol: string;
  makerCommission: string;
  takerCommission: string;
}

// User asset
export interface BinanceUserAsset {
  asset: string;
  free: string;
  locked: string;
  freeze: string;
  withdrawing: string;
  ipoable: string;
  btcValuation: string;
}

// Deposit address
export interface BinanceDepositAddress {
  address: string;
  coin: string;
  tag: string;
  url: string;
}

// Dustable assets (can convert to BNB)
export interface BinanceDustableAsset {
  asset: string;
  assetFullName: string;
  amountFree: string;
  toBTC: string;
  toBNB: string;
  toBNBOffExchange: string;
  exchange: string;
}

// Wallet balance
export interface BinanceWalletBalance {
  activate: boolean;
  balance: string;
  walletName: string;
}

// ============================================================================
// Simple Earn Types
// ============================================================================

// Flexible product
export interface BinanceFlexibleProduct {
  asset: string;
  latestAnnualPercentageRate: string;
  tierAnnualPercentageRate: Record<string, string>;
  airDropPercentageRate: string;
  canPurchase: boolean;
  canRedeem: boolean;
  isSoldOut: boolean;
  hot: boolean;
  minPurchaseAmount: string;
  productId: string;
  subscriptionStartTime: number;
  status: string;
}

// Locked product
export interface BinanceLockedProduct {
  projectId: string;
  detail: {
    asset: string;
    rewardAsset: string;
    duration: number;
    renewable: boolean;
    isSoldOut: boolean;
    apr: string;
    status: string;
    subscriptionStartTime: string;
    extraRewardAsset: string;
    extraRewardAPR: string;
  };
  quota: {
    totalPersonalQuota: string;
    minimum: string;
  };
}

// Locked position
export interface BinanceLockedPosition {
  positionId: string;
  projectId: string;
  asset: string;
  amount: string;
  purchaseTime: number;
  duration: number;
  accrualDays: number;
  rewardAsset: string;
  APY: string;
  isRenewable: boolean;
  isAutoRenew: boolean;
  redeemDate: string;
}

// Earn subscription response
export interface BinanceEarnSubscription {
  purchaseId: number;
  success: boolean;
}

// Earn redemption response
export interface BinanceEarnRedemption {
  redeemId: number;
  success: boolean;
}

// Earn subscription record
export interface BinanceEarnSubscriptionRecord {
  amount: string;
  asset: string;
  time: number;
  purchaseId: number;
  type: string;
  sourceAccount: string;
  amtFromSpot: string;
  amtFromFunding: string;
  status: string;
}

// Earn redemption record
export interface BinanceEarnRedemptionRecord {
  amount: string;
  asset: string;
  time: number;
  projectId: string;
  redeemId: number;
  destAccount: string;
  status: string;
}
