/**
 * Coinbase Advanced Trade API Types
 * Based on Coinbase Advanced Trade API documentation
 */

// ============================================================================
// API Response Types
// ============================================================================

export interface CoinbaseAPIError {
  error: string;
  message: string;
  error_details?: string;
  preview_failure_reason?: string;
}

// ============================================================================
// Account Types
// ============================================================================

export interface CoinbaseAccount {
  uuid: string;
  name: string;
  currency: string;
  available_balance: {
    value: string;
    currency: string;
  };
  default: boolean;
  active: boolean;
  created_at: string;
  updated_at: string;
  type: "ACCOUNT_TYPE_CRYPTO" | "ACCOUNT_TYPE_FIAT";
  ready: boolean;
  hold: {
    value: string;
    currency: string;
  };
}

export interface CoinbaseAccountsResponse {
  accounts: CoinbaseAccount[];
  has_next: boolean;
  cursor: string;
  size: number;
}

// ============================================================================
// Product Types
// ============================================================================

export interface CoinbaseProduct {
  product_id: string;
  price: string;
  price_percentage_change_24h: string;
  volume_24h: string;
  volume_percentage_change_24h: string;
  base_increment: string;
  quote_increment: string;
  quote_min_size: string;
  quote_max_size: string;
  base_min_size: string;
  base_max_size: string;
  base_name: string;
  quote_name: string;
  watched: boolean;
  is_disabled: boolean;
  new: boolean;
  status: string;
  cancel_only: boolean;
  limit_only: boolean;
  post_only: boolean;
  trading_disabled: boolean;
  auction_mode: boolean;
  product_type: string;
  quote_currency_id: string;
  base_currency_id: string;
  fcm_trading_session_details?: {
    is_session_open: boolean;
    open_time: string;
    close_time: string;
  };
  mid_market_price: string;
  alias: string;
  alias_to: string[];
  base_display_symbol: string;
  quote_display_symbol: string;
  view_only: boolean;
  price_increment: string;
  display_name: string;
}

export interface CoinbaseProductsResponse {
  products: CoinbaseProduct[];
  num_products: number;
}

export interface CoinbaseProductBook {
  pricebook: {
    product_id: string;
    bids: Array<{ price: string; size: string }>;
    asks: Array<{ price: string; size: string }>;
    time: string;
  };
}

// ============================================================================
// Candle Types
// ============================================================================

export interface CoinbaseCandle {
  start: string; // Unix timestamp
  low: string;
  high: string;
  open: string;
  close: string;
  volume: string;
}

export interface CoinbaseCandlesResponse {
  candles: CoinbaseCandle[];
}

// ============================================================================
// Ticker Types
// ============================================================================

export interface CoinbaseTicker {
  trades: Array<{
    trade_id: string;
    product_id: string;
    price: string;
    size: string;
    time: string;
    side: "BUY" | "SELL";
    bid: string;
    ask: string;
  }>;
  best_bid: string;
  best_ask: string;
}

// ============================================================================
// Order Types
// ============================================================================

export type CoinbaseOrderSide = "BUY" | "SELL";

export type CoinbaseOrderType =
  | "MARKET"
  | "LIMIT"
  | "STOP"
  | "STOP_LIMIT"
  | "BRACKET";

export type CoinbaseOrderStatus =
  | "PENDING"
  | "OPEN"
  | "FILLED"
  | "CANCELLED"
  | "EXPIRED"
  | "FAILED";

export type CoinbaseTimeInForce = "GTC" | "GTD" | "IOC" | "FOK";

export interface CoinbaseOrderConfiguration {
  market_market_ioc?: {
    quote_size?: string;
    base_size?: string;
  };
  sor_limit_ioc?: {
    base_size: string;
    limit_price: string;
  };
  limit_limit_gtc?: {
    base_size: string;
    limit_price: string;
    post_only: boolean;
  };
  limit_limit_gtd?: {
    base_size: string;
    limit_price: string;
    end_time: string;
    post_only: boolean;
  };
  limit_limit_fok?: {
    base_size: string;
    limit_price: string;
  };
  stop_limit_stop_limit_gtc?: {
    base_size: string;
    limit_price: string;
    stop_price: string;
    stop_direction: "STOP_DIRECTION_STOP_UP" | "STOP_DIRECTION_STOP_DOWN";
  };
  stop_limit_stop_limit_gtd?: {
    base_size: string;
    limit_price: string;
    stop_price: string;
    end_time: string;
    stop_direction: "STOP_DIRECTION_STOP_UP" | "STOP_DIRECTION_STOP_DOWN";
  };
  trigger_bracket_gtc?: {
    base_size: string;
    limit_price: string;
    stop_trigger_price: string;
  };
  trigger_bracket_gtd?: {
    base_size: string;
    limit_price: string;
    stop_trigger_price: string;
    end_time: string;
  };
}

