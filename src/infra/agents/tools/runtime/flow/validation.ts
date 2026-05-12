/**
 * Tool Input Validation Wrapper
 *
 * Provides input validation utilities for agent tools including:
 * - Symbol format validation (must end in USDT, BTC, etc.)
 * - Amount range validation
 * - Percentage validation
 * - Common pattern validation
 * - User-friendly error messages
 *
 * Usage:
 * - Use validateToolInput() to validate input before tool execution
 * - Use withValidation() to wrap tool executors with automatic validation
 * - Configure validation rules per-tool using TOOL_VALIDATION_CONFIG
 */

import type { MastraExecutionContext } from "../../types.ts";

// ============================================================================
// Types
// ============================================================================

/**
 * Validation rule definition
 */
export interface ValidationRule {
  /** Field name to validate */
  field: string;
  /** Validation function - receives unknown value, should do its own type checking */
  validate: (value: unknown) => boolean;
  /** Error message if validation fails */
  message: string;
  /** Whether field is required */
  required?: boolean;
}

/**
 * Validation result
 */
export interface ValidationResult {
  /** Whether validation passed */
  valid: boolean;
  /** Validation errors if any */
  errors: string[];
}

/**
 * Tool executor function signature
 */
export type ToolExecutor<TInput, TOutput> = (
  input: TInput,
  context?: MastraExecutionContext
) => Promise<TOutput>;

/**
 * Validation configuration for a tool
 */
export interface ToolValidationConfig {
  /** Rules to apply */
  rules: ValidationRule[];
  /** Whether to skip validation if field is missing */
  skipMissingFields?: boolean;
}

// ============================================================================
// Common Validators
// ============================================================================

/**
 * Valid quote currencies for trading pairs
 */
const VALID_QUOTE_CURRENCIES = [
  "USDT",
  "USDC",
  "BUSD",
  "BTC",
  "ETH",
  "BNB",
  "EUR",
  "GBP",
  "AUD",
  "TRY",
];

/**
 * Check if a value is a valid trading symbol
 */
export function isValidSymbol(value: unknown): boolean {
  if (typeof value !== "string" || value.length < 5) {
    return false;
  }
  const upper = value.toUpperCase();
  return VALID_QUOTE_CURRENCIES.some((quote) => upper.endsWith(quote));
}

/**
 * Check if a value can be normalized to a valid trading symbol
 * (allows base currency only, like "BTC" which becomes "BTCUSDT")
 */
export function isValidSymbolOrBase(value: unknown): boolean {
  if (typeof value !== "string" || value.length < 2) {
    return false;
  }
  const upper = value.toUpperCase();
  // Either already a valid symbol or can be normalized to one
  return (
    isValidSymbol(upper) ||
    (!VALID_QUOTE_CURRENCIES.some((q) => upper.endsWith(q)) && /^[A-Z0-9]+$/.test(upper))
  );
}

/**
 * Check if a value is a valid amount (positive number)
 */
export function isValidAmount(value: unknown): boolean {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return false;
  }
  return value > 0;
}

/**
 * Check if a value is within an amount range
 */
export function isAmountInRange(value: unknown, min: number, max: number): boolean {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return false;
  }
  return value >= min && value <= max;
}

/**
 * Check if a value is a valid percentage (0-1 or 0-100)
 */
export function isValidPercentage(value: unknown, normalized = true): boolean {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return false;
  }
  if (normalized) {
    return value >= 0 && value <= 1;
  }
  return value >= 0 && value <= 100;
}

/**
 * Check if a value is a valid timeframe string
 */
export function isValidTimeframe(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  const validTimeframes = [
    "1m",
    "3m",
    "5m",
    "15m",
    "30m",
    "1h",
    "2h",
    "4h",
    "6h",
    "8h",
    "12h",
    "1d",
    "3d",
    "1w",
    "1M",
  ];
  return validTimeframes.includes(value);
}

/**
 * Check if a value is a valid risk level
 */
export function isValidRiskLevel(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  return ["low", "medium", "high"].includes(value.toLowerCase());
}

/**
 * Check if a value is a valid date string (ISO format)
 */
export function isValidDateString(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  const date = new Date(value);
  return !Number.isNaN(date.getTime());
}

/**
 * Check if a value is a positive integer
 */
export function isPositiveInteger(value: unknown): boolean {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return false;
  }
  return Number.isInteger(value) && value > 0;
}

/**
 * Check if a value is within a valid integer range
 */
export function isIntegerInRange(value: unknown, min: number, max: number): boolean {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return false;
  }
  return Number.isInteger(value) && value >= min && value <= max;
}

// ============================================================================
// Pre-built Validation Rules
// ============================================================================

/**
 * Common validation rules that can be reused across tools
 */
