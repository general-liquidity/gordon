import React from "react";
import { Box, Text } from "ink";
import { Spinner } from "@inkjs/ui";
import type { Mode } from "../types/index.ts";
import { COLORS } from "./theme.ts";
import { TradingModeIndicator, ConnectionStatus, StatusBadge } from "./components/VisualStatus.tsx";

type ConnectionStatus = "connected" | "disconnected" | "connecting";

/**
 * Thread info for status bar display
 */
export interface ThreadStatusInfo {
  /** Thread name/label to display */
  name: string;
  /** Number of messages in the thread */
  messageCount: number;
  /** Whether this is a branch/clone of another thread */
  isBranch: boolean;
}

interface StatusBarProps {
  mode: Mode;
  portfolioValue?: number;
  connectionStatus?: ConnectionStatus;
  currency?: string;
  btcPrice?: number;
  /** Thread info for display */
  threadInfo?: ThreadStatusInfo;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  mode,
  portfolioValue,
  connectionStatus = "disconnected",
  currency = "USDT",
  btcPrice,
  threadInfo,
}) => {
  // Format portfolio value
  const formatValue = (value: number | undefined): string => {
    if (value === undefined) return "---";
    return value.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  // Format BTC price
  const formatBtcPrice = (price: number | undefined): string => {
    if (price === undefined) return "---";
    return price.toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  };

  return (
    <Box
      borderStyle="single"
      borderColor={COLORS.TAN_DIM}
      paddingX={1}
      justifyContent="space-between"
      width="100%"
    >
      {/* Left section: Mode Badge with Visual Hierarchy */}
      <Box gap={1}>
        <Text color={COLORS.DIM}>Mode:</Text>
        <TradingModeIndicator 
          mode={mode} 
          animate={true}
        />
      </Box>

      {/* BTC Price */}
      <Box gap={1}>
        <Text color={COLORS.DIM}>BTC:</Text>
        <Text color={COLORS.HIGHLIGHT} bold>
          ${formatBtcPrice(btcPrice)}
        </Text>
      </Box>

      {/* Portfolio */}
      <Box gap={1}>
        <Text color={COLORS.DIM}>Portfolio:</Text>
        <Text color={COLORS.WHITE} bold>
          ${formatValue(portfolioValue)}
        </Text>
      </Box>

      {/* Thread Indicator with Visual Status */}
      {threadInfo && (
        <Box gap={1}>
          <Text color={COLORS.DIM}>Thread:</Text>
          <StatusBadge 
            level={threadInfo.isBranch ? "warning" : "info"}
            label={threadInfo.name}
            animate={threadInfo.isBranch}
          />
          <Text color={COLORS.DIM}>(#{threadInfo.messageCount})</Text>
        </Box>
      )}

      {/* Right section: Connection Status with Visual Hierarchy */}
      <Box gap={1}>
        <Text color={COLORS.DIM}>API:</Text>
        {connectionStatus === "connecting" ? (
          <Spinner label="Connecting..." />
        ) : (
          <ConnectionStatus
            status={connectionStatus}
            service=""
            animate={false}
          />
        )}
      </Box>
    </Box>
  );
};

export default StatusBar;
