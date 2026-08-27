import { useState, useCallback } from "react";

// Rate limit notification hook — alerts when exchange or LLM API is throttled
// Trading-critical: rate limits can prevent order execution

export interface RateLimitEvent {
  provider: string;
  weight: number;
  limit: number;
  resetMs: number;
  timestamp: number;
}

export function useRateLimitNotification() {
  const [events, setEvents] = useState<RateLimitEvent[]>([]);
  const [isThrottled, setIsThrottled] = useState(false);

  const recordRateLimit = useCallback(
    (provider: string, weight: number, limit: number, resetMs: number) => {
      const event: RateLimitEvent = { provider, weight, limit, resetMs, timestamp: Date.now() };
      setEvents((prev) => [...prev.slice(-10), event]); // Keep last 10
      setIsThrottled(true);
      // Auto-clear after reset
      setTimeout(() => setIsThrottled(false), resetMs);
    },
    [],
  );

  const dismiss = useCallback(() => setIsThrottled(false), []);

  const latestEvent = events.length > 0 ? events[events.length - 1]! : null;

  return { isThrottled, latestEvent, events, recordRateLimit, dismiss };
}