export const commonValidationRules: Record<string, ValidationRule> = {
  /**
   * Symbol must be a valid trading pair
   */
  symbol: {
    field: "symbol",
    validate: isValidSymbolOrBase,
    message:
      "Invalid trading symbol. Must be a base currency (e.g., 'BTC', 'ETH') or trading pair (e.g., 'BTCUSDT', 'ETHBTC').",
    required: true,
  },

  /**
   * Symbol must end with a valid quote currency
   */
  symbolStrict: {
    field: "symbol",
    validate: isValidSymbol,
    message:
      "Invalid trading pair format. Must end with a valid quote currency (USDT, BTC, ETH, BNB, etc.).",
    required: true,
  },

  /**
   * Amount must be positive
   */
  amount: {
    field: "amount",
    validate: isValidAmount,
    message: "Amount must be a positive number greater than 0.",
    required: false,
  },

  /**
   * Allocation percent (0-1)
   */
  allocationPercent: {
    field: "allocationPercent",
    validate: (v: unknown) => typeof v === "number" && isValidPercentage(v, true),
    message: "Allocation percent must be between 0 and 1 (e.g., 0.1 for 10%).",
    required: false,
  },

  /**
   * Percentage (0-100)
   */
  percentageWhole: {
    field: "percent",
    validate: (v: unknown) => typeof v === "number" && isValidPercentage(v, false),
    message: "Percentage must be between 0 and 100.",
    required: false,
  },

  /**
   * Timeframe validation
   */
  timeframe: {
    field: "timeframe",
    validate: isValidTimeframe,
    message:
      "Invalid timeframe. Valid options: 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 8h, 12h, 1d, 3d, 1w, 1M.",
    required: false,
  },

  /**
   * Timeframes array validation
   */
  timeframes: {
    field: "timeframes",
    validate: (v: unknown) => Array.isArray(v) && v.every(isValidTimeframe),
    message:
      "Invalid timeframes. Each must be one of: 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 8h, 12h, 1d, 3d, 1w, 1M.",
    required: false,
  },

  /**
   * Risk level validation
   */
  riskLevel: {
    field: "riskLevel",
    validate: isValidRiskLevel,
    message: "Invalid risk level. Must be 'low', 'medium', or 'high'.",
    required: false,
  },

  /**
   * Days validation (1-365)
   */
  days: {
    field: "days",
    validate: (v: unknown) => typeof v === "number" && isIntegerInRange(v, 1, 365),
    message: "Days must be an integer between 1 and 365.",
    required: false,
  },

  /**
   * Days back validation (1-30)
   */
  daysBack: {
    field: "daysBack",
    validate: (v: unknown) => typeof v === "number" && isIntegerInRange(v, 1, 30),
    message: "Days back must be an integer between 1 and 30.",
    required: false,
  },

  /**
   * Limit validation (1-100)
   */
  limit: {
    field: "limit",
    validate: (v: unknown) => typeof v === "number" && isIntegerInRange(v, 1, 100),
    message: "Limit must be an integer between 1 and 100.",
    required: false,
  },

  /**
   * Top N validation (10-200)
   */
  topN: {
    field: "topN",
    validate: (v: unknown) => typeof v === "number" && isIntegerInRange(v, 10, 200),
    message: "Top N must be an integer between 10 and 200.",
    required: false,
  },

  /**
   * Confidence validation (0-1)
   */
  confidence: {
    field: "minConfidence",
    validate: (v: unknown) => typeof v === "number" && isValidPercentage(v, true),
    message: "Confidence must be between 0 and 1.",
    required: false,
  },

  /**
   * Initial capital validation ($100 - $10,000,000)
   */
  initialCapital: {
    field: "initialCapital",
    validate: (v: unknown) => typeof v === "number" && isAmountInRange(v, 100, 10_000_000),
    message: "Initial capital must be between $100 and $10,000,000.",
    required: false,
  },

  /**
   * Commission rate validation (0-0.05)
   */
  commission: {
    field: "commission",
    validate: (v: unknown) => typeof v === "number" && isAmountInRange(v, 0, 0.05),
    message: "Commission rate must be between 0 and 0.05 (5%).",
    required: false,
  },

  /**
   * Grid levels validation (3-7)
   */
  gridLevels: {
    field: "numLevels",
    validate: (v: unknown) => typeof v === "number" && isIntegerInRange(v, 3, 7),
    message: "Number of grid levels must be between 3 and 7.",
    required: false,
  },

  /**
   * Date string validation
   */
  dateString: {
    field: "date",
    validate: isValidDateString,
    message: "Invalid date format. Use ISO format (e.g., '2024-01-15').",
    required: false,
  },
};

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate tool input against a set of rules
 *
 * @param input - The input object to validate
 * @param rules - Array of validation rules to apply
 * @param options - Validation options
 * @returns Validation result with errors if any
 *
 * @example
 * ```typescript
 * const result = validateToolInput(
 *   { symbol: "BTCUSDT", amount: 100 },
 *   [commonValidationRules.symbol, commonValidationRules.amount]
 * );
 *
 * if (!result.valid) {
 *   return { error: result.errors.join("; ") };
 * }
 * ```
 */
