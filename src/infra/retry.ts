/**
 * Retry and Circuit Breaker Utilities
 *
 * Provides robust error recovery for API calls with:
 * - Exponential backoff with jitter
 * - Circuit breaker pattern
 * - Retryable error classification
 */

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterFactor: number;
  retryableErrors: Set<string | number>;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 100,
  maxDelayMs: 5000,
  jitterFactor: 0.3,
  retryableErrors: new Set([
    // Binance rate limit codes
    -1003, // TOO_MANY_REQUESTS
    -1015, // TOO_MANY_ORDERS
    // Network errors
    "ECONNREFUSED",
    "ECONNRESET",
    "ETIMEDOUT",
    "ENOTFOUND",
    "EAI_AGAIN",
    // HTTP status codes
    408, // Request Timeout
    429, // Too Many Requests
    500, // Internal Server Error
    502, // Bad Gateway
    503, // Service Unavailable
    504, // Gateway Timeout
  ]),
};

export interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeoutMs: number;
  halfOpenMaxCalls: number;
}

export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 30000,
  halfOpenMaxCalls: 1,
};

type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private failureCount = 0;
  private lastFailureTime = 0;
  private halfOpenCalls = 0;
  private config: CircuitBreakerConfig;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config };
  }

  canExecute(): boolean {
    if (this.state === "CLOSED") return true;

    if (this.state === "OPEN") {
      const timeSinceFailure = Date.now() - this.lastFailureTime;
      if (timeSinceFailure >= this.config.resetTimeoutMs) {
        this.state = "HALF_OPEN";
        this.halfOpenCalls = 0;
        return true;
      }
      return false;
    }

    // HALF_OPEN
    return this.halfOpenCalls < this.config.halfOpenMaxCalls;
  }

  recordSuccess(): void {
    this.failureCount = 0;
    this.state = "CLOSED";
    this.halfOpenCalls = 0;
  }

  recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === "HALF_OPEN") {
      this.state = "OPEN";
    } else if (this.failureCount >= this.config.failureThreshold) {
      this.state = "OPEN";
    }
  }

  getState(): CircuitState {
    return this.state;
  }

  reset(): void {
    this.state = "CLOSED";
    this.failureCount = 0;
    this.halfOpenCalls = 0;
  }
}

export class RetryError extends Error {
  constructor(
    message: string,
    public readonly attempts: number,
    public readonly lastError: Error,
  ) {
    super(message);
    this.name = "RetryError";
  }
}

export class CircuitOpenError extends Error {
  constructor(message = "Circuit breaker is open") {
    super(message);
    this.name = "CircuitOpenError";
  }
}

function calculateDelay(attempt: number, config: RetryConfig): number {
  const exponentialDelay = config.baseDelayMs * 2 ** attempt;
  const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs);
  const jitter = cappedDelay * config.jitterFactor * (Math.random() - 0.5);
  return Math.max(0, cappedDelay + jitter);
}

function isRetryableError(error: unknown, config: RetryConfig): boolean {
  if (error instanceof Error) {
    // Check error code (network errors)
    const code = (error as Error & { code?: string }).code;
    if (code && config.retryableErrors.has(code)) {
      return true;
    }

    // Check Binance error codes
    const binanceCode = (error as Error & { code?: number }).code;
    if (typeof binanceCode === "number" && config.retryableErrors.has(binanceCode)) {
      return true;
    }

    // Check HTTP status
    const status = (error as Error & { status?: number }).status;
    if (status && config.retryableErrors.has(status)) {
      return true;
    }

    // Check for rate limit in message
    if (error.message.toLowerCase().includes("rate limit")) {
      return true;
    }

    // Check for network-related messages
    if (
      error.message.includes("ECONNREFUSED") ||
      error.message.includes("ETIMEDOUT") ||
      error.message.includes("network")
    ) {
      return true;
    }
  }

  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a function with retry logic
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {},
): Promise<T> {
  const fullConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= fullConfig.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt === fullConfig.maxRetries || !isRetryableError(error, fullConfig)) {
        throw lastError;
      }

      const delay = calculateDelay(attempt, fullConfig);
      await sleep(delay);
    }
  }

  throw new RetryError(
    `Failed after ${fullConfig.maxRetries + 1} attempts`,
    fullConfig.maxRetries + 1,
    lastError!,
  );
}

/**
 * Execute a function with circuit breaker and retry logic
 */
export async function withCircuitBreaker<T>(
  fn: () => Promise<T>,
  circuitBreaker: CircuitBreaker,
  retryConfig: Partial<RetryConfig> = {},
): Promise<T> {
  if (!circuitBreaker.canExecute()) {
    throw new CircuitOpenError();
  }

  try {
    const result = await withRetry(fn, retryConfig);
    circuitBreaker.recordSuccess();
    return result;
  } catch (error) {
    circuitBreaker.recordFailure();
    throw error;
  }
}

/**
 * Create a retryable version of an async function
 */
export function makeRetryable<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  config: Partial<RetryConfig> = {},
): (...args: TArgs) => Promise<TResult> {
  return (...args: TArgs) => withRetry(() => fn(...args), config);
}

/**
 * Extract retry-after delay from error or headers
 */
export function extractRetryAfter(error: unknown): number | null {
  if (error instanceof Error) {
    const retryAfter = (error as Error & { retryAfter?: number }).retryAfter;
    if (typeof retryAfter === "number") {
      return retryAfter;
    }
  }
  return null;
}
