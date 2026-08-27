/**
 * Error Message Translator
 *
 * Provides user-friendly error messages for various error types:
 * - Binance API error codes
 * - Coinbase error codes
 * - Kraken error codes
 * - Network errors
 * - Validation errors
 * - Internal tool errors
 *
 * Usage:
 * - Use translateError() to convert any error to a user-friendly message
 * - Use specific translators for known error types
 * - Integrate with tool wrappers for automatic error translation
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Binance API error response structure
 */
export interface BinanceApiError {
  code: number;
  msg: string;
}

/**
 * Translated error with context
 */
export interface TranslatedError {
  /** User-friendly error message */
  message: string;
  /** Original error code (if applicable) */
  code?: number | string;
  /** Error category */
  category: ErrorCategory;
  /** Whether the error is recoverable */
  recoverable: boolean;
  /** Suggested action for the user */
  suggestion?: string;
}

/**
 * Error categories for classification
 */
export type ErrorCategory =
  | "network"
  | "authentication"
  | "validation"
  | "rate_limit"
  | "insufficient_funds"
  | "market"
  | "order"
  | "system"
  | "unknown";

// ============================================================================
// Binance Error Code Mapping
// ============================================================================

/**
 * Binance error codes to user-friendly messages
 *
 * Reference: https://binance-docs.github.io/apidocs/spot/en/#error-codes
 */
const BINANCE_ERROR_MESSAGES: Record<
  number,
  { message: string; category: ErrorCategory; recoverable: boolean; suggestion?: string }
