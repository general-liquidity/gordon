/**
 * Hyperliquid-specific Error Classes
 */

import { GordonError } from "./base.ts";

/**
 * Base error for all Hyperliquid API errors
 */
export class HyperliquidError extends GordonError {
  public readonly hyperliquidCode?: string;
  public readonly endpoint?: string;

  constructor(
    message: string,
    hyperliquidCode?: string,
    endpoint?: string,
    context?: Record<string, unknown>
  ) {
    super(message, "HYPERLIQUID_ERROR", { ...context, hyperliquidCode, endpoint });
    this.name = "HyperliquidError";
    this.hyperliquidCode = hyperliquidCode;
    this.endpoint = endpoint;
  }

  /**
   * Check if this is a rate limit error
   */
  isRateLimit(): boolean {
    return this.hyperliquidCode === "RATE_LIMIT";
  }

  /**
   * Check if this is an authentication error
   */
  isAuthError(): boolean {
    return (
      this.hyperliquidCode === "INVALID_SIGNATURE" ||
      this.hyperliquidCode === "INVALID_ADDRESS"
    );
  }
}

/**
 * Wallet signing error
 */
export class WalletSigningError extends HyperliquidError {
  constructor(
    message: string = "Failed to sign transaction with wallet",
    context?: Record<string, unknown>
  ) {
    super(message, "SIGNING_ERROR", undefined, context);
    this.name = "WalletSigningError";
  }
}

/**
 * Invalid wallet/private key error
 */
export class InvalidWalletError extends HyperliquidError {
  constructor(
    message: string = "Invalid wallet private key",
    context?: Record<string, unknown>
  ) {
    super(message, "INVALID_WALLET", undefined, context);
    this.name = "InvalidWalletError";
  }
}

/**
 * Rate limit exceeded error
 */
export class HyperliquidRateLimitError extends HyperliquidError {
  public readonly retryAfter?: number;

  constructor(
    retryAfter?: number,
    endpoint?: string,
    context?: Record<string, unknown>
  ) {
    super(
      `Rate limit exceeded${retryAfter ? `. Retry after ${retryAfter}ms` : ""}`,
      "RATE_LIMIT",
      endpoint,
      { ...context, retryAfter }
    );
    this.name = "HyperliquidRateLimitError";
    this.retryAfter = retryAfter;
  }
}

/**
 * Insufficient margin error (specific to perpetuals)
 */
export class InsufficientMarginError extends HyperliquidError {
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
      `Insufficient ${asset} margin. Required: ${required}, Available: ${available}`,
      "INSUFFICIENT_MARGIN",
      "/exchange",
      { ...context, asset, required, available }
    );
    this.name = "InsufficientMarginError";
    this.asset = asset;
    this.required = required;
    this.available = available;
  }
}

/**
 * Invalid asset/symbol error
 */
export class HyperliquidInvalidAssetError extends HyperliquidError {
  public readonly asset: string;

  constructor(asset: string, context?: Record<string, unknown>) {
    super(`Invalid asset: ${asset}`, "INVALID_ASSET", undefined, {
      ...context,
      asset,
    });
    this.name = "HyperliquidInvalidAssetError";
    this.asset = asset;
  }
}

/**
 * Connection error (network issues)
 */
export class HyperliquidConnectionError extends GordonError {
  constructor(
    message: string = "Failed to connect to Hyperliquid API",
    context?: Record<string, unknown>
  ) {
    super(message, "HYPERLIQUID_CONNECTION_ERROR", context);
    this.name = "HyperliquidConnectionError";
  }
}

/**
 * Not supported error (for spot-only operations on perpetuals exchange)
 */
export class HyperliquidNotSupportedError extends HyperliquidError {
  constructor(
    operation: string,
    context?: Record<string, unknown>
  ) {
    super(
      `Operation '${operation}' is not supported on Hyperliquid (perpetuals-only exchange)`,
      "NOT_SUPPORTED",
      undefined,
      { ...context, operation }
    );
    this.name = "HyperliquidNotSupportedError";
  }
}

/**
 * Create appropriate error from Hyperliquid API response
 */
export function createHyperliquidError(
  code: string,
  message: string,
  endpoint?: string
): HyperliquidError {
  switch (code) {
    case "RATE_LIMIT":
      return new HyperliquidRateLimitError(undefined, endpoint);
    case "INVALID_SIGNATURE":
    case "INVALID_ADDRESS":
      return new HyperliquidError(message, code, endpoint);
    case "SIGNING_ERROR":
      return new WalletSigningError(message);
    case "INVALID_WALLET":
      return new InvalidWalletError(message);
    case "INSUFFICIENT_MARGIN":
      return new HyperliquidError(message, code, endpoint);
    case "INVALID_ASSET":
      return new HyperliquidInvalidAssetError(message);
    default:
      return new HyperliquidError(message, code, endpoint);
  }
}
