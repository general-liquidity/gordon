import { useRef, useEffect } from "react";
import { notify } from "../services/notifier.js";

// ============================================================================
// useNotifyAfterTimeout — Desktop notification after user inactivity
// ============================================================================

export function useNotifyAfterTimeout(
  title: string,
  body: string,
  options: { timeoutMs?: number; enabled?: boolean } = {},
): void {
  const { timeoutMs = 6000, enabled = true } = options;
  const lastInteractionRef = useRef<number>(Date.now());

  // Track user activity
  useEffect(() => {
    const onData = () => {
      lastInteractionRef.current = Date.now();
    };
    process.stdin.on("data", onData);
    return () => {
      process.stdin.off("data", onData);
    };
  }, []);

  useEffect(() => {
    if (!enabled || !title) return;

    const timer = setTimeout(() => {
      const elapsed = Date.now() - lastInteractionRef.current;
      if (elapsed >= timeoutMs) {
        notify(title, body);
      }
    }, timeoutMs);

    return () => clearTimeout(timer);
  }, [title, body, timeoutMs, enabled]);
}
