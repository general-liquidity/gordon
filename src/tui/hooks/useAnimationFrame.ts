/**
 * useAnimationFrame — Shared 50ms clock for TUI animations
 *
 * Provides a tick counter that increments every 50ms (20fps) while
 * active. All animation consumers share a single interval, reducing
 * timer overhead. The clock pauses when no subscribers are active.
 *
 * Phase 3 of the 100% parity plan.
 */

import { useState, useEffect, useRef, useCallback } from "react";

const FRAME_INTERVAL_MS = 50;

// ============================================================================
// Shared global clock — singleton across all hook instances
// ============================================================================

type TickListener = (tick: number) => void;

let globalTick = 0;
let globalInterval: ReturnType<typeof setInterval> | null = null;
const globalListeners: Set<TickListener> = new Set();

function startGlobalClock(): void {
  if (globalInterval !== null) return;
  globalInterval = setInterval(() => {
    globalTick++;
    for (const listener of globalListeners) {
      listener(globalTick);
    }
  }, FRAME_INTERVAL_MS);
}

function stopGlobalClock(): void {
  if (globalInterval === null) return;
  clearInterval(globalInterval);
  globalInterval = null;
}

function subscribeGlobalClock(listener: TickListener): () => void {
  globalListeners.add(listener);
  if (globalListeners.size === 1) {
    startGlobalClock();
  }
  return () => {
    globalListeners.delete(listener);
    if (globalListeners.size === 0) {
      stopGlobalClock();
    }
  };
}

// ============================================================================
// useAnimationFrame — hook into the shared clock
// ============================================================================

export interface AnimationFrameResult {
  /** Current tick counter (increments every 50ms while active) */
  tick: number;
  /** Elapsed milliseconds since first activation (approximate) */
  elapsedMs: number;
  /** Normalized cycle position 0..1 for a given period (in ticks) */
  cycle: (period: number) => number;
}

/**
 * Subscribe to the shared animation clock.
 *
 * @param isActive  Whether this consumer is currently animating (default true)
 * @returns         Tick counter, elapsed ms, and a cycle helper
 *
 * @example
 *   const { tick, cycle } = useAnimationFrame(isStreaming);
 *   const pulseOpacity = cycle(20); // 0..1 over 20 ticks (1 second)
 */
export function useAnimationFrame(isActive: boolean = true): AnimationFrameResult {
  const [tick, setTick] = useState(0);
  const startTickRef = useRef(globalTick);

  useEffect(() => {
    if (!isActive) return;

    startTickRef.current = globalTick;

    const unsubscribe = subscribeGlobalClock((currentTick) => {
      setTick(currentTick);
    });

    return unsubscribe;
  }, [isActive]);

  const elapsedMs = (tick - startTickRef.current) * FRAME_INTERVAL_MS;

  const cycle = useCallback(
    (period: number): number => {
      if (period <= 0) return 0;
      return (tick % period) / period;
    },
    [tick],
  );

  return { tick, elapsedMs, cycle };
}