> = {
  // General Server Errors (-1000 to -1099)
  "-1000": {
    message: "Unknown error occurred on Binance.",
    category: "system",
    recoverable: true,
    suggestion: "Please try again in a few moments.",
  },
  "-1001": {
    message: "Connection to Binance was interrupted.",
    category: "network",
    recoverable: true,
    suggestion: "Check your internet connection and try again.",
  },
  "-1002": {
    message: "Authorization failed.",
    category: "authentication",
    recoverable: false,
    suggestion: "Please verify your API keys are correct and have the required permissions.",
  },
  "-1003": {
    message: "Too many requests to Binance.",
    category: "rate_limit",
    recoverable: true,
    suggestion: "Please wait a moment before making more requests.",
  },
  "-1006": {
    message: "Unexpected response from Binance.",
    category: "system",
    recoverable: true,
    suggestion: "The exchange may be experiencing issues. Try again later.",
  },
  "-1007": {
    message: "Request timed out.",
    category: "network",
    recoverable: true,
    suggestion: "The exchange is slow to respond. Please try again.",
  },
  "-1008": {
    message: "Server is overloaded.",
    category: "rate_limit",
    recoverable: true,
    suggestion: "Binance is experiencing high traffic. Please wait a moment and try again.",
  },
  "-1010": {
    message: "Error processing message.",
    category: "system",
    recoverable: true,
    suggestion: "Please try again.",
  },
  "-1013": {
    message: "Invalid quantity for this order.",
    category: "validation",
    recoverable: false,
    suggestion:
      "The order quantity does not meet the minimum, maximum, or step size requirements for this trading pair. Check the symbol's LOT_SIZE filter and adjust your quantity.",
  },
  "-1015": {
    message: "Too many orders. Rate limit exceeded.",
    category: "rate_limit",
    recoverable: true,
    suggestion: "You've placed too many orders recently. Wait a minute before placing more.",
  },
  "-1016": {
    message: "Service is unavailable.",
    category: "system",
    recoverable: true,
    suggestion: "Binance service is temporarily unavailable. Try again later.",
  },
  "-1020": {
    message: "Operation is not supported.",
    category: "validation",
    recoverable: false,
    suggestion: "This operation is not supported by Binance.",
  },
  "-1021": {
    message: "Timestamp is outside the valid window.",
    category: "system",
    recoverable: true,
    suggestion:
      "Your system clock may be out of sync. Synchronize your computer's time (e.g., enable automatic time sync in your OS settings) and try again.",
  },
  "-1022": {
    message: "Invalid API signature.",
    category: "authentication",
    recoverable: false,
    suggestion: "Please check your API secret key is correct.",
  },

  // Request Issues (-1100 to -1199)
  "-1100": {
    message: "Invalid parameter in request.",
    category: "validation",
    recoverable: false,
    suggestion: "Please check the input parameters and try again.",
  },
  "-1101": {
    message: "Too many parameters in request.",
    category: "validation",
    recoverable: false,
    suggestion: "Please simplify your request.",
  },
  "-1102": {
    message: "Required parameter missing.",
    category: "validation",
    recoverable: false,
    suggestion: "Please provide all required parameters.",
  },
  "-1103": {
    message: "Unknown parameter provided.",
    category: "validation",
    recoverable: false,
    suggestion: "Please check the parameter names.",
  },
  "-1104": {
    message: "Not all parameters were read.",
    category: "validation",
    recoverable: false,
    suggestion: "Please check the request format.",
  },
  "-1105": {
    message: "Parameter is empty.",
    category: "validation",
    recoverable: false,
    suggestion: "Please provide a value for the required parameter.",
  },
  "-1106": {
    message: "Unnecessary parameter provided.",
    category: "validation",
    recoverable: false,
    suggestion: "Please remove the extra parameter.",
  },
  "-1111": {
    message: "Invalid precision for this symbol.",
    category: "validation",
    recoverable: false,
    suggestion: "Please check the decimal places allowed for this trading pair.",
  },
  "-1112": {
    message: "No orders available for this pair.",
    category: "order",
    recoverable: true,
    suggestion: "There are currently no orders on this trading pair.",
  },
  "-1114": {
    message: "Invalid time-in-force value.",
    category: "validation",
    recoverable: false,
    suggestion: "Use a valid time-in-force (GTC, IOC, FOK).",
  },
  "-1115": {
    message: "Invalid order type.",
    category: "validation",
    recoverable: false,
    suggestion: "Use a valid order type (LIMIT, MARKET, STOP_LOSS, etc.).",
  },
  "-1116": {
    message: "Invalid order side.",
    category: "validation",
    recoverable: false,
    suggestion: "Order side must be BUY or SELL.",
  },
  "-1117": {
    message: "Empty new client order ID.",
    category: "validation",
    recoverable: false,
    suggestion: "Please provide a valid client order ID.",
  },
  "-1118": {
    message: "Empty original client order ID.",
    category: "validation",
    recoverable: false,
    suggestion: "Please provide the original order ID.",
  },
  "-1119": {
    message: "Invalid interval for klines/candles.",
    category: "validation",
    recoverable: false,
    suggestion: "Use a valid timeframe (1m, 5m, 15m, 1h, 4h, 1d, etc.).",
  },
  "-1120": {
    message: "Invalid symbol.",
    category: "validation",
    recoverable: false,
    suggestion: "Please check the trading pair symbol (e.g., BTCUSDT).",
  },
  "-1121": {
    message: "Invalid trading pair symbol.",
    category: "validation",
    recoverable: false,
    suggestion: "This trading pair does not exist on Binance.",
  },
  "-1125": {
    message: "Invalid listen key.",
    category: "authentication",
    recoverable: true,
    suggestion: "Please reconnect to the websocket.",
  },
  "-1127": {
    message: "Invalid interval for this request.",
    category: "validation",
    recoverable: false,
    suggestion: "Please use a supported time interval.",
  },
  "-1128": {
    message: "Invalid parameters combination.",
    category: "validation",
    recoverable: false,
    suggestion: "Please check the combination of parameters.",
  },
  "-1130": {
    message: "Data sent is not valid JSON.",
    category: "validation",
    recoverable: false,
    suggestion: "Please check the request format.",
  },
  "-1131": {
    message: "Invalid recvWindow value.",
    category: "validation",
    recoverable: false,
    suggestion: "The request window should be less than 60000ms.",
  },

  // Order Issues (-2000 to -2099)
  "-2010": {
    message: "Insufficient balance to place this order.",
    category: "insufficient_funds",
    recoverable: false,
    suggestion:
      "You don't have enough funds for this order. Check your available balance and reduce the order size, or deposit more funds.",
  },
  "-2011": {
    message: "Order cancellation failed.",
    category: "order",
    recoverable: true,
    suggestion: "The order may have already been filled or cancelled.",
  },
  "-2013": {
    message: "Order does not exist.",
    category: "order",
    recoverable: false,
    suggestion: "This order may have been filled or cancelled already.",
  },
  "-2014": {
    message: "Invalid API key format.",
    category: "authentication",
    recoverable: false,
    suggestion: "Please check your API key format.",
  },
  "-2015": {
    message: "Invalid API key, IP, or permissions.",
    category: "authentication",
    recoverable: false,
    suggestion:
      "Please verify your API key has the required permissions and IP whitelist settings.",
  },
  "-2016": {
    message: "No trading window found.",
    category: "market",
    recoverable: true,
    suggestion: "The market may be closed or unavailable.",
  },
  "-2018": {
    message: "Insufficient balance.",
    category: "insufficient_funds",
    recoverable: false,
    suggestion: "You don't have enough funds to complete this order. Check your available balance.",
  },
  "-2019": {
    message: "Margin is insufficient.",
    category: "insufficient_funds",
    recoverable: false,
    suggestion: "You need more margin to place this order.",
  },
  "-2020": {
    message: "Unable to fill order.",
    category: "order",
    recoverable: true,
    suggestion: "The order could not be filled at the requested price. Try adjusting the price.",
  },
  "-2021": {
    message: "Order would trigger immediately.",
    category: "order",
    recoverable: false,
    suggestion: "Adjust your stop price to be further from the current market price.",
  },
  "-2022": {
    message: "Reduce-only order rejected.",
    category: "order",
    recoverable: false,
    suggestion: "This reduce-only order would increase your position.",
  },
  "-2024": {
    message: "Position side does not match.",
    category: "order",
    recoverable: false,
    suggestion: "Check your position mode settings.",
  },
  "-2025": {
    message: "Reach maximum open orders.",
    category: "order",
    recoverable: true,
    suggestion: "You have too many open orders. Cancel some orders before placing new ones.",
  },
  "-2026": {
    message: "Order was already cancelled.",
    category: "order",
    recoverable: false,
    suggestion: "This order has already been cancelled.",
  },

  // Filter Errors (-9000 to -9999)
  "-9000": {
    message: "Order filter error.",
    category: "validation",
    recoverable: false,
    suggestion: "The order doesn't meet the trading pair's requirements.",
  },
};

