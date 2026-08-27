/**
 * useShimmerAnimation — Character sweep glimmer effect
 *
 * Produces a shimmer index that sweeps across a text string, creating
 * a glimmer/highlight effect character by character. Uses the shared
 * animation clock from useAnimationFrame.
 *
 * Phase 3 of the 100% parity plan.
 */

import { useMemo } from "react";
import { useAnimationFrame } from "./useAnimationFrame.js";

export interface ShimmerAnimationResult {
  /** Current shimmer position (character index in the sweep) */
  shimmerIndex: number;
  /**
   * For a given character index, returns a brightness multiplier 0..1.
   * Characters near shimmerIndex are bright, others are dim.
   */
  getBrightness: (charIndex: number) => number;
  /** Whether the shimmer is currently active */
  isActive: boolean;
  /** Current animation tick */
  tick: number;
}

/**
 * @param textLength     Length of the text being shimmered
 * @param isActive       Whether the shimmer animation should run
 * @param speed          Ticks per character advance (default 2 = 100ms per char)
 * @param glowRadius     How many characters around the shimmer point are lit (default 3)
 */
export function useShimmerAnimation(
  textLength: number,
  isActive: boolean = true,
  speed: number = 2,
  glowRadius: number = 3,
): ShimmerAnimationResult {
  const { tick } = useAnimationFrame(isActive);

  // The sweep length includes overshoot so the glow fades off both edges
  const sweepLength = textLength + glowRadius * 2;

  // Current shimmer position in the sweep
  const shimmerIndex =
    isActive && sweepLength > 0 ? (Math.floor(tick / speed) % sweepLength) - glowRadius : -1;

  const getBrightness = useMemo(() => {
    return (charIndex: number): number => {
      if (!isActive || shimmerIndex < -glowRadius) return 0;
      const distance = Math.abs(charIndex - shimmerIndex);
      if (distance > glowRadius) return 0;
      // Linear falloff: 1.0 at center, 0.0 at edge of radius
      return 1.0 - distance / (glowRadius + 1);
    };
  }, [isActive, shimmerIndex, glowRadius]);

  return {
    shimmerIndex,
    getBrightness,
    isActive,
    tick,
  };
}
