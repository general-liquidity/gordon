/**
 * Binance-specific Error Classes
 */

import { GordonError } from "./base.ts";

/**
 * Base error for all Binance API errors
 */
export class BinanceError extends GordonError {
  public readonly binanceCode: number;
  public readonly endpoint?: string;

  constructor(
    message: string,
    binanceCode: number,
    endpoint?: string,
    context?: Record<string, unknown>
  ) {
    super(message, "BINANCE_ERROR", { ...context, binanceCode, endpoint });
    this.name = "BinanceError";
    this.binanceCode = binanceCode;
    this.endpoint = endpoint;
  }

  /**
   * Check if this is a rate limit error
   */
  isRateLimit(): boolean {
    return this.binanceCode === -1015 || this.binanceCode === -1003;
  }

  /**
   * Check if this is an authentication error
   */
  isAuthError(): boolean {
    return this.binanceCode === -2015 || this.binanceCode === -2014;
  }
}

/**
 * Rate limit exceeded error
 */
export class RateLimitError extends BinanceError {
  public readonly retryAfter?: number;

  constructor(
    retryAfter?: number,
    endpoint?: string,
    context?: Record<string, unknown>
  ) {
    super(
      `Rate limit exceeded${retryAfter ? `. Retry after ${retryAfter}ms` : ""}`,
      -1015,
      endpoint,
      { ...context, retryAfter }
    );
    this.name = "RateLimitError";
    this.retryAfter = retryAfter;
  }
}

/**
 * API key/authentication error
 */
export class BinanceAuthError extends BinanceError {
  constructor(
    message: string = "Invalid API key or signature",
    binanceCode: number = -2015,
    context?: Record<string, unknown>
  ) {
    super(message, binanceCode, undefined, context);
    this.name = "BinanceAuthError";
  }
}

/**
 * Insufficient balance error
 */
export class InsufficientBalanceError extends BinanceError {
  public readonly asset: string;
  public readonly required: number;
  public readonly available: number;

  constructor(
    asset: string,
    required: number,
    available: number,
    context?: Record<string, unknown>
  ) {
    super(
      `Insufficient ${asset} balance. Required: ${required}, Available: ${available}`,
      -2010,
      "/api/v3/order",
      { ...context, asset, required, available }
    );
    this.name = "InsufficientBalanceError";
    this.asset = asset;
    this.required = required;
    this.available = available;
  }
}

/**
 * Invalid symbol error
 */
export class InvalidSymbolError extends BinanceError {
  public readonly symbol: string;

  constructor(symbol: string, context?: Record<string, unknown>) {
    super(`Invalid trading pair: ${symbol}`, -1121, undefined, { ...context, symbol });
    this.name = "InvalidSymbolError";
    this.symbol = symbol;
  }
}

/**
 * Order would immediately trigger error
 */
export class OrderWouldTriggerError extends BinanceError {
  constructor(context?: Record<string, unknown>) {
    super(
      "Order would immediately trigger stop loss or take profit",
      -2021,
      "/api/v3/order",
      context
    );
    this.name = "OrderWouldTriggerError";
  }
}

/**
 * Connection error (network issues)
 */
export class BinanceConnectionError extends GordonError {
  constructor(message: string = "Failed to connect to Binance API", context?: Record<string, unknown>) {
    super(message, "BINANCE_CONNECTION_ERROR", context);
    this.name = "BinanceConnectionError";
  }
}

/**
 * Create appropriate error from Binance API response
 */
export function createBinanceError(
  code: number,
  message: string,
  endpoint?: string
): BinanceError {
  switch (code) {
    case -1015:
    case -1003:
      return new RateLimitError(undefined, endpoint);
    case -2015:
    case -2014:
      return new BinanceAuthError(message, code);
    case -2010:
      return new BinanceError(message, code, endpoint);
    case -1121:
      return new InvalidSymbolError(message.split(":")[1]?.trim() || "unknown");
    case -2021:
      return new OrderWouldTriggerError();
    default:
      return new BinanceError(message, code, endpoint);
  }
}