// ============================================================================
// Coinbase Error Code Mapping
// ============================================================================

/**
 * Coinbase Advanced Trade API error codes to user-friendly messages.
 * These are string-based error identifiers returned by the Coinbase API.
 */
const COINBASE_ERROR_MESSAGES: Record<
  string,
  { message: string; category: ErrorCategory; recoverable: boolean; suggestion?: string }
> = {
  INSUFFICIENT_FUNDS: {
    message: "Insufficient funds on Coinbase.",
    category: "insufficient_funds",
    recoverable: false,
    suggestion:
      "You don't have enough balance to complete this order. Deposit more funds or reduce the order size.",
  },
  INVALID_AMOUNT: {
    message: "Invalid amount for this Coinbase order.",
    category: "validation",
    recoverable: false,
    suggestion:
      "The order amount does not meet Coinbase requirements. Check the minimum order size and increment for this trading pair.",
  },
  NOT_FOUND: {
    message: "Resource not found on Coinbase.",
    category: "validation",
    recoverable: false,
    suggestion:
      "The requested order, product, or account was not found. Verify the ID or symbol is correct.",
  },
};

// ============================================================================
// Kraken Error Code Mapping
// ============================================================================

/**
 * Kraken API error strings to user-friendly messages.
 * Kraken returns errors as string arrays prefixed with 'E' for errors.
 */
