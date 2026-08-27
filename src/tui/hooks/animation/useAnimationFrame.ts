/**
 * useAnimationFrame — DEPRECATED: redirects to the unified AnimationClock
 *
 * This was the second clock implementation. Now unified with animationClock.ts
 * to prevent out-of-sync animations (Claude Code uses a single shared clock).
 *
 * Kept for backward compat — any component importing this gets the same clock.
 */

import { useAnimationClock } from "./useAnimationClock.js";

export interface AnimationFrameResult {
  tick: number;
  elapsedMs: number;
  cycle: (period: number) => number;
}

/**
 * Subscribe to the shared animation clock.
 * Now redirects to the unified AnimationClock instead of maintaining a separate timer.
 */
export function useAnimationFrame(isActive: boolean = true): AnimationFrameResult {
  const frame = useAnimationClock(isActive ? 50 : 0);

  return {
    tick: frame,
    elapsedMs: frame * 50,
    cycle: (period: number) => (period > 0 ? (frame % period) / period : 0),
  };
}
