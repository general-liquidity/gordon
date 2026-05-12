/**
 * MarketOverviewPanel — Composite market view
 *
 * Shows Market Score (0-100), regime badge, breakout setups,
 * consolidation zones, and whale activity alerts.
 *
 * Pattern: Claude Code context dashboard with multi-section layout.
 */

import React from "react";
import { Box, Text } from "../../ink-custom";
import { Pane } from "../../design-system/Pane.js";
import { ProgressBar } from "../../design-system/ProgressBar.js";

// ============================================================================
// Types
// ============================================================================

export interface BreakoutSetup {
  symbol: string;
  type: "bullish" | "bearish";
  confidence: number;
}

export interface WhaleAlert {
  symbol: string;
  action: "accumulation" | "distribution";
  volume: string;
  timestamp: string;
}

interface Props {
  marketScore: number;
  regime: string;
  breakouts: BreakoutSetup[];
  consolidations: string[];
  whaleAlerts: WhaleAlert[];
  onClose: () => void;
}

// ============================================================================
// Helpers
// ============================================================================

function scoreColor(score: number): string {
  if (score >= 70) return "green";
  if (score >= 40) return "yellow";
  return "red";
}

function regimeColor(regime: string): string {
  const lower = regime.toLowerCase();
  if (lower.includes("bull")) return "green";
  if (lower.includes("bear")) return "red";
  if (lower.includes("trend")) return "cyan";
  if (lower.includes("rang") || lower.includes("sideways")) return "yellow";
  return "white";
}

function timeAgo(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 60_000) return "just now";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return `${Math.floor(diff / 86_400_000)}d ago`;
  } catch {
    return "\u2014";
  }
}

function padRight(s: string, w: number): string {
  return s.length >= w ? s.slice(0, w) : s + " ".repeat(w - s.length);
}

// ============================================================================
// Component
// ============================================================================

export function MarketOverviewPanel({
  marketScore,
  regime,
  breakouts,
  consolidations,
  whaleAlerts,
  onClose,
}: Props) {
  return (
    <Pane title="MARKET OVERVIEW" color="cyan">
      {/* Market Score */}
      <Box>
        <Box width={14}>
          <Text dimColor>Market Score</Text>
        </Box>
        <ProgressBar value={marketScore / 100} width={20} fillColor={scoreColor(marketScore)} />
        <Text> </Text>
        <Text bold color={scoreColor(marketScore)}>{marketScore}/100</Text>
      </Box>

      {/* Regime */}
      <Box>
        <Box width={14}>
          <Text dimColor>Regime</Text>
        </Box>
        <Text bold color={regimeColor(regime)}>{regime.toUpperCase()}</Text>
      </Box>

      {/* Breakouts */}
      {breakouts.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold dimColor>BREAKOUT SETUPS</Text>
          {breakouts.map((b) => {
            const arrow = b.type === "bullish" ? "\u2191" : "\u2193";
            const color = b.type === "bullish" ? "green" : "red";
            return (
              <Box key={`${b.symbol}-${b.type}`} paddingLeft={2}>
                <Box width={10}>
                  <Text bold>{b.symbol}</Text>
                </Box>
                <Text color={color}>{arrow} {b.type}</Text>
                <Text dimColor> {"\u00b7"} </Text>
                <ProgressBar value={b.confidence / 100} width={10} fillColor={color} />
                <Text dimColor> {b.confidence}%</Text>
              </Box>
            );
          })}
        </Box>
      )}

      {/* Consolidations */}
      {consolidations.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold dimColor>CONSOLIDATING</Text>
          <Box paddingLeft={2}>
            <Text dimColor>{consolidations.join(", ")}</Text>
          </Box>
        </Box>
      )}

      {/* Whale Alerts */}
      {whaleAlerts.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold dimColor>WHALE ACTIVITY</Text>
          {whaleAlerts.map((w, i) => {
            const actionColor = w.action === "accumulation" ? "green" : "red";
            return (
              <Box key={`${w.symbol}-${i}`} paddingLeft={2}>
                <Box width={10}>
                  <Text bold>{w.symbol}</Text>
                </Box>
                <Box width={16}>
                  <Text color={actionColor}>{padRight(w.action.toUpperCase(), 16)}</Text>
                </Box>
                <Box width={10}>
                  <Text>{w.volume}</Text>
                </Box>
                <Text dimColor>{timeAgo(w.timestamp)}</Text>
              </Box>
            );
          })}
        </Box>
      )}

      <Text> </Text>
      <Text dimColor>Esc close</Text>
    </Pane>
  );
}
