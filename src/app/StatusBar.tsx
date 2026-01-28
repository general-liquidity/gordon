import React from "react";
import { Box, Text } from "ink";
import type { Mode } from "../types/index.ts";

// Color palette
const COLORS = {
  TAN: "#d4a27f",
  TAN_DIM: "#b8896a",
  WHITE: "#e8e4de",
  DIM: "#a39e93",
  GREEN: "#4ade80",
  RED: "#ef4444",
  YELLOW: "#facc15",
} as const;

type ConnectionStatus = "connected" | "disconnected" | "connecting";

interface StatusBarProps {
  mode: Mode;
  portfolioValue?: number;
  connectionStatus?: ConnectionStatus;
  currency?: string;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  mode,
  portfolioValue,
  connectionStatus = "disconnected",
  currency = "USDT",
}) => {
  // Mode styling
  const modeColor = mode === "ARMED" ? COLORS.RED : COLORS.GREEN;
  const modeLabel = mode === "ARMED" ? "[ARMED]" : "[SAFE]";

  // Connection status styling
  const getConnectionColor = (status: ConnectionStatus) => {
    switch (status) {
      case "connected":
        return COLORS.GREEN;
      case "connecting":
        return COLORS.YELLOW;
      case "disconnected":
        return COLORS.RED;
    }
  };

  const getConnectionIcon = (status: ConnectionStatus) => {
    switch (status) {
      case "connected":
        return "●";
      case "connecting":
        return "◐";
      case "disconnected":
        return "○";
    }
  };

  // Format portfolio value
  const formatValue = (value: number | undefined): string => {
    if (value === undefined) return "---";
    return value.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
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
      {/* Left section: Mode */}
      <Box>
        <Text color={COLORS.DIM}>Mode: </Text>
        <Text color={modeColor} bold>
          {modeLabel}
        </Text>
      </Box>

      {/* Center section: Portfolio */}
      <Box>
        <Text color={COLORS.DIM}>Portfolio: </Text>
        <Text color={COLORS.WHITE} bold>
          {formatValue(portfolioValue)}
        </Text>
        <Text color={COLORS.DIM}> {currency}</Text>
      </Box>

      {/* Right section: Connection */}
      <Box>
        <Text color={getConnectionColor(connectionStatus)}>
          {getConnectionIcon(connectionStatus)}
        </Text>
        <Text color={COLORS.DIM}> {connectionStatus}</Text>
      </Box>
    </Box>
  );
};

export default StatusBar;
