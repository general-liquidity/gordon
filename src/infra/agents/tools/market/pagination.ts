/**
 * Result Pagination Utility
 *
 * Provides pagination utilities for array-returning tools to:
 * - Limit result size to prevent response bloat
 * - Support offset-based pagination
 * - Include total count and "has more" indicators
 * - Standardize pagination across all tools
 *
 * Usage:
 * - Use paginateResults() to paginate array data
 * - Use withPagination() to wrap tool executors
 * - Configure pagination per-tool using TOOL_PAGINATION_CONFIG
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Pagination parameters
 */
export interface PaginationParams {
  /** Number of items to return */
  limit?: number;
  /** Number of items to skip */
  offset?: number;
}

/**
 * Paginated result with metadata
 */
export interface PaginatedResult<T> {
  /** The paginated data items */
  items: T[];
  /** Pagination metadata */
  pagination: PaginationMetadata;
}

/**
 * Pagination metadata
 */
export interface PaginationMetadata {
  /** Total number of items (before pagination) */
  total: number;
  /** Number of items returned */
  count: number;
  /** Current offset (items skipped) */
  offset: number;
  /** Current limit (max items requested) */
  limit: number;
  /** Whether there are more items after this page */
  hasMore: boolean;
  /** Total number of pages */
  totalPages: number;
  /** Current page number (1-indexed) */
  currentPage: number;
}

/**
 * Pagination configuration for a tool
 */
export interface ToolPaginationConfig {
  /** Default limit if not specified */
  defaultLimit: number;
  /** Maximum allowed limit */
  maxLimit: number;
  /** Field name containing the array to paginate (dot notation supported) */
  arrayField: string;
}

// ============================================================================
// Constants
// ============================================================================

/** Default items per page */
const DEFAULT_LIMIT = 20;

/** Maximum items per page (to prevent response bloat) */
const MAX_LIMIT = 100;

// ============================================================================
// Per-Tool Pagination Configuration
// ============================================================================

/**
 * Pre-configured pagination settings by tool ID
 *
 * Guidelines:
 * - scan_market: Many results, lower default (10)
 * - history: Medium results, medium default (20)
 * - analysis: Fewer detailed results, higher default (20)
 * - trades: Many results, lower default (10)
 */
export const TOOL_PAGINATION_CONFIG: Record<string, ToolPaginationConfig> = {
  // Market scanning tools
  scan_market: {
    defaultLimit: 10,
    maxLimit: 50,
    arrayField: "opportunities",
  },
  scan_breakouts: {
    defaultLimit: 10,
    maxLimit: 50,
    arrayField: "breakouts",
  },
  find_consolidating_coins: {
    defaultLimit: 10,
    maxLimit: 50,
    arrayField: "coins",
  },
  detect_whale_activity: {
    defaultLimit: 10,
    maxLimit: 30,
    arrayField: "activities",
  },
  scan_for_strategies: {
    defaultLimit: 10,
    maxLimit: 30,
    arrayField: "results",
  },

  // History tools
  get_trade_history: {
    defaultLimit: 20,
    maxLimit: 100,
    arrayField: "trades",
  },
  get_transfer_history: {
    defaultLimit: 20,
    maxLimit: 50,
    arrayField: "deposits", // Note: may need custom handling for withdrawals
  },
  get_historical_opportunities: {
    defaultLimit: 20,
    maxLimit: 50,
    arrayField: "opportunities",
  },

  // Plan/trade listing
  list_plans: {
    defaultLimit: 10,
    maxLimit: 50,
    arrayField: "plans",
  },
  list_trades: {
    defaultLimit: 10,
    maxLimit: 50,
    arrayField: "trades",
  },

  // Strategy tools
  suggest_strategies: {
    defaultLimit: 5,
    maxLimit: 10,
    arrayField: "suggestions",
  },

  // Backtest tools
  compare_backtests: {
    defaultLimit: 10,
    maxLimit: 20,
    arrayField: "rankings",
  },
  rank_strategies_by_metric: {
    defaultLimit: 10,
    maxLimit: 20,
    arrayField: "rankings",
  },

  // Account tools
  get_account_balance: {
    defaultLimit: 20,
    maxLimit: 100,
    arrayField: "balances",
  },
};

