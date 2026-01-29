import React from "react";
import { Box, Text } from "ink";
import { Badge, Spinner } from "@inkjs/ui";
import type { Mode } from "../types/index.ts";
import { COLORS } from "./theme.ts";

type ConnectionStatus = "connected" | "disconnected" | "connecting";

interface StatusBarProps {
  mode: Mode;
  portfolioValue?: number;
  connectionStatus?: ConnectionStatus;
  currency?: string;
  btcPrice?: number;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  mode,
  portfolioValue,
  connectionStatus = "disconnected",
  currency = "USDT",
  btcPrice,
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
      {/* Left section: Mode Badge */}
      <Box gap={1}>
        <Text color={COLORS.DIM}>Mode:</Text>
        <Badge color={mode === "ARMED" ? "red" : "green"}>
          {mode === "ARMED" ? "ARMED" : "SAFE"}
        </Badge>
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

      {/* Right section: Connection Badge */}
      <Box gap={1}>
        {connectionStatus === "connecting" ? (
          <Spinner label="connecting" />
        ) : (
          <Badge color={connectionStatus === "connected" ? "green" : "red"}>
            {connectionStatus}
          </Badge>
        )}
      </Box>
    </Box>
  );
};

export default StatusBar;