const KRAKEN_ERROR_MESSAGES: Record<
  string,
  { message: string; category: ErrorCategory; recoverable: boolean; suggestion?: string }
> = {
  "EOrder:Insufficient funds": {
    message: "Insufficient funds on Kraken.",
    category: "insufficient_funds",
    recoverable: false,
    suggestion:
      "You don't have enough balance to place this order. Deposit more funds or reduce the order size.",
  },
  "EGeneral:Invalid arguments": {
    message: "Invalid arguments in Kraken request.",
    category: "validation",
    recoverable: false,
    suggestion:
      "One or more parameters are invalid. Check the order type, pair name, volume, and price values.",
  },
};

// ============================================================================
// Network Error Patterns
// ============================================================================

/**
 * Common network error patterns and their user-friendly messages
 */
const NETWORK_ERROR_PATTERNS: Array<{
  pattern: RegExp;
  message: string;
  suggestion: string;
}> = [
  {
    pattern: /ECONNREFUSED/i,
    message: "Unable to connect to the exchange.",
    suggestion: "Check your internet connection and try again.",
  },
  {
    pattern: /ENOTFOUND/i,
    message: "Exchange server not found.",
    suggestion: "Check your internet connection and DNS settings.",
  },
  {
    pattern: /ETIMEDOUT/i,
    message: "Connection timed out.",
    suggestion: "The exchange is slow to respond. Please try again.",
  },
  {
    pattern: /ECONNRESET/i,
    message: "Connection was reset.",
    suggestion: "Please try again.",
  },
  {
    pattern: /socket hang up/i,
    message: "Connection was unexpectedly closed.",
    suggestion: "Please try again.",
  },
  {
    pattern: /network|internet|offline/i,
    message: "Network error occurred.",
    suggestion: "Check your internet connection.",
  },
  {
    pattern: /timeout/i,
    message: "Request timed out.",
    suggestion: "The server is slow to respond. Please try again.",
  },
  {
    pattern: /certificate|SSL|TLS/i,
    message: "Secure connection failed.",
    suggestion: "There may be a security issue. Check your network settings.",
  },
];

// ============================================================================
// Translation Functions
// ============================================================================

/**
 * Check if an error is a Binance API error
 */
export function isBinanceApiError(error: unknown): error is BinanceApiError {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    "msg" in error &&
    typeof (error as BinanceApiError).code === "number"
  );
}

/**
 * Translate a Binance API error code to a user-friendly message
 *
 * @param code - Binance error code
 * @param originalMessage - Original error message from Binance
 * @returns Translated error with context
 */
export function translateBinanceError(code: number, originalMessage?: string): TranslatedError {
  const errorInfo =
    BINANCE_ERROR_MESSAGES[code.toString() as unknown as keyof typeof BINANCE_ERROR_MESSAGES];

  if (errorInfo) {
    return {
      message: errorInfo.message,
      code,
      category: errorInfo.category,
      recoverable: errorInfo.recoverable,
      suggestion: errorInfo.suggestion,
    };
  }

  // Unknown Binance error code
  return {
    message: originalMessage ?? `Binance error (code: ${code})`,
    code,
    category: "unknown",
    recoverable: true,
    suggestion: "Please try again or contact support if the issue persists.",
  };
}

/**
 * Translate a Coinbase error code string to a user-friendly message
 *
 * @param errorCode - Coinbase error code string (e.g., "INSUFFICIENT_FUNDS")
 * @param originalMessage - Original error message from Coinbase
 * @returns Translated error with context, or null if not a known Coinbase error
 */
