import { useState, useRef, useCallback } from "react";
import { generateAwaySummary } from "../services/workflow/awaySummary.ts";

// ============================================================================
// useAwaySummary — Tracks terminal focus and generates recap after idle
// ============================================================================

interface AwayMessage {
  role?: string;
  content?: string;
  variant?: string;
  timestamp?: number;
}

interface AwayPosition {
  symbol?: string;
  pnl?: number;
  side?: string;
}

type SummaryGenerator = (
  messages: AwayMessage[],
  positions: AwayPosition[],
  awayDurationMs: number,
) => Promise<string>;

export interface UseAwaySummaryOptions {
  /** Recent activity since the user went away — fills/stops/alerts/signals. */
  getMessages?: () => AwayMessage[];
  /** Open positions, used for the P&L recap line. */
  getPositions?: () => AwayPosition[];
  /** Injectable summary generator (defaults to the real implementation). Overridable for tests. */
  generate?: SummaryGenerator;
  /** Idle threshold before a summary is produced (default 5 minutes). */
  idleThresholdMs?: number;
}

export function useAwaySummary(options: UseAwaySummaryOptions = {}) {
  const {
    getMessages,
    getPositions,
    generate = generateAwaySummary,
    idleThresholdMs = 5 * 60 * 1000,
  } = options;

  const [awaySummary, setAwaySummary] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<Error | null>(null);
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
      if (awayMs >= idleThresholdMs) {
        setIsGenerating(true);
        setError(null);
        summaryExistsRef.current = true;
        const messages = getMessages?.() ?? [];
        const positions = getPositions?.() ?? [];
        generate(messages, positions, awayMs)
          .then((summary) => {
            setAwaySummary(summary);
          })
          .catch((err: unknown) => {
            setError(err instanceof Error ? err : new Error(String(err)));
            summaryExistsRef.current = false;
          })
          .finally(() => {
            setIsGenerating(false);
          });
      }
    }
    blurredAtRef.current = null;
  }, [generate, getMessages, getPositions, idleThresholdMs]);

  const dismiss = useCallback(() => {
    setAwaySummary(null);
    setError(null);
    summaryExistsRef.current = false;
  }, []);

  return { awaySummary, isGenerating, error, dismiss, markBlurred, markFocused };
}
