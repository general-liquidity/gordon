/**
 * Kraken API Types
 * Based on Kraken REST API documentation
 */

// ============================================================================
// API Response Types
// ============================================================================

export interface KrakenResponse<T> {
  error: string[];
  result?: T;
}

// ============================================================================
// Asset Types
// ============================================================================

export interface KrakenAssetInfo {
  aclass: string;
  altname: string;
  decimals: number;
  display_decimals: number;
  collateral_value?: number;
  status?: string;
}

export interface KrakenAssetPair {
  altname: string;
  wsname: string;
  aclass_base: string;
  base: string;
  aclass_quote: string;
  quote: string;
  lot: string;
  pair_decimals: number;
  lot_decimals: number;
  lot_multiplier: number;
  leverage_buy: number[];
  leverage_sell: number[];
  fees: Array<[number, number]>;
  fees_maker: Array<[number, number]>;
  fee_volume_currency: string;
  margin_call: number;
  margin_stop: number;
  ordermin: string;
  costmin: string;
  tick_size: string;
  status: string;
}

// ============================================================================
// Ticker Types
// ============================================================================

export interface KrakenTicker {
  a: [string, string, string]; // ask: [price, whole lot volume, lot volume]
  b: [string, string, string]; // bid: [price, whole lot volume, lot volume]
  c: [string, string]; // last trade closed: [price, lot volume]
  v: [string, string]; // volume: [today, last 24 hours]
  p: [string, string]; // volume weighted avg price: [today, last 24 hours]
  t: [number, number]; // number of trades: [today, last 24 hours]
  l: [string, string]; // low: [today, last 24 hours]
  h: [string, string]; // high: [today, last 24 hours]
  o: string; // today's opening price
}

// ============================================================================
// OHLC Types
// ============================================================================

// Kraken OHLC: [time, open, high, low, close, vwap, volume, count]
export type KrakenOHLC = [number, string, string, string, string, string, string, number];

export interface KrakenOHLCResponse {
  [pair: string]: KrakenOHLC[] | number;
  last: number;
}

// ============================================================================
// Order Book Types
// ============================================================================

export interface KrakenOrderBook {
  asks: Array<[string, string, number]>; // [price, volume, timestamp]
  bids: Array<[string, string, number]>; // [price, volume, timestamp]
}

// ============================================================================
// Account Types
// ============================================================================

export interface KrakenBalance {
  [asset: string]: string;
}

export interface KrakenExtendedBalance {
  balance: string;
  credit?: string;
  credit_used?: string;
  hold_trade: string;
}

export interface KrakenTradeBalance {
  eb: string; // equivalent balance (combined balance of all currencies)
  tb: string; // trade balance (combined balance of all equity currencies)
  m: string; // margin amount of open positions
  n: string; // unrealized net profit/loss of open positions
  c: string; // cost basis of open positions
  v: string; // current floating valuation of open positions
  e: string; // equity = trade balance + unrealized net profit/loss
  mf: string; // free margin = equity - initial margin
  ml?: string; // margin level = (equity / initial margin) * 100
}

// ============================================================================
// Order Types
// ============================================================================

export type KrakenOrderType =
  | "market"
  | "limit"
  | "stop-loss"
  | "take-profit"
  | "stop-loss-limit"
  | "take-profit-limit"
  | "settle-position";

export type KrakenOrderSide = "buy" | "sell";

export type KrakenOrderStatus =
  | "pending"
  | "open"
  | "closed"
  | "canceled"
  | "expired";

export interface KrakenOrderDescription {
  pair: string;
  type: KrakenOrderSide;
  ordertype: KrakenOrderType;
  price: string;
  price2: string;
  leverage: string;
  order: string;
  close: string;
}

export interface KrakenOrder {
  refid?: string;
  userref?: number;
  status: KrakenOrderStatus;
  opentm: number;
  starttm: number;
  expiretm: number;
  descr: KrakenOrderDescription;
  vol: string;
  vol_exec: string;
  cost: string;
  fee: string;
  price: string;
  stopprice: string;
  limitprice: string;
  misc: string;
  oflags: string;
  trigger?: string;
  closetm?: number;
  reason?: string;
  trades?: string[];
}

export interface KrakenAddOrderResponse {
  descr: {
    order: string;
    close?: string;
  };
  txid: string[];
}

export interface KrakenCancelOrderResponse {
  count: number;
  pending?: boolean;
}

// ============================================================================
// Trade Types
// ============================================================================

export interface KrakenTrade {
  ordertxid: string;
  postxid: string;
  pair: string;
  time: number;
  type: KrakenOrderSide;
  ordertype: KrakenOrderType;
  price: string;
  cost: string;
  fee: string;
  vol: string;
  margin: string;
  misc: string;
  trade_id?: number;
}

// ============================================================================
// Ledger Types
// ============================================================================

export interface KrakenLedgerEntry {
  refid: string;
  time: number;
  type: string;
  subtype: string;
  aclass: string;
  asset: string;
  amount: string;
  fee: string;
  balance: string;
}

// ============================================================================
// Deposit/Withdrawal Types
// ============================================================================

export interface KrakenDepositMethod {
  method: string;
  limit: string | boolean;
  fee: string;
  "address-setup-fee"?: string;
  "gen-address": boolean;
}

export interface KrakenDepositAddress {
  address: string;
  expiretm: string;
  new: boolean;
  tag?: string;
  memo?: string;
}

export interface KrakenDepositStatus {
  method: string;
  aclass: string;
  asset: string;
  refid: string;
  txid: string;
  info: string;
  amount: string;
  fee: string;
  time: number;
  status: string;
  "status-prop"?: string;
}

export interface KrakenWithdrawInfo {
  method: string;
  limit: string;
  amount: string;
  fee: string;
}

export interface KrakenWithdrawStatus {
  method: string;
  aclass: string;
  asset: string;
  refid: string;
  txid: string;
  info: string;
  amount: string;
  fee: string;
  time: number;
  status: string;
  "status-prop"?: string;
}

// ============================================================================
// System Types
// ============================================================================

export interface KrakenSystemStatus {
  status: "online" | "maintenance" | "cancel_only" | "post_only";
  timestamp: string;
}

export interface KrakenServerTime {
  unixtime: number;
  rfc1123: string;
}
