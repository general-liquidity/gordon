/**
 * Error Context Utility
 * Provides enhanced error context and recovery suggestions for Gordon CLI
 */

import {
  GordonError,
  RateLimitError,
  BinanceAuthError,
  InsufficientBalanceError,
  InvalidSymbolError,
  BinanceConnectionError,
  InsufficientFundsError,
  TradingModeError,
  RiskLimitExceededError,
  InvalidPlanError,
  isGordonError,
} from "../errors/index.ts";

// ============================================================================
// Types
// ============================================================================

/**
 * Structured error context for display
 */
export interface ErrorContext {
  /** What user was trying to do (high-level operation) */
  operation: string;
  /** Specific action that failed */
  attempted: string;
  /** Why it failed (user-friendly explanation) */
  reason: string;
  /** Numbered recovery options */
  recoverySteps: RecoveryStep[];
  /** Error code if available */
  errorCode?: string;
  /** Additional context data */
  metadata?: Record<string, unknown>;
}

/**
 * A single recovery step with optional command
 */
export interface RecoveryStep {
  /** Step number (auto-assigned if not provided) */
  step?: number;
  /** Description of what to do */
  description: string;
  /** Command to run (if applicable) */
  command?: string;
  /** Wait time in seconds (for rate limit errors) */
  waitSeconds?: number;
}

/**
 * Error type identifiers for mapping
 */
export type ErrorType =
  | "RATE_LIMIT"
  | "AUTH_FAILURE"
  | "INSUFFICIENT_BALANCE"
  | "NETWORK_ERROR"
  | "INVALID_SYMBOL"
  | "TRADING_MODE"
  | "RISK_LIMIT"
  | "INVALID_PLAN"
  | "TIMEOUT"
  | "UNKNOWN";

// ============================================================================
// Error Type Detection
// ============================================================================

/**
 * Detect the type of error from an Error instance
 */
export function detectErrorType(error: Error): ErrorType {
  // Check for Gordon-specific error classes first
  if (error instanceof RateLimitError) return "RATE_LIMIT";
  if (error instanceof BinanceAuthError) return "AUTH_FAILURE";
  if (error instanceof InsufficientBalanceError) return "INSUFFICIENT_BALANCE";
  if (error instanceof InsufficientFundsError) return "INSUFFICIENT_BALANCE";
  if (error instanceof InvalidSymbolError) return "INVALID_SYMBOL";
  if (error instanceof BinanceConnectionError) return "NETWORK_ERROR";
  if (error instanceof TradingModeError) return "TRADING_MODE";
  if (error instanceof RiskLimitExceededError) return "RISK_LIMIT";
  if (error instanceof InvalidPlanError) return "INVALID_PLAN";

  // Check error message patterns
  const message = error.message.toLowerCase();

  if (message.includes("rate limit") || message.includes("too many requests")) {
    return "RATE_LIMIT";
  }
  if (
    message.includes("unauthorized") ||
    message.includes("invalid api") ||
    message.includes("invalid signature") ||
    message.includes("api key")
  ) {
    return "AUTH_FAILURE";
  }
  if (
    message.includes("insufficient") ||
    message.includes("not enough") ||
    message.includes("balance")
  ) {
    return "INSUFFICIENT_BALANCE";
  }
  if (
    message.includes("network") ||
    message.includes("connection") ||
    message.includes("fetch") ||
    message.includes("econnrefused") ||
    message.includes("enotfound")
  ) {
    return "NETWORK_ERROR";
  }
  if (
    message.includes("invalid symbol") ||
    message.includes("symbol not found") ||
    message.includes("unknown symbol")
  ) {
    return "INVALID_SYMBOL";
  }
  if (message.includes("timeout") || message.includes("timed out")) {
    return "TIMEOUT";
  }
  if (message.includes("safe mode") || message.includes("armed")) {
    return "TRADING_MODE";
  }

  return "UNKNOWN";
}

// ============================================================================
// Recovery Step Generators
// ============================================================================

/**
 * Generate recovery steps for rate limit errors
 */
