/**
 * Coinbase-specific Error Classes
 */

import { GordonError } from "./base.ts";

/**
 * Base error for all Coinbase API errors
 */
export class CoinbaseError extends GordonError {
  public readonly coinbaseCode?: string;
  public readonly endpoint?: string;

  constructor(
    message: string,
    coinbaseCode?: string,
    endpoint?: string,
    context?: Record<string, unknown>
  ) {
    super(message, "COINBASE_ERROR", { ...context, coinbaseCode, endpoint });
    this.name = "CoinbaseError";
    this.coinbaseCode = coinbaseCode;
    this.endpoint = endpoint;
  }

  /**
   * Check if this is a rate limit error
   */
  isRateLimit(): boolean {
    return this.coinbaseCode === "RATE_LIMIT_EXCEEDED";
  }

  /**
   * Check if this is an authentication error
   */
  isAuthError(): boolean {
    return (
      this.coinbaseCode === "INVALID_API_KEY" ||
      this.coinbaseCode === "INVALID_SIGNATURE" ||
      this.coinbaseCode === "INVALID_PASSPHRASE"
    );
  }
}

/**
 * Rate limit exceeded error
 */
export class CoinbaseRateLimitError extends CoinbaseError {
  public readonly retryAfter?: number;

  constructor(
    retryAfter?: number,
    endpoint?: string,
    context?: Record<string, unknown>
  ) {
    super(
      `Rate limit exceeded${retryAfter ? `. Retry after ${retryAfter}ms` : ""}`,
      "RATE_LIMIT_EXCEEDED",
      endpoint,
      { ...context, retryAfter }
    );
    this.name = "CoinbaseRateLimitError";
    this.retryAfter = retryAfter;
  }
}

/**
 * API key/authentication error
 */
export class CoinbaseAuthError extends CoinbaseError {
  constructor(
    message: string = "Invalid API key, signature, or passphrase",
    coinbaseCode: string = "INVALID_API_KEY",
    context?: Record<string, unknown>
  ) {
    super(message, coinbaseCode, undefined, context);
    this.name = "CoinbaseAuthError";
  }
}

/**
 * Insufficient balance error
 */
export class CoinbaseInsufficientBalanceError extends CoinbaseError {
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
      "INSUFFICIENT_FUNDS",
      "/api/v3/brokerage/orders",
      { ...context, asset, required, available }
    );
    this.name = "CoinbaseInsufficientBalanceError";
    this.asset = asset;
    this.required = required;
    this.available = available;
  }
}

/**
 * Invalid product error
 */
export class CoinbaseInvalidProductError extends CoinbaseError {
  public readonly productId: string;

  constructor(productId: string, context?: Record<string, unknown>) {
    super(`Invalid product: ${productId}`, "INVALID_PRODUCT", undefined, {
      ...context,
      productId,
    });
    this.name = "CoinbaseInvalidProductError";
    this.productId = productId;
  }
}

/**
 * Connection error (network issues)
 */
export class CoinbaseConnectionError extends GordonError {
  constructor(
    message: string = "Failed to connect to Coinbase API",
    context?: Record<string, unknown>
  ) {
    super(message, "COINBASE_CONNECTION_ERROR", context);
    this.name = "CoinbaseConnectionError";
  }
}

/**
 * Create appropriate error from Coinbase API response
 */
export function createCoinbaseError(
  code: string,
  message: string,
  endpoint?: string
): CoinbaseError {
  switch (code) {
    case "RATE_LIMIT_EXCEEDED":
      return new CoinbaseRateLimitError(undefined, endpoint);
    case "INVALID_API_KEY":
    case "INVALID_SIGNATURE":
    case "INVALID_PASSPHRASE":
      return new CoinbaseAuthError(message, code);
    case "INSUFFICIENT_FUNDS":
      return new CoinbaseError(message, code, endpoint);
    case "INVALID_PRODUCT":
      return new CoinbaseInvalidProductError(message);
    default:
      return new CoinbaseError(message, code, endpoint);
  }
}