// ============================================================================
// Pagination Functions
// ============================================================================

/**
 * Paginate an array of items
 *
 * @param items - Array of items to paginate
 * @param params - Pagination parameters
 * @param config - Optional pagination configuration
 * @returns Paginated result with metadata
 *
 * @example
 * ```typescript
 * const allTrades = await fetchTrades();
 * const paginated = paginateResults(allTrades, { limit: 10, offset: 20 });
 * // Returns trades 21-30 with metadata
 * ```
 */
export function paginateResults<T>(
  items: T[],
  params: PaginationParams = {},
  config?: Partial<ToolPaginationConfig>,
): PaginatedResult<T> {
  const defaultLimit = config?.defaultLimit ?? DEFAULT_LIMIT;
  const maxLimit = config?.maxLimit ?? MAX_LIMIT;

  // Apply limits with bounds checking
  const requestedLimit = params.limit ?? defaultLimit;
  const limit = Math.min(Math.max(1, requestedLimit), maxLimit);
  const offset = Math.max(0, params.offset ?? 0);

  // Calculate pagination
  const total = items.length;
  const paginatedItems = items.slice(offset, offset + limit);
  const count = paginatedItems.length;
  const hasMore = offset + count < total;
  const totalPages = Math.ceil(total / limit);
  const currentPage = Math.floor(offset / limit) + 1;

  return {
    items: paginatedItems,
    pagination: {
      total,
      count,
      offset,
      limit,
      hasMore,
      totalPages,
      currentPage,
    },
  };
}

/**
 * Extract pagination params from tool input
 *
 * @param input - Tool input object
 * @returns Extracted pagination params
 */
export function extractPaginationParams(input: Record<string, unknown>): PaginationParams {
  return {
    limit: typeof input.limit === "number" ? input.limit : undefined,
    offset: typeof input.offset === "number" ? input.offset : undefined,
  };
}

/**
 * Get a value from an object by dot-notation path
 *
 * @param obj - Object to get value from
 * @param path - Dot-notation path (e.g., "data.items")
 * @returns Value at path or undefined
 */
function getByPath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let current = obj;

  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Set a value in an object by dot-notation path
 *
 * @param obj - Object to modify
 * @param path - Dot-notation path
 * @param value - Value to set
 * @returns Modified object
 */
function setByPath<T extends Record<string, unknown>>(obj: T, path: string, value: unknown): T {
  const parts = path.split(".");
  const result = { ...obj };
  let current: Record<string, unknown> = result;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    if (typeof current[part] !== "object" || current[part] === null) {
      current[part] = {};
    }
    current[part] = { ...(current[part] as Record<string, unknown>) };
    current = current[part] as Record<string, unknown>;
  }

  const lastPart = parts[parts.length - 1]!;
  current[lastPart] = value;

  return result;
}

/**
 * Apply pagination to a tool result
 *
 * @param result - Tool result containing array to paginate
 * @param arrayField - Field name containing the array (dot notation supported)
 * @param params - Pagination parameters
 * @param config - Optional pagination configuration
 * @returns Modified result with pagination applied
 */