export function validateToolInput(
  input: Record<string, unknown>,
  rules: ValidationRule[],
  options: { skipMissingFields?: boolean } = {}
): ValidationResult {
  const errors: string[] = [];
  const { skipMissingFields = true } = options;

  for (const rule of rules) {
    const value = input[rule.field];

    // Check if field is present
    if (value === undefined || value === null || value === "") {
      if (rule.required) {
        errors.push(`Missing required field: ${rule.field}. ${rule.message}`);
      }
      // Skip validation if field is missing and we allow that
      if (skipMissingFields) {
        continue;
      }
    }

    // Run validation
    if (value !== undefined && value !== null && value !== "") {
      try {
        if (!rule.validate(value)) {
          errors.push(rule.message);
        }
      } catch {
        errors.push(`Validation error for ${rule.field}: ${rule.message}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Create a customized validation rule
 *
 * @param field - Field name
 * @param validate - Validation function
 * @param message - Error message
 * @param required - Whether field is required
 * @returns Validation rule
 *
 * @example
 * ```typescript
 * const minAmountRule = createValidationRule(
 *   "amount",
 *   (v) => typeof v === "number" && v >= 10,
 *   "Amount must be at least $10.",
 *   true
 * );
 * ```
 */
export function createValidationRule(
  field: string,
  validate: (value: unknown) => boolean,
  message: string,
  required = false
): ValidationRule {
  return { field, validate, message, required };
}

// ============================================================================
// Wrapper Functions
// ============================================================================

/**
 * Wrap a tool executor with input validation
 *
 * If validation fails, returns an error object instead of executing the tool.
 *
 * @param executor - The original tool executor
 * @param rules - Validation rules to apply
 * @param options - Validation options
 * @returns Wrapped executor with validation
 *
 * @example
 * ```typescript
 * const validatedExecutor = withValidation(
 *   originalExecutor,
 *   [commonValidationRules.symbol, commonValidationRules.amount]
 * );
 * ```
 */
export function withValidation<TInput extends Record<string, unknown>, TOutput>(
  executor: ToolExecutor<TInput, TOutput>,
  rules: ValidationRule[],
  options: { skipMissingFields?: boolean } = {}
): ToolExecutor<TInput, TOutput | { error: string }> {
  return async function validatedExecutor(
    input: TInput,
    context?: MastraExecutionContext
  ): Promise<TOutput | { error: string }> {
    const result = validateToolInput(input, rules, options);

    if (!result.valid) {
      return { error: `Validation failed: ${result.errors.join("; ")}` };
    }

    return executor(input, context);
  };
}

// ============================================================================
// Tool-Specific Validation Configurations
// ============================================================================

/**
 * Pre-configured validation rules by tool type
 *
 * Use these with withValidation() for consistent validation across tools.
 */
export const TOOL_VALIDATION_CONFIG: Record<string, ToolValidationConfig> = {
  // Market analysis tools
  scan_market: {
    rules: [commonValidationRules.topN!, commonValidationRules.timeframes!],
  },
  analyze_coin: {
    rules: [commonValidationRules.symbol!, commonValidationRules.timeframes!],
  },

  // Trading tools
  create_plan: {
    rules: [
      commonValidationRules.symbol!,
      commonValidationRules.riskLevel!,
      commonValidationRules.allocationPercent!,
    ],
  },
  create_grid_plan: {
    rules: [
      commonValidationRules.symbol!,
      commonValidationRules.amount!,
      commonValidationRules.gridLevels!,
    ],
  },

  // Backtest tools
  run_backtest: {
    rules: [
      commonValidationRules.symbol!,
      commonValidationRules.timeframe!,
      commonValidationRules.days!,
      commonValidationRules.initialCapital!,
      commonValidationRules.commission!,
    ],
  },
  optimize_strategy: {
    rules: [commonValidationRules.symbol!, commonValidationRules.timeframe!],
  },
  compare_backtests: {
    rules: [commonValidationRules.symbol!, commonValidationRules.timeframe!],
  },

  // History tools
  get_trade_history: {
    rules: [{ ...commonValidationRules.symbol!, required: false }, commonValidationRules.limit!],
  },
  get_historical_opportunities: {
    rules: [commonValidationRules.daysBack!, commonValidationRules.confidence!],
  },

  // Technical analysis tools
  get_rsi: {
    rules: [commonValidationRules.symbol!, commonValidationRules.timeframe!],
  },
  get_macd: {
    rules: [commonValidationRules.symbol!, commonValidationRules.timeframe!],
  },
  get_bollinger_bands: {
    rules: [commonValidationRules.symbol!, commonValidationRules.timeframe!],
  },
  get_technical_analysis: {
    rules: [commonValidationRules.symbol!, commonValidationRules.timeframes!],
  },
};

/**
 * Get validation config for a tool
 *
 * @param toolId - Tool identifier
 * @returns Validation config or undefined if none configured
 */
export function getToolValidationConfig(toolId: string): ToolValidationConfig | undefined {
  return TOOL_VALIDATION_CONFIG[toolId];
}

/**
 * Format validation errors for user display
 *
 * @param errors - Array of error messages
 * @returns Formatted error string
 */
export function formatValidationErrors(errors: string[]): string {
  if (errors.length === 0) {
    return "";
  }
  if (errors.length === 1) {
    return errors[0]!;
  }
  return `Multiple validation errors:\n${errors.map((e, i) => `${i + 1}. ${e}`).join("\n")}`;
}
