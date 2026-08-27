import { useRef, useCallback } from "react";

const ACCEL_THRESHOLD_MS = 80; // faster than this = accelerate
const RESET_THRESHOLD_MS = 300; // slower than this = reset
const MAX_ACCEL = 8; // cap multiplier at 8x

interface AccelState {
  lastPressMs: number;
  level: number;
}

export function useScrollAcceleration() {
  const up = useRef<AccelState>({ lastPressMs: 0, level: 1 });
  const down = useRef<AccelState>({ lastPressMs: 0, level: 1 });

  const getAcceleratedDelta = useCallback((direction: "up" | "down", baseStep: number): number => {
    const state = direction === "up" ? up.current : down.current;
    const other = direction === "up" ? down.current : up.current;
    const now = Date.now();
    const interval = now - state.lastPressMs;

    // Reset other direction
    other.level = 1;

    if (interval < ACCEL_THRESHOLD_MS) {
      state.level = Math.min(state.level + 1, MAX_ACCEL);
    } else if (interval > RESET_THRESHOLD_MS) {
      state.level = 1;
    }
    state.lastPressMs = now;
    return baseStep * state.level;
  }, []);

  return { getAcceleratedDelta };
}