function getRateLimitRecovery(
  error: Error,
  context?: Record<string, unknown>
): RecoveryStep[] {
  const waitTime =
    error instanceof RateLimitError && error.retryAfter
      ? Math.ceil(error.retryAfter / 1000)
      : 30;

  const steps: RecoveryStep[] = [
    {
      description: `Wait ${waitTime} seconds and retry`,
      waitSeconds: waitTime,
    },
  ];

  // Suggest longer timeframe if analyzing
  if (context?.operation?.toString().includes("analyze")) {
    steps.push({
      description: "Try with a longer timeframe",
      command: "/analyze BTC 1h",
    });
  }

  // Suggest checking cache
  steps.push({
    description: "Check cached data",
    command: "/cache status",
  });

  return steps;
}

/**
 * Generate recovery steps for auth errors
 */
function getAuthRecovery(): RecoveryStep[] {
  return [
    {
      description: "Re-run setup to verify your API credentials",
      command: "/setup",
    },
    {
      description: "Check that your API key has the correct permissions (Enable Reading, Enable Spot Trading)",
    },
    {
      description: "Verify your system clock is synchronized (NTP)",
    },
    {
      description: "Regenerate API keys from your exchange if the issue persists",
    },
  ];
}

/**
 * Generate recovery steps for insufficient balance errors
 */
function getInsufficientBalanceRecovery(
  error: Error,
  context?: Record<string, unknown>
): RecoveryStep[] {
  const steps: RecoveryStep[] = [
    {
      description: "Check your current portfolio balance",
      command: "/portfolio",
    },
  ];

  // Extract amounts if available
  if (error instanceof InsufficientBalanceError) {
    steps.push({
      description: `You need ${error.required} ${error.asset} but only have ${error.available} ${error.asset}`,
    });
  } else if (error instanceof InsufficientFundsError) {
    steps.push({
      description: `Required: ${error.required} ${error.currency}, Available: ${error.available} ${error.currency}`,
    });
  }

  steps.push({
    description: "Try with a smaller position size",
  });

  steps.push({
    description: "Deposit more funds to your exchange account",
  });

  return steps;
}

/**
 * Generate recovery steps for network errors
 */
function getNetworkRecovery(): RecoveryStep[] {
  return [
    {
      description: "Check your internet connection",
    },
    {
      description: "Test connection to your exchange",
      command: "/status",
    },
    {
      description: "Wait a moment and retry - your exchange may be experiencing issues",
      waitSeconds: 10,
    },
    {
      description: "Check your exchange status page for outages",
    },
  ];
}

/**
 * Generate recovery steps for invalid symbol errors
 */
function getInvalidSymbolRecovery(
  error: Error,
  context?: Record<string, unknown>
): RecoveryStep[] {
  const steps: RecoveryStep[] = [];

  // Try to extract the invalid symbol
  let invalidSymbol = "";
  if (error instanceof InvalidSymbolError) {
    invalidSymbol = error.symbol;
  } else {
    const match = error.message.match(/symbol[:\s]+(\w+)/i);
    if (match) {
      invalidSymbol = match[1] || "";
    }
  }

  if (invalidSymbol) {
    // Suggest similar symbols
    const suggestions = getSimilarSymbols(invalidSymbol);
    if (suggestions.length > 0) {
      steps.push({
        description: `Did you mean: ${suggestions.join(", ")}?`,
      });
    }
  }

  steps.push({
    description: "View trending trading pairs",
    command: "/trending",
  });

  steps.push({
    description: "Make sure to use the full pair name (e.g., BTCUSDT not BTC)",
  });

  return steps;
}

/**
 * Generate recovery steps for trading mode errors
 */
function getTradingModeRecovery(error: Error): RecoveryStep[] {
  if (error instanceof TradingModeError) {
    if (error.currentState === "strict") {
      return [
        {
          description: "Set permissionMode to 'auto' — trades execute without per-action approval",
          command: "/auto",
        },
        {
          description: "Or set to 'ask' — each trade requires approval (default)",
          command: "/ask",
        },
        {
          description: "Review your plan before enabling",
          command: "/plan",
        },
      ];
    } else {
      return [
        {
          description: "Set to strict (read-only) mode",
          command: "/strict",
        },
      ];
    }
  }

  return [
    {
      description: "Check current permission mode",
      command: "/status",
    },
  ];
}

/**
 * Generate recovery steps for risk limit errors
 */