export function translateCoinbaseError(
  errorCode: string,
  _originalMessage?: string,
): TranslatedError | null {
  const errorInfo = COINBASE_ERROR_MESSAGES[errorCode];
  if (errorInfo) {
    return {
      message: errorInfo.message,
      code: errorCode,
      category: errorInfo.category,
      recoverable: errorInfo.recoverable,
      suggestion: errorInfo.suggestion,
    };
  }
  return null;
}

/**
 * Translate a Kraken error string to a user-friendly message
 *
 * @param errorString - Kraken error string (e.g., "EOrder:Insufficient funds")
 * @param originalMessage - Original error message from Kraken
 * @returns Translated error with context, or null if not a known Kraken error
 */
export function translateKrakenError(
  errorString: string,
  _originalMessage?: string,
): TranslatedError | null {
  const errorInfo = KRAKEN_ERROR_MESSAGES[errorString];
  if (errorInfo) {
    return {
      message: errorInfo.message,
      code: errorString,
      category: errorInfo.category,
      recoverable: errorInfo.recoverable,
      suggestion: errorInfo.suggestion,
    };
  }
  return null;
}

/**
 * Translate a network error to a user-friendly message
 *
 * @param error - The error to translate
 * @returns Translated error with context
 */
export function translateNetworkError(error: Error): TranslatedError {
  const errorString = error.message || error.toString();

  for (const pattern of NETWORK_ERROR_PATTERNS) {
    if (pattern.pattern.test(errorString)) {
      return {
        message: pattern.message,
        category: "network",
        recoverable: true,
        suggestion: pattern.suggestion,
      };
    }
  }

  return {
    message: "Network error occurred.",
    category: "network",
    recoverable: true,
    suggestion: "Check your internet connection and try again.",
  };
}

/**
 * Translate a validation error to a user-friendly message
 *
 * @param field - The field that failed validation
 * @param issue - Description of the validation issue
 * @returns Translated error with context
 */
export function translateValidationError(field: string, issue: string): TranslatedError {
  return {
    message: `Invalid ${field}: ${issue}`,
    category: "validation",
    recoverable: false,
    suggestion: `Please provide a valid value for ${field}.`,
  };
}

/**
 * Try to match an error message against known Coinbase and Kraken error patterns.
 * Returns a TranslatedError if matched, or null otherwise.
 */
function tryTranslateExchangeErrorString(errorMessage: string): TranslatedError | null {
  // Check Coinbase error codes (appear as uppercase identifiers in messages)
  for (const code of Object.keys(COINBASE_ERROR_MESSAGES)) {
    if (errorMessage.includes(code)) {
      return translateCoinbaseError(code, errorMessage);
    }
  }

  // Check Kraken error strings (appear as "EOrder:..." or "EGeneral:..." in messages)
  for (const code of Object.keys(KRAKEN_ERROR_MESSAGES)) {
    if (errorMessage.includes(code)) {
      return translateKrakenError(code, errorMessage);
    }
  }

  return null;
}

/**
 * Main error translation function - handles any error type
 *
 * @param error - Any error (Error object, Binance error, string, etc.)
 * @returns Translated error with context
 *
 * @example
 * ```typescript
 * try {
 *   await binance.placeOrder(order);
 * } catch (error) {
 *   const translated = translateError(error);
 *   return { error: translated.message, suggestion: translated.suggestion };
 * }
 * ```
 */
