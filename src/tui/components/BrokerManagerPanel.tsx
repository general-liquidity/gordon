/**
 * BrokerManagerPanel — All 9 brokers with status
 *
 * Shows name, connection status, account type, buying power,
 * and supported order types. Enter to connect/disconnect.
 *
 * Pattern: Claude Code service manager with status indicators.
 */

import React, { useState } from "react";
import { Box, Text, useInput } from "../ink-custom";
import { Pane } from "../design-system/Pane.js";

// ============================================================================
// Types
// ============================================================================

export interface BrokerInfo {
  id: string;
  name: string;
  connected: boolean;
  accountType: string;
  buyingPower: number;
  orderTypes: string[];
}

interface Props {
  brokers: BrokerInfo[];
  onConnect?: (id: string) => void;
  onDisconnect?: (id: string) => void;
  onClose: () => void;
}

// ============================================================================
// Default brokers
// ============================================================================

export const DEFAULT_BROKERS: BrokerInfo[] = [
  { id: "alpaca", name: "Alpaca", connected: false, accountType: "margin", buyingPower: 0, orderTypes: ["market", "limit", "stop", "trailing_stop"] },
  { id: "etrade", name: "E*Trade", connected: false, accountType: "cash", buyingPower: 0, orderTypes: ["market", "limit", "stop"] },
  { id: "ibkr", name: "IBKR", connected: false, accountType: "margin", buyingPower: 0, orderTypes: ["market", "limit", "stop", "algo", "bracket"] },
  { id: "schwab", name: "Schwab", connected: false, accountType: "cash", buyingPower: 0, orderTypes: ["market", "limit", "stop"] },
  { id: "tastytrade", name: "Tastytrade", connected: false, accountType: "margin", buyingPower: 0, orderTypes: ["market", "limit", "stop", "options"] },
  { id: "tradestation", name: "TradeStation", connected: false, accountType: "margin", buyingPower: 0, orderTypes: ["market", "limit", "stop", "bracket"] },
  { id: "tradier", name: "Tradier", connected: false, accountType: "margin", buyingPower: 0, orderTypes: ["market", "limit", "stop"] },
  { id: "trading212", name: "Trading212", connected: false, accountType: "cash", buyingPower: 0, orderTypes: ["market", "limit"] },
  { id: "webull", name: "Webull", connected: false, accountType: "margin", buyingPower: 0, orderTypes: ["market", "limit", "stop", "trailing_stop"] },
];

// ============================================================================
// Helpers
// ============================================================================

function padRight(s: string, w: number): string {
  return s.length >= w ? s.slice(0, w) : s + " ".repeat(w - s.length);
}

function fmtUSD(n: number): string {
  if (n === 0) return "\u2014";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}

// ============================================================================
// Component
// ============================================================================

export function BrokerManagerPanel({
  brokers,
  onConnect,
  onDisconnect,
  onClose,
}: Props) {
  const [cursor, setCursor] = useState(0);

  useInput((_input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if (key.upArrow) {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.downArrow) {
      setCursor((c) => Math.min(brokers.length - 1, c + 1));
      return;
    }
    if (key.return) {
      const broker = brokers[cursor];
      if (!broker) return;
      if (broker.connected) {
        onDisconnect?.(broker.id);
      } else {
        onConnect?.(broker.id);
      }
    }
  });

  const connectedCount = brokers.filter((b) => b.connected).length;

  return (
    <Pane title="BROKERS" color="cyan">
      <Box>
        <Text dimColor>
          {brokers.length} brokers {"\u00b7"}{" "}
        </Text>
        <Text color="green">{connectedCount} connected</Text>
      </Box>
      <Text> </Text>

      {/* Column headers */}
      <Box paddingLeft={3}>
        <Box width={16}><Text bold dimColor>BROKER</Text></Box>
        <Box width={6}><Text bold dimColor>STATUS</Text></Box>
        <Box width={10}><Text bold dimColor>ACCOUNT</Text></Box>
        <Box width={14}><Text bold dimColor>BUYING POWER</Text></Box>
        <Box width={24}><Text bold dimColor>ORDER TYPES</Text></Box>
      </Box>

      {/* Broker rows */}
      {brokers.map((broker, i) => {
        const isFocused = i === cursor;
        const pointer = isFocused ? "\u25B8 " : "  ";
        const statusIcon = broker.connected ? "\u25CF" : "\u25CB";
        const statusColor = broker.connected ? "green" : "gray";

        return (
          <Box key={broker.id}>
            <Text color={isFocused ? "cyanBright" : undefined}>{pointer}</Text>
            <Box width={16}>
              <Text bold={isFocused}>{padRight(broker.name, 16)}</Text>
            </Box>
            <Box width={6}>
              <Text color={statusColor}>{statusIcon}</Text>
            </Box>
            <Box width={10}>
              <Text dimColor>{padRight(broker.accountType, 10)}</Text>
            </Box>
            <Box width={14}>
              <Text>{fmtUSD(broker.buyingPower)}</Text>
            </Box>
            <Box width={24}>
              <Text dimColor>{broker.orderTypes.join(", ").slice(0, 22)}</Text>
            </Box>
          </Box>
        );
      })}

      <Text> </Text>
      <Text dimColor>
        {"\u2191\u2193"} navigate {"\u00b7"} Enter connect/disconnect {"\u00b7"} Esc close
      </Text>
    </Pane>
  );
}