export function applyPaginationToResult<T extends Record<string, unknown>>(
  result: T,
  arrayField: string,
  params: PaginationParams = {},
  config?: Partial<ToolPaginationConfig>,
): T & { pagination?: PaginationMetadata } {
  const array = getByPath(result, arrayField);

  if (!Array.isArray(array)) {
    // No array to paginate, return as-is
    return result;
  }

  const paginated = paginateResults(array, params, config);

  // Update the result with paginated array and metadata
  const updatedResult = setByPath(result, arrayField, paginated.items);

  return {
    ...updatedResult,
    pagination: paginated.pagination,
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get pagination configuration for a tool
 *
 * @param toolId - Tool identifier
 * @returns Pagination config or default if none configured
 */
export function getToolPaginationConfig(toolId: string): ToolPaginationConfig | undefined {
  return TOOL_PAGINATION_CONFIG[toolId];
}

/**
 * Create a pagination summary string for user display
 *
 * @param metadata - Pagination metadata
 * @returns Human-readable pagination summary
 *
 * @example
 * // Returns "Showing 1-10 of 45 results (page 1 of 5)"
 * formatPaginationSummary({ total: 45, count: 10, offset: 0, ... })
 */
export function formatPaginationSummary(metadata: PaginationMetadata): string {
  const start = metadata.offset + 1;
  const end = metadata.offset + metadata.count;

  if (metadata.total === 0) {
    return "No results found.";
  }

  if (metadata.total === metadata.count) {
    return `Showing all ${metadata.total} result${metadata.total !== 1 ? "s" : ""}.`;
  }

  return `Showing ${start}-${end} of ${metadata.total} results (page ${metadata.currentPage} of ${metadata.totalPages})`;
}

/**
 * Generate next page params
 *
 * @param current - Current pagination metadata
 * @returns Params for next page, or null if no more pages
 */
export function getNextPageParams(current: PaginationMetadata): PaginationParams | null {
  if (!current.hasMore) {
    return null;
  }

  return {
    limit: current.limit,
    offset: current.offset + current.count,
  };
}

/**
 * Generate previous page params
 *
 * @param current - Current pagination metadata
 * @returns Params for previous page, or null if on first page
 */
export function getPreviousPageParams(current: PaginationMetadata): PaginationParams | null {
  if (current.offset === 0) {
    return null;
  }

  return {
    limit: current.limit,
    offset: Math.max(0, current.offset - current.limit),
  };
}

/**
 * Generate params for a specific page
 *
 * @param pageNumber - Target page number (1-indexed)
 * @param limit - Items per page
 * @returns Pagination params for the target page
 */
export function getPageParams(pageNumber: number, limit: number): PaginationParams {
  const page = Math.max(1, pageNumber);
  return {
    limit,
    offset: (page - 1) * limit,
  };
}

/**
 * Check if pagination metadata indicates this is the last page
 *
 * @param metadata - Pagination metadata
 * @returns Whether this is the last page
 */
export function isLastPage(metadata: PaginationMetadata): boolean {
  return !metadata.hasMore;
}

/**
 * Check if pagination metadata indicates this is the first page
 *
 * @param metadata - Pagination metadata
 * @returns Whether this is the first page
 */
export function isFirstPage(metadata: PaginationMetadata): boolean {
  return metadata.offset === 0;
}

/**
 * Calculate the total number of pages
 *
 * @param total - Total number of items
 * @param limit - Items per page
 * @returns Total number of pages
 */
export function calculateTotalPages(total: number, limit: number): number {
  if (total === 0 || limit <= 0) {
    return 0;
  }
  return Math.ceil(total / limit);
}

/**
 * Validate pagination parameters
 *
 * @param params - Pagination parameters to validate
 * @param config - Optional configuration for bounds checking
 * @returns Validation result with normalized params
 */
export function validatePaginationParams(
  params: PaginationParams,
  config?: Partial<ToolPaginationConfig>,
): {
  valid: boolean;
  errors: string[];
  normalizedParams: PaginationParams;
} {
  const errors: string[] = [];
  const defaultLimit = config?.defaultLimit ?? DEFAULT_LIMIT;
  const maxLimit = config?.maxLimit ?? MAX_LIMIT;

  let limit = params.limit ?? defaultLimit;
  let offset = params.offset ?? 0;

  // Validate and normalize limit
  if (typeof params.limit === "number") {
    if (params.limit < 1) {
      errors.push("Limit must be at least 1.");
      limit = 1;
    } else if (params.limit > maxLimit) {
      errors.push(`Limit cannot exceed ${maxLimit}. Using ${maxLimit} instead.`);
      limit = maxLimit;
    }
  }

  // Validate and normalize offset
  if (typeof params.offset === "number") {
    if (params.offset < 0) {
      errors.push("Offset cannot be negative.");
      offset = 0;
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    normalizedParams: { limit, offset },
  };
}
