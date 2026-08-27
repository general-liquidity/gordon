/**
 * useDoublePress — Detect double-press of a key within a timeout
 *
 * Returns a handler to call on each press, and a boolean indicating
 * whether a double-press was detected. After the timeout window
 * closes without a second press, the state resets.
 *
 * Used for Ctrl+C double-press to exit.
 *
 * Phase 3 of the 100% parity plan.
 */

import { useState, useCallback, useRef, useEffect } from "react";

const DEFAULT_TIMEOUT_MS = 500;

export interface DoublePressResult {
  /** Whether a double-press has been detected */
  isDoublePressed: boolean;
  /** Whether a single press is pending (waiting for second press) */
  isPending: boolean;
  /** Call this on each key press */
  onPress: () => void;
  /** Manually reset the state */
  reset: () => void;
}

export function useDoublePress(timeoutMs: number = DEFAULT_TIMEOUT_MS): DoublePressResult {
  const [isPending, setIsPending] = useState(false);
  const [isDoublePressed, setIsDoublePressed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const reset = useCallback(() => {
    setIsPending(false);
    setIsDoublePressed(false);
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const onPress = useCallback(() => {
    if (isPending) {
      // Second press within timeout — double-press detected
      setIsDoublePressed(true);
      setIsPending(false);
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    } else {
      // First press — start the timeout window
      setIsPending(true);
      setIsDoublePressed(false);
      timerRef.current = setTimeout(() => {
        setIsPending(false);
        timerRef.current = null;
      }, timeoutMs);
    }
  }, [isPending, timeoutMs]);

  return { isDoublePressed, isPending, onPress, reset };
}
