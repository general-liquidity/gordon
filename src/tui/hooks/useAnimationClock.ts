/**
 * React hook that subscribes to the global AnimationClock.
 *
 * Components that need synchronized animations (spinners, progress bars,
 * market tickers) use this hook instead of their own setInterval. The
 * clock pauses when the terminal is scrolled up or backgrounded.
 *
 * Returns the current frame number — components re-render on each tick.
 */

import { useEffect, useState, useCallback } from "react";
import { getAnimationClock } from "../animations/animationClock.js";

/**
 * Subscribe to the global animation clock. Returns the current frame
 * number, which increments at `intervalMs` (default 100ms = 10fps).
 *
 * The component re-renders on each tick. Use sparingly — only for
 * components that actually animate (spinners, tickers).
 */
export function useAnimationClock(intervalMs: number = 50): number {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    // Pass 0 or negative to unsubscribe (pause animation)
    if (intervalMs <= 0) return;

    const clock = getAnimationClock();
    const unsub = clock.subscribe((f) => {
      setFrame(f);
    }, intervalMs);

    return unsub;
  }, [intervalMs]);

  return frame;
}

/**
 * Pause/resume the global animation clock. Use when the user scrolls
 * up to read history — animations should stop burning CPU.
 */
export function useAnimationPause(): {
  isPaused: boolean;
  pause: () => void;
  resume: () => void;
} {
  const [isPaused, setIsPaused] = useState(false);

  const pause = useCallback(() => {
    getAnimationClock().pause();
    setIsPaused(true);
  }, []);

  const resume = useCallback(() => {
    getAnimationClock().resume();
    setIsPaused(false);
  }, []);

  return { isPaused, pause, resume };
}
