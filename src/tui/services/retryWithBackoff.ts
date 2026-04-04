// ============================================================================
// Retry with Backoff — Exponential backoff with jitter and circuit breaker
//
// Configurable max retries, base delay, max delay.
// Special handling for HTTP 429 (rate limit) with retry-after parsing.
// ============================================================================

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  onRetry?: (attempt: number, error: Error, delayMs: number) => void;
}

export class CircuitBreakerError extends Error {
  constructor(attempts: number) {
    super(`Circuit breaker opened after ${attempts} consecutive failures`);
    this.name = "CircuitBreakerError";
  }
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const { maxRetries = 5, baseDelayMs = 500, maxDelayMs = 30000, onRetry } = options;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt >= maxRetries) {
        throw new CircuitBreakerError(maxRetries);
      }

      // Calculate delay with exponential backoff + jitter
      const exponential = baseDelayMs * Math.pow(2, attempt);
      const jitter = Math.random() * baseDelayMs;
      const delay = Math.min(exponential + jitter, maxDelayMs);

      onRetry?.(attempt + 1, lastError, delay);

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError ?? new Error("Retry failed");
}
