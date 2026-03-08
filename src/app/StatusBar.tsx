import React from "react";
import { Box, Text } from "ink";
import type { Mode } from "../types/index.ts";
import type { CredentialProfile } from "../infra/actions/types.ts";
import { COLORS } from "./theme.ts";
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

export interface OperatorStatusInfo {
  modelLabel: string;
  credentialProfile: CredentialProfile;
  activeVenueLabel: string;
  requestState: "idle" | "loading" | "streaming";
  queueDepth: number;
  configScopeLabel: string;
  activeProfile?: string | null;
  activityStatus?: string | null;
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
  operatorStatus?: OperatorStatusInfo;
}

interface StatusColumnProps {
  width: number;
  label: string;
  value: string;
  valueColor?: string;
  valueBold?: boolean;
  paddingRight?: number;
}

const StatusColumn: React.FC<StatusColumnProps> = ({
  width,
  label,
  value,
  valueColor = COLORS.WHITE,
  valueBold = false,
  paddingRight = 1,
}) => (
  <Box width={width} paddingRight={paddingRight}>
    <Text color={COLORS.DIM}>{label}: </Text>
    <Text color={valueColor} bold={valueBold} wrap="truncate-end">
      {value}
    </Text>
  </Box>
);

export const StatusBar: React.FC<StatusBarProps> = ({
  mode,
  portfolioValue,
  connectionStatus = "disconnected",
  btcPrice,
  threadInfo,
  tickerItems,
  chainStatus,
  operatorStatus,
}) => {
  const stdoutWidth = process.stdout.columns ?? 160;

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

  const innerWidth = Math.max(80, stdoutWidth - 4);
  const modeColumnWidth = Math.max(10, Math.floor(innerWidth * 0.26));
  const btcColumnWidth = Math.max(10, Math.floor(innerWidth * 0.16));
  const portfolioColumnWidth = Math.max(10, Math.floor(innerWidth * 0.18));
  const threadColumnWidth = Math.max(10, Math.floor(innerWidth * 0.26));
  const apiColumnWidth = Math.max(
    10,
    innerWidth - modeColumnWidth - btcColumnWidth - portfolioColumnWidth - threadColumnWidth
  );

  const secondaryScopeLabel = operatorStatus?.activeProfile
    ? `${operatorStatus.configScopeLabel}/${operatorStatus.activeProfile}`
    : operatorStatus?.configScopeLabel;

  const configuredChains = [
    chainStatus?.solana ? "SOL" : null,
    chainStatus?.polkadot ? "DOT" : null,
    chainStatus?.chainlink ? "CL" : null,
    chainStatus?.evm ? "EVM" : null,
    chainStatus?.cdp ? "CDP" : null,
    chainStatus?.base && !chainStatus?.cdp ? "BASE" : null,
  ].filter((value): value is string => Boolean(value));

  const modeValue = activeStrategies > 0 ? `${mode} [${activeStrategies} active]` : mode;
  const portfolioValueLabel = configuredChains.length > 0
    ? `$${formatValue(portfolioValue)} · ${configuredChains.join(" ")}`
    : `$${formatValue(portfolioValue)}`;
  const threadValue = threadInfo
    ? `${threadInfo.name}${threadInfo.isBranch ? " [branch]" : ""} (#${threadInfo.messageCount})`
    : "---";
  const connectionValue = connectionStatus === "connecting"
    ? "◐ Connecting"
    : connectionStatus === "connected"
      ? "●"
      : "○";
  const connectionColor = connectionStatus === "connecting"
    ? COLORS.DISCOVER
    : connectionStatus === "connected"
      ? COLORS.GREEN
      : COLORS.RED;

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
        paddingY={0}
        width="100%"
        flexDirection="column"
      >
        <Box width="100%">
          <StatusColumn
            width={modeColumnWidth}
            label="Mode"
            value={modeValue}
            valueColor={mode === "ARMED" ? COLORS.RED : COLORS.GREEN}
            valueBold={true}
          />
          <StatusColumn
            width={btcColumnWidth}
            label="BTC"
            value={`$${formatBtcPrice(btcPrice)}`}
            valueColor={COLORS.WHITE}
            valueBold={true}
          />
          <StatusColumn
            width={portfolioColumnWidth}
            label="Portfolio"
            value={portfolioValueLabel}
            valueColor={COLORS.WHITE}
            valueBold={true}
          />
          <StatusColumn
            width={threadColumnWidth}
            label="Thread"
            value={threadValue}
            valueColor={threadInfo?.isBranch ? COLORS.ANALYZE : COLORS.ACCENT}
          />
          <StatusColumn
            width={apiColumnWidth}
            label="API"
            value={connectionValue}
            valueColor={connectionColor}
            valueBold={true}
            paddingRight={0}
          />
        </Box>

        {operatorStatus && (
          <Box width="100%">
            <StatusColumn
              width={modeColumnWidth}
              label="Model"
              value={operatorStatus.modelLabel}
            />
            <StatusColumn
              width={btcColumnWidth}
              label="Profile"
              value={operatorStatus.credentialProfile}
              valueColor={operatorStatus.credentialProfile === "live" ? COLORS.TRADE : COLORS.ACCENT_DIM}
            />
            <StatusColumn
              width={portfolioColumnWidth}
              label="Venue"
              value={operatorStatus.activeVenueLabel}
            />
            <StatusColumn
              width={threadColumnWidth}
              label="Scope"
              value={secondaryScopeLabel ?? "---"}
            />
            <StatusColumn
              width={apiColumnWidth}
              label="Run"
              value={`${operatorStatus.requestState} · Q ${operatorStatus.queueDepth}`}
              valueColor={
                operatorStatus.requestState === "streaming"
                  ? COLORS.HIGHLIGHT
                  : operatorStatus.requestState === "loading"
                    ? COLORS.DISCOVER
                    : operatorStatus.queueDepth > 0
                      ? COLORS.ACCENT
                      : COLORS.DIM
              }
              paddingRight={0}
            />
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default StatusBar;
