/**
 * EnrichedQuoteRenderer -- Multi-source enriched quote display
 *
 * Renders an enriched quote with price, change, volume, sources,
 * trend/momentum indicators, and optional AI summary.
 *
 * Example output:
 *
 *   BTC/USDT  $48,250.00  +2.30%  Vol: $1.2B
 *   Sources: Binance, CoinGecko, Hyperliquid
 *   Trend: ↑ UP (strong momentum)  Volume: above average
 *   AI: Bitcoin showing bullish continuation after breaking $48k resistance...
 */

import { Box, Text } from "../ink-custom";
import type { GordonTheme } from "../themes/themes.ts";
import { useTheme } from "../themes/ThemeProvider.tsx";
import { getMoneyColor, getSignalColor } from "../design-system/colorMap.ts";

// ============================================================================
// Types
// ============================================================================

interface EnrichedQuoteData {
  symbol: string;
  price: number;
  change24h: number;
  changePercent24h: number;
  volume24h: number;
  high24h: number;
  low24h: number;
  sources: string[];
  timestamp: number;
  trendDirection?: "up" | "down" | "sideways";
  momentum?: "strong" | "moderate" | "weak";
  volumeAssessment?: "above_average" | "average" | "below_average";
  summary?: string;
}

interface Props {
  data: EnrichedQuoteData;
}

// ============================================================================
// Formatters
// ============================================================================

function fmtPrice(n: number): string {
  if (n === 0) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(6)}`;
  if (n < 1) return `$${n.toFixed(4)}`;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function fmtVol(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function trendArrow(dir: string | undefined): string {
  if (dir === "up") return "\u2191";
  if (dir === "down") return "\u2193";
  return "\u2194";
}

function trendColor(dir: string | undefined, theme: GordonTheme): string {
  if (dir === "up") return getSignalColor("buy", theme);
  if (dir === "down") return getSignalColor("sell", theme);
  return getSignalColor("neutral", theme);
}

function volumeLabel(assessment: string | undefined): string {
  if (assessment === "above_average") return "above average";
  if (assessment === "below_average") return "below average";
  return "average";
}

// ============================================================================
// Component
// ============================================================================

export function EnrichedQuoteRenderer({ data }: Props) {
  const theme = useTheme();
  const hasEnrichment = data.trendDirection || data.momentum || data.summary;
  const priceChangeTone = getMoneyColor(data.changePercent24h, theme);

  return (
    <Box flexDirection="column" paddingLeft={2} marginTop={1}>
      {/* Line 1: Symbol  Price  Change  Volume */}
      <Box gap={2}>
        <Text bold>{data.symbol}/USDT</Text>
        <Text bold color={priceChangeTone}>
          {fmtPrice(data.price)}
        </Text>
        <Text color={priceChangeTone}>{fmtPct(data.changePercent24h)}</Text>
        <Text dimColor>Vol: {fmtVol(data.volume24h)}</Text>
      </Box>

      {/* Line 2: Sources */}
      {data.sources.length > 0 && (
        <Box>
          <Text dimColor>Sources: {data.sources.join(", ")}</Text>
        </Box>
      )}

      {/* Line 3: High/Low range */}
      {data.high24h > 0 && data.low24h > 0 && (
        <Box gap={2}>
          <Text dimColor>
            24h Range: {fmtPrice(data.low24h)} - {fmtPrice(data.high24h)}
          </Text>
        </Box>
      )}

      {/* Line 4: Trend + Momentum + Volume Assessment (if enriched) */}
      {hasEnrichment && (
        <Box gap={2}>
          <Text>
            <Text>Trend: </Text>
            <Text color={trendColor(data.trendDirection, theme)}>
              {trendArrow(data.trendDirection)} {(data.trendDirection ?? "sideways").toUpperCase()}
            </Text>
            {data.momentum && <Text dimColor> ({data.momentum} momentum)</Text>}
          </Text>
          {data.volumeAssessment && (
            <Text>
              <Text dimColor>Volume: </Text>
              <Text>{volumeLabel(data.volumeAssessment)}</Text>
            </Text>
          )}
        </Box>
      )}

      {/* Line 5: AI Summary (if available) */}
      {data.summary && (
        <Box>
          <Text>
            <Text dimColor italic>
              AI: {data.summary}
            </Text>
          </Text>
        </Box>
      )}
    </Box>
  );
}