export interface CoinbaseOrder {
  order_id: string;
  product_id: string;
  user_id: string;
  order_configuration: CoinbaseOrderConfiguration;
  side: CoinbaseOrderSide;
  client_order_id: string;
  status: CoinbaseOrderStatus;
  time_in_force: CoinbaseTimeInForce;
  created_time: string;
  completion_percentage: string;
  filled_size: string;
  average_filled_price: string;
  fee: string;
  number_of_fills: string;
  filled_value: string;
  pending_cancel: boolean;
  size_in_quote: boolean;
  total_fees: string;
  size_inclusive_of_fees: boolean;
  total_value_after_fees: string;
  trigger_status?: string;
  order_type: CoinbaseOrderType;
  reject_reason?: string;
  settled: boolean;
  product_type: string;
  reject_message?: string;
  cancel_message?: string;
  order_placement_source?: string;
  outstanding_hold_amount?: string;
  is_liquidation?: boolean;
  last_fill_time?: string;
  edit_history?: Array<{
    price?: string;
    size?: string;
    replace_accept_timestamp?: string;
  }>;
  leverage?: string;
  margin_type?: string;
  retail_portfolio_id?: string;
}

export interface CoinbaseCreateOrderRequest {
  client_order_id: string;
  product_id: string;
  side: CoinbaseOrderSide;
  order_configuration: CoinbaseOrderConfiguration;
  leverage?: string;
  margin_type?: string;
  retail_portfolio_id?: string;
}

export interface CoinbaseCreateOrderResponse {
  success: boolean;
  failure_reason?: string;
  order_id: string;
  success_response?: {
    order_id: string;
    product_id: string;
    side: CoinbaseOrderSide;
    client_order_id: string;
  };
  error_response?: {
    error: string;
    message: string;
    error_details: string;
    preview_failure_reason: string;
  };
}

export interface CoinbaseOrdersResponse {
  orders: CoinbaseOrder[];
  sequence: string;
  has_next: boolean;
  cursor: string;
}

export interface CoinbaseCancelOrdersResponse {
  results: Array<{
    success: boolean;
    failure_reason?: string;
    order_id: string;
  }>;
}

// ============================================================================
// Fill/Trade Types
// ============================================================================

export interface CoinbaseFill {
  entry_id: string;
  trade_id: string;
  order_id: string;
  trade_time: string;
  trade_type: string;
  price: string;
  size: string;
  commission: string;
  product_id: string;
  sequence_timestamp: string;
  liquidity_indicator: string;
  size_in_quote: boolean;
  user_id: string;
  side: CoinbaseOrderSide;
  retail_portfolio_id?: string;
}

export interface CoinbaseFillsResponse {
  fills: CoinbaseFill[];
  cursor: string;
}

// ============================================================================
// Transaction Types
// ============================================================================

export interface CoinbaseTransaction {
  id: string;
  type: string;
  status: string;
  amount: {
    amount: string;
    currency: string;
  };
  native_amount: {
    amount: string;
    currency: string;
  };
  description?: string;
  created_at: string;
  updated_at: string;
  resource: string;
  resource_path: string;
  network?: {
    status: string;
    hash?: string;
    transaction_url?: string;
    confirmations?: number;
  };
  to?: {
    resource: string;
    address?: string;
  };
  from?: {
    resource: string;
    address?: string;
  };
  details?: {
    title: string;
    subtitle: string;
    header?: string;
    health?: string;
  };
}

// ============================================================================
// Order Params (for adapter)
// ============================================================================

export interface CoinbaseOrderParams {
  product_id: string;
  side: CoinbaseOrderSide;
  type: CoinbaseOrderType;
  size?: string;
  price?: string;
  stop_price?: string;
  time_in_force?: CoinbaseTimeInForce;
  client_order_id?: string;
}
