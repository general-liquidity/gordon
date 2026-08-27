/**
 * useStalledAnimation — Red intensity ramp after inactivity
 *
 * Detects when an operation has stalled (no new data for a threshold
 * duration) and produces a red intensity value that ramps up over time.
 * Used to indicate to the user that something may be stuck.
 *
 * Phase 3 of the 100% parity plan.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useAnimationFrame } from "./useAnimationFrame.js";

const DEFAULT_STALL_THRESHOLD_MS = 3000;
const MAX_RAMP_DURATION_MS = 10_000;

export interface StalledAnimationResult {
  /** Whether the operation is considered stalled */
  isStalled: boolean;
  /** Red intensity 0..1 (ramps from 0 to 1 over MAX_RAMP_DURATION after stall) */
  intensity: number;
  /** Milliseconds since last activity */
  stalledMs: number;
  /** Call this to signal that new activity has occurred (resets the timer) */
  ping: () => void;
}

/**
 * @param isActive            Whether the operation is running (stall detection only applies when active)
 * @param stallThresholdMs    How long without a ping before we consider it stalled (default 3000ms)
 */
export function useStalledAnimation(
  isActive: boolean = true,
  stallThresholdMs: number = DEFAULT_STALL_THRESHOLD_MS,
): StalledAnimationResult {
  const [isStalled, setIsStalled] = useState(false);
  const lastPingRef = useRef<number>(Date.now());
  useAnimationFrame(isActive);

  // Reset on activation change
  useEffect(() => {
    if (isActive) {
      lastPingRef.current = Date.now();
      setIsStalled(false);
    } else {
      setIsStalled(false);
    }
  }, [isActive]);

  // Check for stall on each tick
  const now = Date.now();
  const msSinceLastPing = now - lastPingRef.current;
  const stalled = isActive && msSinceLastPing >= stallThresholdMs;

  // Update stalled state if it changed
  useEffect(() => {
    setIsStalled(stalled);
  }, [stalled]);

  // Calculate intensity: ramp from 0 to 1 over MAX_RAMP_DURATION after stall starts
  const stalledMs = stalled ? msSinceLastPing - stallThresholdMs : 0;
  const intensity = stalled ? Math.min(1, stalledMs / MAX_RAMP_DURATION_MS) : 0;

  const ping = useCallback(() => {
    lastPingRef.current = Date.now();
    setIsStalled(false);
  }, []);

  return {
    isStalled,
    intensity,
    stalledMs,
    ping,
  };
}
