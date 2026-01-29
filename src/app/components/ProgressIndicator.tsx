/**
 * Progress Indicator Component
 * Uses ink-ui ProgressBar for operations with known progress
 */

import React from "react";
import { Box, Text } from "ink";
import { ProgressBar, Spinner } from "@inkjs/ui";
import { COLORS } from "../theme.ts";

interface ProgressIndicatorProps {
  label: string;
  progress?: number; // 0-100, undefined for indeterminate
  status?: string;
}

export const ProgressIndicator: React.FC<ProgressIndicatorProps> = ({
  label,
  progress,
  status,
}) => {
  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      {progress !== undefined ? (
        // Determinate progress
        <Box flexDirection="column" gap={1}>
          <Box gap={2}>
            <Text color={COLORS.ACCENT}>{label}</Text>
            <Text color={COLORS.DIM}>{progress}%</Text>
          </Box>
          <ProgressBar value={progress} />
          {status && (
            <Text color={COLORS.DIM}>{status}</Text>
          )}
        </Box>
      ) : (
        // Indeterminate spinner
        <Spinner label={label} />
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
    placing: "Placing order on Binance...",
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
          <Text color={COLORS.RED} bold>Order Failed</Text>
          {error && <Text color={COLORS.DIM}>{error}</Text>}
        </Box>
      ) : status === "complete" ? (
        <Box flexDirection="column">
          <Text color={COLORS.GREEN} bold>Order Executed</Text>
          {orderId && (
            <Box>
              <Text color={COLORS.DIM}>Order ID: </Text>
              <Text color={COLORS.WHITE}>{orderId}</Text>
            </Box>
          )}
        </Box>
      ) : (
        <Box flexDirection="column" gap={1}>
          <Spinner label={statusLabels[status]} />
          {statusProgress[status] && (
            <ProgressBar value={statusProgress[status]!} />
          )}
        </Box>
      )}
    </Box>
  );
};

export default ProgressIndicator;
