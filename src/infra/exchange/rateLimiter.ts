// ============================================================================
// Exchange Rate Limiter — Token bucket with per-exchange limits
//
// Prevents IP bans from burst trading. Each exchange has configured limits.
// Token bucket refills continuously. Async acquire() queues when empty.
// ============================================================================

export interface RateLimiterConfig {
  maxRequests: number;
  windowMs: number;
  burstLimit?: number;
}

export const EXCHANGE_LIMITS: Record<string, RateLimiterConfig> = {
  binance:      { maxRequests: 1200, windowMs: 60_000, burstLimit: 50 },
  binance_us:   { maxRequests: 1200, windowMs: 60_000, burstLimit: 50 },
  coinbase:     { maxRequests: 10,   windowMs: 1_000,  burstLimit: 10 },
  kraken:       { maxRequests: 15,   windowMs: 1_000,  burstLimit: 15 },
  hyperliquid:  { maxRequests: 1200, windowMs: 60_000, burstLimit: 50 },
  bitfinex:     { maxRequests: 90,   windowMs: 60_000, burstLimit: 20 },
  robinhood:    { maxRequests: 1,    windowMs: 1_000,  burstLimit: 1 },
};

interface QueuedRequest {
  resolve: () => void;
  weight: number;
}

export class RateLimiter {
  private tokens: number;
  private readonly maxTokens: number;
  private readonly refillRate: number; // tokens per ms
  private lastRefill: number;
  private queue: QueuedRequest[] = [];
  private drainTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: RateLimiterConfig) {
    this.maxTokens = config.burstLimit ?? config.maxRequests;
    this.tokens = this.maxTokens;
    this.refillRate = config.maxRequests / config.windowMs;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }

  async acquire(weight = 1): Promise<void> {
    this.refill();

    if (this.tokens >= weight) {
      this.tokens -= weight;
      return;
    }

    // Queue the request and wait
    return new Promise<void>((resolve) => {
      this.queue.push({ resolve, weight });
      this.ensureDrainTimer();
    });
  }

  tryAcquire(weight = 1): boolean {
    this.refill();
    if (this.tokens >= weight) {
      this.tokens -= weight;
      return true;
    }
    return false;
  }

  getWaitTime(weight = 1): number {
    this.refill();
    if (this.tokens >= weight) return 0;
    const deficit = weight - this.tokens;
    return Math.ceil(deficit / this.refillRate);
  }

  shouldThrottle(): boolean {
    this.refill();
    return this.tokens < 1;
  }

  getStatus(): { used: number; limit: number; remaining: number; resetMs: number } {
    this.refill();
    return {
      used: Math.round(this.maxTokens - this.tokens),
      limit: this.maxTokens,
      remaining: Math.round(this.tokens),
      resetMs: this.tokens < this.maxTokens ? Math.ceil((this.maxTokens - this.tokens) / this.refillRate) : 0,
    };
  }

  reset(): void {
    this.tokens = this.maxTokens;
    this.lastRefill = Date.now();
    // Drain all queued requests
    for (const req of this.queue) req.resolve();
    this.queue = [];
  }

  dispose(): void {
    if (this.drainTimer) {
      clearInterval(this.drainTimer);
      this.drainTimer = null;
    }
    this.reset();
  }

  private ensureDrainTimer(): void {
    if (this.drainTimer) return;
    this.drainTimer = setInterval(() => {
      this.refill();
      while (this.queue.length > 0 && this.tokens >= this.queue[0]!.weight) {
        const req = this.queue.shift()!;
        this.tokens -= req.weight;
        req.resolve();
      }
      if (this.queue.length === 0 && this.drainTimer) {
        clearInterval(this.drainTimer);
        this.drainTimer = null;
      }
    }, 50);
  }
}

// Singleton cache per exchange
const limiters = new Map<string, RateLimiter>();

export function createExchangeRateLimiter(exchangeId: string): RateLimiter {
  const existing = limiters.get(exchangeId);
  if (existing) return existing;

  const config = EXCHANGE_LIMITS[exchangeId] ?? { maxRequests: 30, windowMs: 60_000, burstLimit: 10 };
  const limiter = new RateLimiter(config);
  limiters.set(exchangeId, limiter);
  return limiter;
}