export function translateError(error: unknown): TranslatedError {
  // Handle null/undefined
  if (error === null || error === undefined) {
    return {
      message: "An unknown error occurred.",
      category: "unknown",
      recoverable: true,
      suggestion: "Please try again.",
    };
  }

  // Handle Binance API errors
  if (isBinanceApiError(error)) {
    return translateBinanceError(error.code, error.msg);
  }

  // Handle Error objects with Binance-style code/msg
  if (error instanceof Error) {
    // Check if it's a Binance error wrapped in an Error object
    const errorAny = error as Error & { code?: number; msg?: string };
    if (typeof errorAny.code === "number" && errorAny.msg) {
      return translateBinanceError(errorAny.code, errorAny.msg);
    }

    // Check for network errors
    if (
      error.name === "FetchError" ||
      error.name === "NetworkError" ||
      NETWORK_ERROR_PATTERNS.some((p) => p.pattern.test(error.message))
    ) {
      return translateNetworkError(error);
    }

    // Check if error message contains a Binance error code
    const codeMatch = error.message.match(/code[:\s]*(-?\d+)/i);
    if (codeMatch) {
      const code = parseInt(codeMatch[1]!, 10);
      return translateBinanceError(code, error.message);
    }

    // Check for Coinbase / Kraken error patterns in the message
    const exchangeMatch = tryTranslateExchangeErrorString(error.message);
    if (exchangeMatch) {
      return exchangeMatch;
    }

    // Generic error
    return {
      message: error.message || "An error occurred.",
      category: "unknown",
      recoverable: true,
      suggestion: "Please try again or contact support if the issue persists.",
    };
  }

  // Handle string errors
  if (typeof error === "string") {
    // Check for Binance error code in string
    const codeMatch = error.match(/code[:\s]*(-?\d+)/i);
    if (codeMatch) {
      const code = parseInt(codeMatch[1]!, 10);
      return translateBinanceError(code, error);
    }

    // Check for Coinbase / Kraken error patterns in the string
    const exchangeMatch = tryTranslateExchangeErrorString(error);
    if (exchangeMatch) {
      return exchangeMatch;
    }

    return {
      message: error,
      category: "unknown",
      recoverable: true,
      suggestion: "Please try again.",
    };
  }

  // Handle objects with error property
  if (typeof error === "object" && "error" in error) {
    const errorObj = error as { error: unknown };
    if (typeof errorObj.error === "string") {
      // Check for Coinbase / Kraken error patterns
      const exchangeMatch = tryTranslateExchangeErrorString(errorObj.error);
      if (exchangeMatch) {
        return exchangeMatch;
      }

      return {
        message: errorObj.error,
        category: "unknown",
        recoverable: true,
        suggestion: "Please try again.",
      };
    }
  }

  // Fallback for unknown error types
  return {
    message: "An unexpected error occurred.",
    category: "unknown",
    recoverable: true,
    suggestion: "Please try again or contact support if the issue persists.",
  };
}

/**
 * Format a translated error for user display
 *
 * @param translated - The translated error
 * @param includeCode - Whether to include the error code
 * @returns Formatted error string
 */
export function formatTranslatedError(translated: TranslatedError, includeCode = false): string {
  let message = translated.message;

  if (includeCode && translated.code) {
    message += ` (Error code: ${translated.code})`;
  }

  if (translated.suggestion) {
    message += ` ${translated.suggestion}`;
  }

  return message;
}

/**
 * Create a user-friendly error response object
 *
 * @param error - Any error
 * @returns Object with error message and metadata
 */
export function createErrorResponse(error: unknown): {
  error: string;
  errorCode?: number | string;
  category: ErrorCategory;
  recoverable: boolean;
  suggestion?: string;
} {
  const translated = translateError(error);
  return {
    error: translated.message,
    errorCode: translated.code,
    category: translated.category,
    recoverable: translated.recoverable,
    suggestion: translated.suggestion,
  };
}

/**
 * Check if an error indicates insufficient funds
 */
export function isInsufficientFundsError(error: unknown): boolean {
  const translated = translateError(error);
  return translated.category === "insufficient_funds";
}

/**
 * Check if an error is a rate limit error
 */
export function isRateLimitError(error: unknown): boolean {
  const translated = translateError(error);
  return translated.category === "rate_limit";
}

/**
 * Check if an error is an authentication error
 */
export function isAuthenticationError(error: unknown): boolean {
  const translated = translateError(error);
  return translated.category === "authentication";
}

/**
 * Check if an error is recoverable (can retry)
 */
export function isRecoverableError(error: unknown): boolean {
  const translated = translateError(error);
  return translated.recoverable;
}
