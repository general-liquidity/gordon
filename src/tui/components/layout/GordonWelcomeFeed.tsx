/**
 * GordonWelcomeFeed — Trading-focused welcome screen feed.
 *
 * Replaces generic news/tips with live market items, strategy count,
 * last session summary, and a session tip. Styled to match Gordon's
 * cyan/green/red theme.
 *
 * Layout:
 *   ─────────────────────────────────────────
 *    ◈ GORDON  Ready to trade
 *   ─────────────────────────────────────────
 *    BTC/USDT    $68,432  +2.3%
 *    ETH/USDT    $3,821   -0.4%
 *   ─────────────────────────────────────────
 *    Active strategies: 2
 *    Last session: Bought 0.1 BTC, +$234 P&L
 *   ─────────────────────────────────────────
 *    Tip: Use /morning-brief for market overview
 */

import React from "react";
import { Box, Text, useStdout } from "../../ink-custom";

// ============================================================================
// Types
// ============================================================================

export interface FeedItem {
  title: string;
  value: string;
  /** "green", "red", "cyan", etc. — undefined for default. */
  color?: string;
}

interface Props {
  /** Market tickers / trending coins. */
  marketItems?: FeedItem[];
  /** Number of active strategies. */
  strategyCount?: number;
  /** One-line summary of last session. */
  lastSessionSummary?: string;
  /** Tip of the session. */
  tip?: string;
}

// ============================================================================
// Helpers
// ============================================================================

function Divider({ width }: { width: number }) {
  return <Text dimColor>{"─".repeat(width)}</Text>;
}

// ============================================================================
// Component
// ============================================================================

export function GordonWelcomeFeed({
  marketItems,
  strategyCount,
  lastSessionSummary,
  tip,
}: Props) {
  const { stdout } = useStdout();
  const termWidth = Math.min(stdout?.columns ?? 60, 60);

  const hasMarket = marketItems && marketItems.length > 0;
  const hasSession = strategyCount != null || lastSessionSummary;
  const hasTip = !!tip;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Divider width={termWidth} />

      {/* Header */}
      <Box paddingLeft={1}>
        <Text color="rgb(52,238,176)" bold>{"◈ GORDON"}</Text>
        <Text dimColor>{"  Ready to trade"}</Text>
      </Box>

      {/* Market items */}
      {hasMarket && (
        <>
          <Divider width={termWidth} />
          <Box flexDirection="column">
            {marketItems!.map((item, i) => (
              <Box key={i} paddingLeft={1}>
                <Box width={16}>
                  <Text dimColor>{item.title}</Text>
                </Box>
                <Text bold color={item.color ?? undefined}>
                  {item.value}
                </Text>
              </Box>
            ))}
          </Box>
        </>
      )}

      {/* Session summary */}
      {hasSession && (
        <>
          <Divider width={termWidth} />
          <Box flexDirection="column" paddingLeft={1}>
            {strategyCount != null && (
              <Box>
                <Text dimColor>{"Active strategies: "}</Text>
                <Text bold>{strategyCount}</Text>
              </Box>
            )}
            {lastSessionSummary && (
              <Box>
                <Text dimColor>{"Last session: "}</Text>
                <Text>{lastSessionSummary}</Text>
              </Box>
            )}
          </Box>
        </>
      )}

      {/* Tip */}
      {hasTip && (
        <>
          <Divider width={termWidth} />
          <Box paddingLeft={1}>
            <Text dimColor>{"Tip: "}</Text>
            <Text dimColor>{tip}</Text>
          </Box>
        </>
      )}

      <Divider width={termWidth} />
    </Box>
  );
}
