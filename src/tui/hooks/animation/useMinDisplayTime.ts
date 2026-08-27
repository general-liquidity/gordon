import { useState, useRef, useEffect } from "react";

// ============================================================================
// useMinDisplayTime — Guarantees each value stays visible for minimum N ms
// ============================================================================

export function useMinDisplayTime<T>(value: T, minTimeMs = 500): T {
  const [displayed, setDisplayed] = useState(value);
  const lastUpdateRef = useRef(Date.now());
  const pendingRef = useRef<T | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const elapsed = Date.now() - lastUpdateRef.current;

    if (elapsed >= minTimeMs) {
      setDisplayed(value);
      lastUpdateRef.current = Date.now();
      pendingRef.current = null;
    } else {
      pendingRef.current = value;
      if (!timerRef.current) {
        timerRef.current = setTimeout(() => {
          if (pendingRef.current !== null) {
            setDisplayed(pendingRef.current);
            lastUpdateRef.current = Date.now();
            pendingRef.current = null;
          }
          timerRef.current = null;
        }, minTimeMs - elapsed);
      }
    }

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [value, minTimeMs]);

  return displayed;
}