function getRiskLimitRecovery(error: Error): RecoveryStep[] {
  const steps: RecoveryStep[] = [];

  if (error instanceof RiskLimitExceededError) {
    switch (error.limitType) {
      case "allocation":
        steps.push({
          description: `Reduce position size to stay within ${error.limit * 100}% allocation limit`,
        });
        break;
      case "positions":
        steps.push({
          description: `Close an existing position first (max ${error.limit} positions allowed)`,
        });
        steps.push({
          description: "View open positions",
          command: "/positions",
        });
        break;
      case "drawdown":
        steps.push({
          description: `Wait for recovery - daily drawdown limit of ${error.limit * 100}% reached`,
        });
        break;
    }
  }

  steps.push({
    description: "Review risk settings",
    command: "/settings risk",
  });

  return steps;
}

/**
 * Generate recovery steps for timeout errors
 */
function getTimeoutRecovery(): RecoveryStep[] {
  return [
    {
      description: "The request timed out - try again",
      waitSeconds: 5,
    },
    {
      description: "Check your connection status",
      command: "/status",
    },
    {
      description: "Try a simpler request first",
    },
  ];
}

/**
 * Generate generic recovery steps
 */
function getGenericRecovery(): RecoveryStep[] {
  return [
    {
      description: "Try the operation again",
    },
    {
      description: "Check system status",
      command: "/status",
    },
    {
      description: "Ask Gordon for help",
      command: "/help",
    },
  ];
}

// ============================================================================
// Symbol Suggestions
// ============================================================================

const COMMON_SYMBOLS = [
  "BTCUSDT",
  "ETHUSDT",
  "BNBUSDT",
  "XRPUSDT",
  "ADAUSDT",
  "DOGEUSDT",
  "SOLUSDT",
  "DOTUSDT",
  "MATICUSDT",
  "LTCUSDT",
  "AVAXUSDT",
  "LINKUSDT",
  "ATOMUSDT",
  "UNIUSDT",
  "XLMUSDT",
];

/**
 * Get similar symbol suggestions for an invalid symbol
 */
export function getSimilarSymbols(invalidSymbol: string): string[] {
  const normalized = invalidSymbol.toUpperCase().replace(/USDT$/, "");
  const suggestions: string[] = [];

  for (const symbol of COMMON_SYMBOLS) {
    const base = symbol.replace(/USDT$/, "");
    // Check for partial matches or common typos
    if (
      base.includes(normalized) ||
      normalized.includes(base) ||
      levenshteinDistance(base, normalized) <= 2
    ) {
      suggestions.push(symbol);
      if (suggestions.length >= 3) break;
    }
  }

  return suggestions;
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0]![j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i]![j] = matrix[i - 1]![j - 1]!;
      } else {
        matrix[i]![j] = Math.min(
          matrix[i - 1]![j - 1]! + 1, // substitution
          matrix[i]![j - 1]! + 1, // insertion
          matrix[i - 1]![j]! + 1 // deletion
        );
      }
    }
  }

  return matrix[b.length]![a.length]!;
}

// ============================================================================
// Main Functions
// ============================================================================

/**
 * Create structured error context from an error
 *
 * @param error - The error that occurred
 * @param operation - What the user was trying to do (e.g., "analyze BTC")
 * @param context - Additional context about the operation
 * @returns Structured error context for display
 *
 * @example
 * ```typescript
 * try {
 *   await analyze(binance, "BTCUSDT");
 * } catch (error) {
 *   const ctx = createErrorContext(
 *     error,
 *     "/analyze BTC",
 *     { symbol: "BTCUSDT", timeframe: "15m" }
 *   );
 *   console.log(formatErrorWithContext(ctx));
 * }
 * ```
 */
