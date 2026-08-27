/**
 * Bitfinex-specific Error Classes
 */

import { GordonError } from "./base.ts";

/**
 * Base error for all Bitfinex API errors
 */
export class BitfinexError extends GordonError {
  public readonly bitfinexCode?: string;
  public readonly endpoint?: string;

  constructor(
    message: string,
    bitfinexCode?: string,
    endpoint?: string,
    context?: Record<string, unknown>,
  ) {
    super(message, "BITFINEX_ERROR", { ...context, bitfinexCode, endpoint });
    this.name = "BitfinexError";
    this.bitfinexCode = bitfinexCode;
    this.endpoint = endpoint;
  }

  /**
   * Check if this is a rate limit error
   */
  isRateLimit(): boolean {
    return this.bitfinexCode === "10114" || this.bitfinexCode === "RATE_LIMIT";
  }

  /**
   * Check if this is an authentication error
   */
  isAuthError(): boolean {
    return (
      this.bitfinexCode === "10100" || // apikey: invalid
      this.bitfinexCode === "10111" || // apikey: nonce is too small
      this.bitfinexCode === "10112" // apikey: invalid signature
    );
  }
}

/**
 * Rate limit exceeded error
 */
export class BitfinexRateLimitError extends BitfinexError {
  public readonly retryAfter?: number;

  constructor(retryAfter?: number, endpoint?: string, context?: Record<string, unknown>) {
    super(
      `Rate limit exceeded${retryAfter ? `. Retry after ${retryAfter}ms` : ""}`,
      "RATE_LIMIT",
      endpoint,
      { ...context, retryAfter },
    );
    this.name = "BitfinexRateLimitError";
    this.retryAfter = retryAfter;
  }
}

/**
 * API key/authentication error
 */
export class BitfinexAuthError extends BitfinexError {
  constructor(
    message: string = "Invalid API key or signature",
    bitfinexCode: string = "10100",
    context?: Record<string, unknown>,
  ) {
    super(message, bitfinexCode, undefined, context);
    this.name = "BitfinexAuthError";
  }
}

/**
 * Insufficient balance error
 */
export class BitfinexInsufficientBalanceError extends BitfinexError {
  public readonly asset: string;
  public readonly required: number;
  public readonly available: number;

  constructor(
    asset: string,
    required: number,
    available: number,
    context?: Record<string, unknown>,
  ) {
    super(
      `Insufficient ${asset} balance. Required: ${required}, Available: ${available}`,
      "10001",
      "/auth/w/order/submit",
      { ...context, asset, required, available },
    );
    this.name = "BitfinexInsufficientBalanceError";
    this.asset = asset;
    this.required = required;
    this.available = available;
  }
}

/**
 * Invalid symbol/pair error
 */
export class BitfinexInvalidSymbolError extends BitfinexError {
  public readonly symbol: string;

  constructor(symbol: string, context?: Record<string, unknown>) {
    super(`Invalid symbol: ${symbol}`, "10020", undefined, {
      ...context,
      symbol,
    });
    this.name = "BitfinexInvalidSymbolError";
    this.symbol = symbol;
  }
}

/**
 * Connection error (network issues)
 */
export class BitfinexConnectionError extends GordonError {
  constructor(
    message: string = "Failed to connect to Bitfinex API",
    context?: Record<string, unknown>,
  ) {
    super(message, "BITFINEX_CONNECTION_ERROR", context);
    this.name = "BitfinexConnectionError";
  }
}

/**
 * Create appropriate error from Bitfinex API response
 */
export function createBitfinexError(
  code: string,
  message: string,
  endpoint?: string,
): BitfinexError {
  switch (code) {
    case "10114":
    case "RATE_LIMIT":
      return new BitfinexRateLimitError(undefined, endpoint);
    case "10100":
    case "10111":
    case "10112":
      return new BitfinexAuthError(message, code);
    case "10001":
      return new BitfinexError(message, code, endpoint);
    case "10020":
      return new BitfinexInvalidSymbolError(message);
    default:
      return new BitfinexError(message, code, endpoint);
  }
}
