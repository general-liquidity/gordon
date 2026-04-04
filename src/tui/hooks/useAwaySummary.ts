import { useState, useRef, useCallback, useEffect } from "react";

// ============================================================================
// useAwaySummary — Tracks terminal focus and generates recap after idle
// ============================================================================

export function useAwaySummary() {
  const [awaySummary, setAwaySummary] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const blurredAtRef = useRef<number | null>(null);
  const summaryExistsRef = useRef(false);

  const markBlurred = useCallback(() => {
    if (!blurredAtRef.current) {
      blurredAtRef.current = Date.now();
    }
  }, []);

  const markFocused = useCallback(() => {
    if (blurredAtRef.current && !summaryExistsRef.current) {
      const awayMs = Date.now() - blurredAtRef.current;
      if (awayMs >= 5 * 60 * 1000) {
        // 5 minutes idle — generate summary
        setIsGenerating(true);
        summaryExistsRef.current = true;
        // Placeholder summary (would call LLM in production)
        setTimeout(() => {
          const minutes = Math.round(awayMs / 60000);
          setAwaySummary(`You were away for ${minutes} minutes. Check your positions for any changes.`);
          setIsGenerating(false);
        }, 500);
      }
    }
    blurredAtRef.current = null;
  }, []);

  const dismiss = useCallback(() => {
    setAwaySummary(null);
    summaryExistsRef.current = false;
  }, []);

  return { awaySummary, isGenerating, dismiss, markBlurred, markFocused };
}