export function createErrorContext(
  error: Error,
  operation: string,
  context?: Record<string, unknown>
): ErrorContext {
  const errorType = detectErrorType(error);
  const errorCode = isGordonError(error) ? error.code : undefined;

  // Build attempted action description
  let attempted = operation;
  if (context?.symbol) {
    attempted = `Get data for ${context.symbol}`;
  }
  if (context?.action) {
    attempted = String(context.action);
  }

  // Build reason based on error type and message
  let reason = error.message;
  const recoverySteps = getRecoverySteps(errorType, error, context);

  // Enhance reason for specific error types
  switch (errorType) {
    case "RATE_LIMIT":
      reason = "You've exceeded the API rate limit";
      if (error instanceof RateLimitError && error.retryAfter) {
        reason += ` (reset in ${Math.ceil(error.retryAfter / 1000)}s)`;
      }
      break;
    case "AUTH_FAILURE":
      reason = "API authentication failed - your credentials may be invalid or expired";
      break;
    case "INSUFFICIENT_BALANCE":
      reason = "You don't have enough funds for this operation";
      break;
    case "NETWORK_ERROR":
      reason = "Could not connect to exchange - check your internet connection";
      break;
    case "INVALID_SYMBOL":
      reason = "The trading pair you specified doesn't exist";
      break;
    case "TRADING_MODE":
      reason = "The system is not in the correct trading mode for this operation";
      break;
    case "RISK_LIMIT":
      reason = "This operation would exceed your risk management limits";
      break;
    case "TIMEOUT":
      reason = "The request took too long and was cancelled";
      break;
  }

  return {
    operation,
    attempted,
    reason,
    recoverySteps,
    errorCode,
    metadata: context,
  };
}

/**
 * Get recovery steps based on error type
 */
function getRecoverySteps(
  errorType: ErrorType,
  error: Error,
  context?: Record<string, unknown>
): RecoveryStep[] {
  let steps: RecoveryStep[];

  switch (errorType) {
    case "RATE_LIMIT":
      steps = getRateLimitRecovery(error, context);
      break;
    case "AUTH_FAILURE":
      steps = getAuthRecovery();
      break;
    case "INSUFFICIENT_BALANCE":
      steps = getInsufficientBalanceRecovery(error, context);
      break;
    case "NETWORK_ERROR":
      steps = getNetworkRecovery();
      break;
    case "INVALID_SYMBOL":
      steps = getInvalidSymbolRecovery(error, context);
      break;
    case "TRADING_MODE":
      steps = getTradingModeRecovery(error);
      break;
    case "RISK_LIMIT":
      steps = getRiskLimitRecovery(error);
      break;
    case "TIMEOUT":
      steps = getTimeoutRecovery();
      break;
    default:
      steps = getGenericRecovery();
  }

  // Add step numbers
  return steps.map((step, index) => ({
    ...step,
    step: index + 1,
  }));
}

/**
 * Format error context as a human-readable string
 *
 * @param ctx - The error context to format
 * @returns Formatted multi-line string for display
 *
 * @example
 * Output format:
 * ```
 * Error: [!] Rate limit exceeded (Code: 1003)
 *
 * What happened:
 *   Attempted: Get 15-min OHLC data for BTCUSDT
 *   During: /analyze BTC
 *
 * Why:
 *   You've exceeded the API rate limit (reset in 30s)
 *
 * Recovery:
 *   1. Wait 30 seconds and retry
 *   2. Try with longer timeframe: /analyze BTC 1h
 *   3. Check cached data: /cache status
 * ```
 */
export function formatErrorWithContext(ctx: ErrorContext): string {
  const lines: string[] = [];

  // Error header
  const codeStr = ctx.errorCode ? ` (Code: ${ctx.errorCode})` : "";
  lines.push(`Error: [!] ${ctx.reason}${codeStr}`);
  lines.push("");

  // What happened section
  lines.push("What happened:");
  lines.push(`  Attempted: ${ctx.attempted}`);
  lines.push(`  During: ${ctx.operation}`);
  lines.push("");

  // Why section
  lines.push("Why:");
  lines.push(`  ${ctx.reason}`);
  lines.push("");

  // Recovery section
  if (ctx.recoverySteps.length > 0) {
    lines.push("Recovery:");
    for (const step of ctx.recoverySteps) {
      let stepLine = `  ${step.step}. ${step.description}`;
      if (step.command) {
        stepLine += `: ${step.command}`;
      }
      if (step.waitSeconds) {
        stepLine += ` (wait ${step.waitSeconds}s)`;
      }
      lines.push(stepLine);
    }
  }

  return lines.join("\n");
}

/**
 * Create a quick error context for simple error messages
 * Use this when you don't have detailed operation context
 */
export function quickErrorContext(error: Error): ErrorContext {
  return createErrorContext(error, "operation", {});
}

// Note: detectErrorType and getSimilarSymbols are already exported via their function declarations above
