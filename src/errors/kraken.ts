/**
 * Kraken-specific Error Classes
 */

import { GordonError } from "./base.ts";

/**
 * Base error for all Kraken API errors
 * Note: Kraken returns errors as an array of strings
 */
export class KrakenError extends GordonError {
  public readonly krakenErrors: string[];
  public readonly endpoint?: string;

  constructor(errors: string[], endpoint?: string, context?: Record<string, unknown>) {
    const message = errors.join("; ");
    super(message, "KRAKEN_ERROR", { ...context, krakenErrors: errors, endpoint });
    this.name = "KrakenError";
    this.krakenErrors = errors;
    this.endpoint = endpoint;
  }

  /**
   * Check if this is a rate limit error
   */
  isRateLimit(): boolean {
    return this.krakenErrors.some(
      (e) => e.includes("Rate limit exceeded") || e.includes("EAPI:Rate limit exceeded"),
    );
  }

  /**
   * Check if this is an authentication error
   */
  isAuthError(): boolean {
    return this.krakenErrors.some(
      (e) =>
        e.includes("Invalid key") ||
        e.includes("Invalid signature") ||
        e.includes("EAPI:Invalid key") ||
        e.includes("EAPI:Invalid signature"),
    );
  }

  /**
   * Check if this is an invalid nonce error
   */
  isInvalidNonce(): boolean {
    return this.krakenErrors.some(
      (e) => e.includes("Invalid nonce") || e.includes("EAPI:Invalid nonce"),
    );
  }
}

/**
 * Rate limit exceeded error
 */
export class KrakenRateLimitError extends KrakenError {
  public readonly retryAfter?: number;

  constructor(retryAfter?: number, endpoint?: string, context?: Record<string, unknown>) {
    super([`Rate limit exceeded${retryAfter ? `. Retry after ${retryAfter}ms` : ""}`], endpoint, {
      ...context,
      retryAfter,
    });
    this.name = "KrakenRateLimitError";
    this.retryAfter = retryAfter;
  }
}

/**
 * API key/authentication error
 */
export class KrakenAuthError extends KrakenError {
  constructor(message: string = "Invalid API key or signature", context?: Record<string, unknown>) {
    super([message], undefined, context);
    this.name = "KrakenAuthError";
  }
}

/**
 * Insufficient balance error
 */
export class KrakenInsufficientBalanceError extends KrakenError {
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
      [`Insufficient ${asset} balance. Required: ${required}, Available: ${available}`],
      "/0/private/AddOrder",
      { ...context, asset, required, available },
    );
    this.name = "KrakenInsufficientBalanceError";
    this.asset = asset;
    this.required = required;
    this.available = available;
  }
}

/**
 * Invalid asset pair error
 */
export class KrakenInvalidPairError extends KrakenError {
  public readonly pair: string;

  constructor(pair: string, context?: Record<string, unknown>) {
    super([`Invalid asset pair: ${pair}`], undefined, { ...context, pair });
    this.name = "KrakenInvalidPairError";
    this.pair = pair;
  }
}

/**
 * Connection error (network issues)
 */
export class KrakenConnectionError extends GordonError {
  constructor(
    message: string = "Failed to connect to Kraken API",
    context?: Record<string, unknown>,
  ) {
    super(message, "KRAKEN_CONNECTION_ERROR", context);
    this.name = "KrakenConnectionError";
  }
}

/**
 * Create appropriate error from Kraken API response
 */
export function createKrakenError(errors: string[], endpoint?: string): KrakenError {
  const errorStr = errors.join(" ");

  if (errorStr.includes("Rate limit") || errorStr.includes("EAPI:Rate limit")) {
    return new KrakenRateLimitError(undefined, endpoint);
  }

  if (
    errorStr.includes("Invalid key") ||
    errorStr.includes("Invalid signature") ||
    errorStr.includes("EAPI:Invalid key") ||
    errorStr.includes("EAPI:Invalid signature")
  ) {
    return new KrakenAuthError(errorStr);
  }

  if (errorStr.includes("Unknown asset pair")) {
    const pairMatch = errorStr.match(/pair[:\s]+(\w+)/i);
    return new KrakenInvalidPairError(pairMatch?.[1] || "unknown");
  }

  if (errorStr.includes("Insufficient funds")) {
    return new KrakenError(errors, endpoint);
  }

  return new KrakenError(errors, endpoint);
}
