import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "../ink-custom";

// ============================================================================
// OrderRecoveryNotice — Order failure with recovery / retry UI
//
// "Order failed: [reason]. Recovering... (attempt 2/5)"
// Countdown timer to next retry. Keyboard actions: Retry Now, Cancel, Details.
//
// Color: amber retrying, red failed, green recovered.
// ============================================================================

type RecoveryStatus = "retrying" | "failed" | "recovered";

interface Props {
  orderId: string;
  symbol: string;
  reason: string;
  attempt: number;
  maxAttempts: number;
  status: RecoveryStatus;
  /** Seconds until next automatic retry (only used when status=retrying) */
  nextRetryIn?: number;
  onRetryNow?: () => void;
  onCancel?: () => void;
  onViewDetails?: () => void;
}

const STATUS_CONFIG: Record<RecoveryStatus, { color: string; icon: string }> = {
  retrying:  { color: "yellow",  icon: "\u21BB" },  // ↻
  failed:    { color: "red",     icon: "\u2717" },  // ✗
  recovered: { color: "green",   icon: "\u2713" },  // ✓
};

export function OrderRecoveryNotice({
  orderId,
  symbol,
  reason,
  attempt,
  maxAttempts,
  status,
  nextRetryIn = 0,
  onRetryNow,
  onCancel,
  onViewDetails,
}: Props) {
  const cfg = STATUS_CONFIG[status]!;
  const [countdown, setCountdown] = useState(nextRetryIn);

  // Tick countdown when retrying
  useEffect(() => {
    if (status !== "retrying" || countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((c) => Math.max(0, c - 1)), 1000);
    return () => clearTimeout(timer);
  }, [countdown, status]);

  // Reset countdown when nextRetryIn prop changes
  useEffect(() => {
    setCountdown(nextRetryIn);
  }, [nextRetryIn]);

  // Keyboard shortcuts
  useInput((input, key) => {
    if (status === "recovered") return;
    if (input === "r" && onRetryNow) onRetryNow();
    if (input === "c" && onCancel) onCancel();
    if (input === "d" && onViewDetails) onViewDetails();
    if (key.escape && onCancel) onCancel();
  });

  const borderColor = cfg.color;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={borderColor}
      paddingX={1}
    >
      {/* Header */}
      <Box>
        <Text color={cfg.color} bold>
          {cfg.icon} Order {status === "recovered" ? "recovered" : "failed"}
        </Text>
        <Text dimColor>  {symbol} {"\u00b7"} {orderId}</Text>
      </Box>

      {/* Reason */}
      <Box marginTop={1}>
        <Text color={cfg.color}>{reason}</Text>
      </Box>

      {/* Attempt / countdown */}
      {status === "retrying" && (
        <Box marginTop={1}>
          <Text color="yellow">
            Recovering... (attempt {attempt}/{maxAttempts})
          </Text>
          {countdown > 0 && (
            <Text dimColor>  next retry in {countdown}s</Text>
          )}
        </Box>
      )}

      {status === "failed" && (
        <Box marginTop={1}>
          <Text color="red" bold>
            All {maxAttempts} attempts exhausted.
          </Text>
        </Box>
      )}

      {status === "recovered" && (
        <Box marginTop={1}>
          <Text color="green">
            Order recovered successfully on attempt {attempt}.
          </Text>
        </Box>
      )}

      {/* Action hints (only when not recovered) */}
      {status !== "recovered" && (
        <Box marginTop={1}>
          <Text dimColor>
            <Text bold color={cfg.color}>r</Text> retry now{" "}
            {"\u00b7"} <Text bold color={cfg.color}>c</Text> cancel{" "}
            {"\u00b7"} <Text bold color={cfg.color}>d</Text> details
          </Text>
        </Box>
      )}
    </Box>
  );
}
