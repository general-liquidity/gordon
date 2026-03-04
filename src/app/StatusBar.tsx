import React from "react";
import { Box, Text } from "ink";
import { Spinner } from "@inkjs/ui";
import type { Mode } from "../types/index.ts";
import { COLORS } from "./theme.ts";
import { TradingModeIndicator, ConnectionStatus, StatusBadge } from "./components/VisualStatus.tsx";
import { TickerTape, type TickerItem } from "./components/effects/index.ts";
import { StrategyRuntime } from "../core/runtime/index.ts";

type ConnectionStatusType = "connected" | "disconnected" | "connecting";

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

export interface ChainStatusInfo {
  solana: boolean;
  polkadot: boolean;
  chainlink: boolean;
  evm: boolean;
  /** CDP AgentKit configured (Base smart wallets, onchain execution) */
  cdp: boolean;
  /** Base L2 read tools enhanced (Basescan API key or CDP configured) */
  base: boolean;
}

interface StatusBarProps {
  mode: Mode;
  portfolioValue?: number;
  connectionStatus?: ConnectionStatusType;
  btcPrice?: number;
  /** Thread info for display */
  threadInfo?: ThreadStatusInfo;
  /** Ticker items for the scrolling price banner */
  tickerItems?: TickerItem[];
  /** Which blockchain networks are configured */
  chainStatus?: ChainStatusInfo;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  mode,
  portfolioValue,
  connectionStatus = "disconnected",
  btcPrice,
  threadInfo,
  tickerItems,
  chainStatus,
}) => {
  // Format portfolio value
  const formatValue = (value: number | undefined): string => {
    if (value === undefined) return "---";
    return value.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  // Get active strategy count (safe — runtime may not be initialized)
  let activeStrategies = 0;
  try {
    const runtime = StrategyRuntime.getInstance();
    activeStrategies = runtime.getActiveSlots().length;
  } catch {
    /* runtime not initialized */
  }

  // Format BTC price
  const formatBtcPrice = (price: number | undefined): string => {
    if (price === undefined) return "---";
    return price.toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  };

  return (
    <Box flexDirection="column" width="100%">
      {/* Scrolling ticker tape — only shown when items are available */}
      {tickerItems && tickerItems.length > 0 && (
        <TickerTape items={tickerItems} speed={150} position="top" />
      )}

      {/* Main status bar */}
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
          {activeStrategies > 0 && (
            <Text color={COLORS.DIM}>[<Text color={COLORS.ACCENT_DIM}>{activeStrategies} active</Text>]</Text>
          )}
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

        {/* Chain Status Indicators */}
        {chainStatus && (chainStatus.solana || chainStatus.polkadot || chainStatus.chainlink || chainStatus.evm || chainStatus.cdp || chainStatus.base) && (
          <Box gap={1}>
            <Text color={COLORS.DIM}>Chains:</Text>
            {chainStatus.solana && <Text color={COLORS.GREEN} bold>SOL</Text>}
            {chainStatus.polkadot && <Text color={COLORS.GREEN} bold>DOT</Text>}
            {chainStatus.chainlink && <Text color={COLORS.GREEN} bold>CL</Text>}
            {chainStatus.evm && <Text color={COLORS.GREEN} bold>EVM</Text>}
            {chainStatus.cdp && <Text color={COLORS.GREEN} bold>CDP</Text>}
            {chainStatus.base && !chainStatus.cdp && <Text color={COLORS.GREEN} bold>BASE</Text>}
          </Box>
        )}

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
    </Box>
  );
};

export default StatusBar;
