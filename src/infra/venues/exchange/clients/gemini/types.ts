/**
 * Gemini Exchange API Types
 * https://docs.gemini.com/rest-api/
 */

export interface GeminiSymbolDetails {
  symbol: string;
  base_currency: string;
  quote_currency: string;
  tick_size: number;
  quote_increment: number;
  min_order_size: string;
  status: "open" | "closed" | "cancel_only" | "post_only" | "limit_only";
  wrap_enabled: boolean;
  product_type: "spot" | "swap";
  contract_type?: string;
}

export interface GeminiTickerV2 {
  symbol: string;
  open: string;
  high: string;
  low: string;
  close: string;
  changes: string[]; // hourly change points
  bid: string;
  ask: string;
}

export interface GeminiPubTicker {
  bid: string;
  ask: string;
  last: string;
  volume: {
    [currency: string]: string | number;
    timestamp: number;
  };
}

export interface GeminiBookEntry {
  price: string;
  amount: string;
  timestamp?: string;
}

export interface GeminiOrderBook {
  bids: GeminiBookEntry[];
  asks: GeminiBookEntry[];
}

export interface GeminiBalance {
  type: string;
  currency: string;
  amount: string;
  available: string;
  availableForWithdrawal: string;
}

export interface GeminiOrder {
  order_id: string;
  client_order_id?: string;
  symbol: string;
  exchange: string;
  price: string;
  avg_execution_price: string;
  side: "buy" | "sell";
  type: string;
  timestamp: string;
  timestampms: number;
  is_live: boolean;
  is_cancelled: boolean;
  is_hidden: boolean;
  was_forced: boolean;
  executed_amount: string;
  remaining_amount: string;
  options: string[];
  price_source?: string;
  original_amount: string;
  reason?: string;
}

export interface GeminiNewOrderRequest {
  client_order_id?: string;
  symbol: string;
  amount: string;
  price: string;
  side: "buy" | "sell";
  type: "exchange limit" | "exchange stop limit";
  options?: ("maker-or-cancel" | "immediate-or-cancel" | "fill-or-kill")[];
  stop_price?: string;
}

export interface GeminiTrade {
  price: string;
  amount: string;
  timestamp: number;
  timestampms: number;
  type: "Buy" | "Sell";
  aggressor: boolean;
  fee_currency: string;
  fee_amount: string;
  tid: number;
  order_id: string;
  exchange: string;
  is_auction_fill: boolean;
  client_order_id?: string;
}

export interface GeminiErrorResponse {
  result: "error";
  reason: string;
  message: string;
}

/** Gemini candle tuple: [timestamp_ms, open, high, low, close, volume] */
export type GeminiCandle = [number, number, number, number, number, number];

export type GeminiTimeframe = "1m" | "5m" | "15m" | "30m" | "1hr" | "6hr" | "1day";
