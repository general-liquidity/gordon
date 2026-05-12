/**
 * ExchangeManagerPanel — All 8 exchanges with health
 *
 * Shows name, connection status, latency, rate limit usage,
 * and supported features. Enter to connect/disconnect.
 *
 * Pattern: Claude Code service manager with status indicators.
 */

import React, { useState } from "react";
import { Box, Text, useInput } from "../../ink-custom";
import { Pane } from "../../design-system/Pane.js";
import { ProgressBar } from "../../design-system/ProgressBar.js";

// ============================================================================
// Types
// ============================================================================

export interface ExchangeInfo {
  id: string;
  name: string;
  connected: boolean;
  apiKeySet: boolean;
  latencyMs: number;
  rateLimitUsed: number;
  rateLimitMax: number;
  features: string[];
}

interface Props {
  exchanges: ExchangeInfo[];
  onConnect?: (id: string) => void;
  onDisconnect?: (id: string) => void;
  onClose: () => void;
}

// ============================================================================
// Default exchanges
// ============================================================================

export const DEFAULT_EXCHANGES: ExchangeInfo[] = [
  { id: "binance", name: "Binance", connected: false, apiKeySet: false, latencyMs: 0, rateLimitUsed: 0, rateLimitMax: 1200, features: ["spot", "futures", "margin"] },
  { id: "binanceus", name: "Binance US", connected: false, apiKeySet: false, latencyMs: 0, rateLimitUsed: 0, rateLimitMax: 1200, features: ["spot"] },
  { id: "coinbase", name: "Coinbase", connected: false, apiKeySet: false, latencyMs: 0, rateLimitUsed: 0, rateLimitMax: 600, features: ["spot"] },
  { id: "kraken", name: "Kraken", connected: false, apiKeySet: false, latencyMs: 0, rateLimitUsed: 0, rateLimitMax: 500, features: ["spot", "futures"] },
  { id: "hyperliquid", name: "Hyperliquid", connected: false, apiKeySet: false, latencyMs: 0, rateLimitUsed: 0, rateLimitMax: 1000, features: ["perps"] },
  { id: "bitfinex", name: "Bitfinex", connected: false, apiKeySet: false, latencyMs: 0, rateLimitUsed: 0, rateLimitMax: 900, features: ["spot", "margin"] },
  { id: "robinhood", name: "Robinhood", connected: false, apiKeySet: false, latencyMs: 0, rateLimitUsed: 0, rateLimitMax: 300, features: ["crypto", "stocks"] },
  { id: "uniswap", name: "Uniswap", connected: false, apiKeySet: false, latencyMs: 0, rateLimitUsed: 0, rateLimitMax: 0, features: ["dex", "swap"] },
];

// ============================================================================
// Helpers
// ============================================================================

function padRight(s: string, w: number): string {
  return s.length >= w ? s.slice(0, w) : s + " ".repeat(w - s.length);
}

function latencyColor(ms: number): string {
  if (ms === 0) return "gray";
  if (ms < 100) return "green";
  if (ms < 500) return "yellow";
  return "red";
}

// ============================================================================
// Component
// ============================================================================

export function ExchangeManagerPanel({
  exchanges,
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
      setCursor((c) => Math.min(exchanges.length - 1, c + 1));
      return;
    }
    if (key.return) {
      const ex = exchanges[cursor];
      if (!ex) return;
      if (ex.connected) {
        onDisconnect?.(ex.id);
      } else {
        onConnect?.(ex.id);
      }
    }
  });

  const connectedCount = exchanges.filter((e) => e.connected).length;

  return (
    <Pane title="EXCHANGES" color="cyan">
      <Box>
        <Text dimColor>
          {exchanges.length} exchanges {"\u00b7"}{" "}
        </Text>
        <Text color="green">{connectedCount} connected</Text>
      </Box>
      <Text> </Text>

      {/* Column headers */}
      <Box paddingLeft={3}>
        <Box width={16}><Text bold dimColor>EXCHANGE</Text></Box>
        <Box width={6}><Text bold dimColor>STATUS</Text></Box>
        <Box width={10}><Text bold dimColor>LATENCY</Text></Box>
        <Box width={20}><Text bold dimColor>RATE LIMIT</Text></Box>
        <Box width={20}><Text bold dimColor>FEATURES</Text></Box>
      </Box>

      {/* Exchange rows */}
      {exchanges.map((ex, i) => {
        const isFocused = i === cursor;
        const pointer = isFocused ? "\u25B8 " : "  ";
        const statusIcon = ex.connected ? "\u25CF" : "\u25CB";
        const statusColor = ex.connected ? "green" : "gray";
        const rlRatio = ex.rateLimitMax > 0 ? ex.rateLimitUsed / ex.rateLimitMax : 0;
        const rlColor = rlRatio > 0.8 ? "red" : rlRatio > 0.5 ? "yellow" : "green";

        return (
          <Box key={ex.id}>
            <Text color={isFocused ? "cyanBright" : undefined}>{pointer}</Text>
            <Box width={16}>
              <Text bold={isFocused}>{padRight(ex.name, 16)}</Text>
            </Box>
            <Box width={6}>
              <Text color={statusColor}>{statusIcon}</Text>
            </Box>
            <Box width={10}>
              <Text color={latencyColor(ex.latencyMs)}>
                {ex.connected ? `${ex.latencyMs}ms` : "\u2014"}
              </Text>
            </Box>
            <Box width={20}>
              {ex.rateLimitMax > 0 ? (
                <>
                  <ProgressBar value={rlRatio} width={8} fillColor={rlColor} />
                  <Text dimColor> {ex.rateLimitUsed}/{ex.rateLimitMax}</Text>
                </>
              ) : (
                <Text dimColor>{"\u2014"}</Text>
              )}
            </Box>
            <Box width={20}>
              <Text dimColor>{ex.features.join(", ")}</Text>
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
