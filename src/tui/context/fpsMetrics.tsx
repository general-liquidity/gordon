import React, { createContext, useContext, useState, useEffect, useRef, type ReactNode } from "react";

// ============================================================================
// FPS Metrics Context — Tracks rendering performance
//
// Warns when FPS drops below 10 (market data overwhelming UI).
// Samples every 100ms, rolling average over last 50 samples.
// ============================================================================

interface FPSMetrics {
  currentFPS: number;
  avgFPS: number;
  lowFPS: number;
  isLagging: boolean;
}

const FPSContext = createContext<FPSMetrics>({
  currentFPS: 60,
  avgFPS: 60,
  lowFPS: 60,
  isLagging: false,
});

export function FPSMetricsProvider({ children }: { children: ReactNode }) {
  const [metrics, setMetrics] = useState<FPSMetrics>({
    currentFPS: 60,
    avgFPS: 60,
    lowFPS: 60,
    isLagging: false,
  });

  const samplesRef = useRef<number[]>([]);
  const lastFrameRef = useRef<number>(Date.now());

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const delta = now - lastFrameRef.current;
      lastFrameRef.current = now;

      const fps = delta > 0 ? 1000 / delta : 60;
      const samples = samplesRef.current;
      samples.push(fps);
      if (samples.length > 50) samples.shift();

      const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
      const low = Math.min(...samples);

      setMetrics({
        currentFPS: Math.round(fps),
        avgFPS: Math.round(avg),
        lowFPS: Math.round(low),
        isLagging: avg < 10,
      });
    }, 100);

    return () => clearInterval(interval);
  }, []);

  return <FPSContext.Provider value={metrics}>{children}</FPSContext.Provider>;
}

export function useFPSMetrics(): FPSMetrics {
  return useContext(FPSContext);
}
