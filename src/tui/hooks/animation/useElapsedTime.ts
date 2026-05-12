/**
 * useElapsedTime — Timer during streaming with 100ms updates
 *
 * Returns elapsed seconds since the timer was started. Updates every
 * 100ms for smooth display in status bars and progress indicators.
 * Automatically stops and resets when `isActive` becomes false.
 *
 * Phase 3 of the 100% parity plan.
 */

import { useState, useEffect, useRef, useCallback } from "react";

const UPDATE_INTERVAL_MS = 100;

export interface ElapsedTimeResult {
  /** Elapsed time in seconds (2 decimal places precision) */
  elapsed: number;
  /** Elapsed time formatted as "X.Xs" */
  formatted: string;
  /** Manually reset the timer */
  reset: () => void;
}

export function useElapsedTime(isActive: boolean): ElapsedTimeResult {
  const [elapsed, setElapsed] = useState(0);
  const startTimeRef = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Start/stop the timer based on isActive
  useEffect(() => {
    if (isActive) {
      startTimeRef.current = Date.now();
      setElapsed(0);

      intervalRef.current = setInterval(() => {
        if (startTimeRef.current !== null) {
          const ms = Date.now() - startTimeRef.current;
          setElapsed(Math.round(ms / 100) / 10); // round to 1 decimal
        }
      }, UPDATE_INTERVAL_MS);
    } else {
      // Stop timer
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      startTimeRef.current = null;
    }

    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isActive]);

  const reset = useCallback(() => {
    setElapsed(0);
    startTimeRef.current = isActive ? Date.now() : null;
  }, [isActive]);

  const formatted = formatElapsed(elapsed);

  return { elapsed, formatted, reset };
}

/**
 * Format elapsed seconds the same way Claude Code formats durations:
 *  - <60s    → "5s", "23s", "0s"
 *  - >=60s   → "1m 45s", "12m 3s"
 *  - >=3600s → "1h 5m", "2h 0m"
 *
 * No decimals once we cross 1s — long-running operations don't need
 * sub-second precision.
 */
export function formatElapsed(seconds: number): string {
  if (seconds < 1) return `${seconds.toFixed(1)}s`;
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return s === 0 ? `${m}m` : `${m}m ${s}s`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
