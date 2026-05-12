/**
 * React hook that wires FpsTracker into Ink's render cycle.
 *
 * Ink renders on state changes, not fixed frames. We sample at 100ms
 * intervals (same as Gordon's existing fpsMetrics.tsx pattern) and
 * record each tick as a "frame". Components can read current FPS
 * to detect if the TUI is lagging under heavy market data.
 */

import { useEffect, useState } from "react";
import { getFpsTracker, type FpsSnapshot } from "../../diagnostics/fpsTracker.js";

export interface FpsMetrics {
  avgFps: number;
  p1Fps: number;
  isLagging: boolean;
  droppedFrames: number;
}

/**
 * Track FPS and return live metrics. Updates every `updateIntervalMs`.
 * Default: sample every 100ms, report every 1000ms.
 */
export function useFpsTracker(updateIntervalMs: number = 1000): FpsMetrics {
  const [metrics, setMetrics] = useState<FpsMetrics>({
    avgFps: 60,
    p1Fps: 60,
    isLagging: false,
    droppedFrames: 0,
  });

  useEffect(() => {
    const tracker = getFpsTracker();

    // Sample "frames" at 100ms intervals
    const sampleInterval = setInterval(() => {
      tracker.recordFrame();
    }, 100);

    // Report metrics at the update interval
    const reportInterval = setInterval(() => {
      const snap: FpsSnapshot = tracker.snapshot();
      setMetrics({
        avgFps: snap.avgFps,
        p1Fps: snap.p1Fps,
        isLagging: snap.avgFps < 5,
        droppedFrames: snap.droppedFrames,
      });
    }, updateIntervalMs);

    return () => {
      clearInterval(sampleInterval);
      clearInterval(reportInterval);
    };
  }, [updateIntervalMs]);

  return metrics;
}
