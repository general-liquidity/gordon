/**
 * Progress Indicator Component
 * Uses ink-ui ProgressBar for operations with known progress
 * Enhanced with elapsed time display and cancel functionality
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Box, Text, useInput } from "ink";
import { ProgressBar, Spinner } from "@inkjs/ui";
import { COLORS } from "../theme.ts";

/**
 * Format elapsed time in human-readable format
 */
function formatElapsedTime(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

interface ProgressIndicatorProps {
  label: string;
  progress?: number; // 0-100, undefined for indeterminate
  status?: string;
  /** Show elapsed time after this many seconds (default: 2) */
  showElapsedAfter?: number;
  /** Callback when cancel is requested */
  onCancel?: () => void;
  /** Whether the cancel button is active */
  cancellable?: boolean;
  /** Operation start time (for elapsed calculation) */
  startTime?: Date;
}

export const ProgressIndicator: React.FC<ProgressIndicatorProps> = ({
  label,
  progress,
  status,
  showElapsedAfter = 2,
  onCancel,
  cancellable = false,
  startTime,
}) => {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [showElapsed, setShowElapsed] = useState(false);
  const startTimeRef = useRef(startTime || new Date());

  // Update elapsed time
  useEffect(() => {
    const start = startTimeRef.current;

    const updateElapsed = () => {
      const now = new Date();
      const elapsed = Math.floor((now.getTime() - start.getTime()) / 1000);
      setElapsedSeconds(elapsed);

      // Show elapsed time after threshold
      if (elapsed >= showElapsedAfter && !showElapsed) {
        setShowElapsed(true);
      }
    };

    // Initial update
    updateElapsed();

    // Update every second
    const interval = setInterval(updateElapsed, 1000);

    return () => clearInterval(interval);
  }, [showElapsedAfter, showElapsed]);

  // Handle cancel input
  useInput((input, key) => {
    if (cancellable && onCancel) {
      if (key.escape || input === "c" || input === "C") {
        onCancel();
      }
    }
  }, { isActive: cancellable });

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      {progress !== undefined ? (
        // Determinate progress
        <Box flexDirection="column" gap={1}>
          <Box gap={2} justifyContent="space-between">
            <Box gap={2}>
              <Text color={COLORS.ACCENT}>{label}</Text>
              <Text color={COLORS.HIGHLIGHT} bold>{progress}%</Text>
            </Box>
            {showElapsed && (
              <Text color={COLORS.DIM}>
                {formatElapsedTime(elapsedSeconds)}
              </Text>
            )}
          </Box>
          <ProgressBar value={progress} />
          {status && (
            <Text color={COLORS.DIM}>{status}</Text>
          )}
          {cancellable && onCancel && (
            <Box marginTop={1}>
              <Text color={COLORS.DIM}>
                Press <Text color={COLORS.HIGHLIGHT}>Esc</Text> or{" "}
                <Text color={COLORS.HIGHLIGHT}>C</Text> to cancel
              </Text>
            </Box>
          )}
        </Box>
      ) : (
        // Indeterminate spinner with elapsed time
        <Box flexDirection="column" gap={1}>
          <Box gap={2} justifyContent="space-between">
            <Box>
              <Spinner label={label} />
            </Box>
            {showElapsed && (
              <Text color={COLORS.DIM}>
                {formatElapsedTime(elapsedSeconds)}
              </Text>
            )}
          </Box>
          {status && (
            <Text color={COLORS.DIM}>{status}</Text>
          )}
          {cancellable && onCancel && (
            <Box>
              <Text color={COLORS.DIM}>
                Press <Text color={COLORS.HIGHLIGHT}>Esc</Text> or{" "}
                <Text color={COLORS.HIGHLIGHT}>C</Text> to cancel
              </Text>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
};

/**
 * Scan Progress Component
 * Shows progress during market scanning
 */
interface ScanProgressProps {
  coinsScanned: number;
  totalCoins: number;
  currentSymbol?: string;
}

export const ScanProgress: React.FC<ScanProgressProps> = ({
  coinsScanned,
  totalCoins,
  currentSymbol,
}) => {
  const progress = Math.round((coinsScanned / totalCoins) * 100);

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={COLORS.ACCENT_DIM}
      paddingX={2}
      paddingY={1}
      marginX={1}
    >
      <Box gap={2} marginBottom={1}>
        <Text color={COLORS.WHITE} bold>Scanning Market</Text>
        <Text color={COLORS.DIM}>
          {coinsScanned}/{totalCoins} coins
        </Text>
      </Box>

      <ProgressBar value={progress} />

      {currentSymbol && (
        <Box marginTop={1}>
          <Text color={COLORS.DIM}>Current: </Text>
          <Text color={COLORS.HIGHLIGHT}>{currentSymbol}</Text>
        </Box>
      )}
    </Box>
  );
};

/**
 * Order Execution Progress
 * Shows progress during order placement
 */
interface OrderProgressProps {
  status: "validating" | "placing" | "confirming" | "complete" | "error";
  orderId?: string;
  error?: string;
}

export const OrderProgress: React.FC<OrderProgressProps> = ({
  status,
  orderId,
  error,
}) => {
  const statusLabels: Record<typeof status, string> = {
    validating: "Validating order parameters...",
    placing: "Placing order on exchange...",
    confirming: "Confirming execution...",
    complete: "Order executed successfully!",
    error: "Order failed",
  };

  const statusProgress: Record<typeof status, number | undefined> = {
    validating: 25,
    placing: 50,
    confirming: 75,
    complete: 100,
    error: undefined,
  };

  // Status indicator text that complements the border color for accessibility
  const statusText = status === "error" ? "[ERROR]" : status === "complete" ? "[SUCCESS]" : "[IN PROGRESS]";

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={status === "error" ? COLORS.RED : status === "complete" ? COLORS.GREEN : COLORS.ACCENT_DIM}
      paddingX={2}
      paddingY={1}
      marginX={1}
    >
      {status === "error" ? (
        <Box flexDirection="column">
          <Text color={COLORS.RED} bold>{statusText} Order Failed</Text>
          {error && <Text color={COLORS.DIM}>{error}</Text>}
        </Box>
      ) : status === "complete" ? (
        <Box flexDirection="column">
          <Text color={COLORS.GREEN} bold>{statusText} Order Executed</Text>
          {orderId && (
            <Box>
              <Text color={COLORS.DIM}>Order ID: </Text>
              <Text color={COLORS.WHITE}>{orderId}</Text>
            </Box>
          )}
        </Box>
      ) : (
        <Box flexDirection="column" gap={1}>
          <Text color={COLORS.DIM}>{statusText}</Text>
          <Spinner label={statusLabels[status]} />
          {statusProgress[status] && (
            <ProgressBar value={statusProgress[status]!} />
          )}
        </Box>
      )}
    </Box>
  );
};

/**
 * Streaming Progress Indicator
 * For streaming operations that show real-time progress
 */
interface StreamingProgressProps {
  /** Current operation label */
  operation: string;
  /** Optional tool currently being called */
  currentTool?: string | null;
  /** Whether streaming is active */
  isStreaming: boolean;
  /** Callback when cancel is requested */
  onCancel?: () => void;
  /** Show elapsed time after this many seconds (default: 2) */
  showElapsedAfter?: number;
}

export const StreamingProgress: React.FC<StreamingProgressProps> = ({
  operation,
  currentTool,
  isStreaming,
  onCancel,
  showElapsedAfter = 2,
}) => {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [showElapsed, setShowElapsed] = useState(false);
  const startTimeRef = useRef(new Date());

  // Reset start time when streaming starts
  useEffect(() => {
    if (isStreaming) {
      startTimeRef.current = new Date();
      setElapsedSeconds(0);
      setShowElapsed(false);
    }
  }, [isStreaming]);

  // Update elapsed time while streaming
  useEffect(() => {
    if (!isStreaming) return;

    const updateElapsed = () => {
      const now = new Date();
      const elapsed = Math.floor((now.getTime() - startTimeRef.current.getTime()) / 1000);
      setElapsedSeconds(elapsed);

      if (elapsed >= showElapsedAfter && !showElapsed) {
        setShowElapsed(true);
      }
    };

    updateElapsed();
    const interval = setInterval(updateElapsed, 1000);

    return () => clearInterval(interval);
  }, [isStreaming, showElapsedAfter, showElapsed]);

  // Handle cancel input
  useInput((input, key) => {
    if (isStreaming && onCancel) {
      if (key.escape || input === "c" || input === "C") {
        onCancel();
      }
    }
  }, { isActive: isStreaming && !!onCancel });

  if (!isStreaming) {
    return null;
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={COLORS.ACCENT_DIM}
      paddingX={2}
      paddingY={1}
      marginX={1}
    >
      {/* Main operation spinner */}
      <Box justifyContent="space-between">
        <Box>
          <Spinner label={operation} />
        </Box>
        {showElapsed && (
          <Text color={COLORS.DIM}>
            {formatElapsedTime(elapsedSeconds)}
          </Text>
        )}
      </Box>

      {/* Current tool indicator */}
      {currentTool && (
        <Box marginTop={1}>
          <Text color={COLORS.DIM}>Running: </Text>
          <Text color={COLORS.HIGHLIGHT}>{currentTool}</Text>
        </Box>
      )}

      {/* Cancel hint */}
      {onCancel && showElapsed && (
        <Box marginTop={1}>
          <Text color={COLORS.MUTED}>
            Press <Text color={COLORS.DIM}>Esc</Text> to cancel
          </Text>
        </Box>
      )}
    </Box>
  );
};

/**
 * Hook to manage operation timing
 */
export function useOperationTimer(options: {
  showAfterMs?: number;
  onLongOperation?: (elapsedSeconds: number) => void;
} = {}): {
  start: () => void;
  stop: () => void;
  reset: () => void;
  elapsedSeconds: number;
  isLongRunning: boolean;
  isRunning: boolean;
} {
  const [isRunning, setIsRunning] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const startTimeRef = useRef<Date | null>(null);
  const showAfterSeconds = (options.showAfterMs ?? 2000) / 1000;

  useEffect(() => {
    if (!isRunning || !startTimeRef.current) return;

    const interval = setInterval(() => {
      const now = new Date();
      const elapsed = Math.floor((now.getTime() - startTimeRef.current!.getTime()) / 1000);
      setElapsedSeconds(elapsed);

      if (elapsed >= showAfterSeconds && options.onLongOperation) {
        options.onLongOperation(elapsed);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isRunning, showAfterSeconds, options.onLongOperation]);

  const start = useCallback(() => {
    startTimeRef.current = new Date();
    setElapsedSeconds(0);
    setIsRunning(true);
  }, []);

  const stop = useCallback(() => {
    setIsRunning(false);
  }, []);

  const reset = useCallback(() => {
    startTimeRef.current = null;
    setElapsedSeconds(0);
    setIsRunning(false);
  }, []);

  return {
    start,
    stop,
    reset,
    elapsedSeconds,
    isLongRunning: elapsedSeconds >= showAfterSeconds,
    isRunning,
  };
}

export default ProgressIndicator;
