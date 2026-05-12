import React from "react";
import { Box, Text } from "../ink-custom";
import { InlineChart } from "../components/charts/InlineChart.tsx";

/**
 * MarketAnalysisRenderer -- Deep / ensemble / multi-timeframe analysis
 * Phase 10: Structured sections for each analysis type
 */

interface TimeframeAnalysis {
  timeframe: string;
  trend: string;
  strength: number;
  signal: string;
}

interface EnsembleVote {
  model: string;
  signal: string;
  confidence: number;
}

interface MarketAnalysisData {
  symbol: string;
  type: string; // "deep" | "ensemble" | "mtf"
  summary: string;
  signal: string;
  confidence: number;
  timeframes?: TimeframeAnalysis[];
  ensemble?: EnsembleVote[];
  priceHistory?: number[];
  keyLevels?: { label: string; price: number }[];
}

interface Props {
  data: MarketAnalysisData;
}

function signalColor(signal: string): string {
  const s = signal.toLowerCase();
  if (s.includes("buy") || s.includes("long") || s.includes("bullish")) return "green";
  if (s.includes("sell") || s.includes("short") || s.includes("bearish")) return "red";
  return "yellow";
}

function trendArrow(trend: string): string {
  const t = trend.toLowerCase();
  if (t.includes("up") || t.includes("bull")) return "\u2191";
  if (t.includes("down") || t.includes("bear")) return "\u2193";
  return "\u2192";
}

export function MarketAnalysisRenderer({ data }: Props) {
  return (
    <Box flexDirection="column" paddingLeft={2} marginTop={1}>
      {/* Header */}
      <Box>
        <Text bold color="cyanBright">{data.symbol}</Text>
        <Text dimColor> {"\u00b7"} </Text>
        <Text bold>{data.type.toUpperCase()} ANALYSIS</Text>
        <Text dimColor> {"\u00b7"} </Text>
        <Text dimColor>{Math.round(data.confidence * 100)}% confidence</Text>
      </Box>

      {/* Summary */}
      <Box marginTop={1}>
        <Text dimColor>  {data.summary}</Text>
      </Box>

      {/* Multi-timeframe section */}
      {data.timeframes && data.timeframes.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold dimColor>  TIMEFRAMES</Text>
          {data.timeframes.map((tf, i) => (
            <Box key={i} paddingLeft={2}>
              <Box width={8}>
                <Text bold>{tf.timeframe}</Text>
              </Box>
              <Box width={10}>
                <Text color={signalColor(tf.trend)}>
                  {trendArrow(tf.trend)} {tf.trend}
                </Text>
              </Box>
              <Box width={8}>
                <Text dimColor>{Math.round(tf.strength * 100)}%</Text>
              </Box>
              <Text color={signalColor(tf.signal)}>{tf.signal}</Text>
            </Box>
          ))}
        </Box>
      )}

      {/* Ensemble section */}
      {data.ensemble && data.ensemble.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold dimColor>  ENSEMBLE VOTES</Text>
          {data.ensemble.map((vote, i) => (
            <Box key={i} paddingLeft={2}>
              <Box width={16}>
                <Text>{vote.model}</Text>
              </Box>
              <Box width={10}>
                <Text color={signalColor(vote.signal)}>{vote.signal}</Text>
              </Box>
              <Text dimColor>{Math.round(vote.confidence * 100)}%</Text>
            </Box>
          ))}
        </Box>
      )}

      {/* Key levels */}
      {data.keyLevels && data.keyLevels.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold dimColor>  KEY LEVELS</Text>
          {data.keyLevels.map((level, i) => (
            <Box key={i} paddingLeft={2}>
              <Box width={12}>
                <Text dimColor>{level.label}</Text>
              </Box>
              <Text>{level.price.toLocaleString()}</Text>
            </Box>
          ))}
        </Box>
      )}

      {/* Sparkline */}
      {data.priceHistory && data.priceHistory.length > 2 && (
        <Box marginTop={1} paddingLeft={2}>
          <InlineChart data={data.priceHistory} width={30} />
        </Box>
      )}

      {/* Signal */}
      <Box marginTop={1}>
        <Text dimColor>  Signal: </Text>
        <Text bold color={signalColor(data.signal)}>{data.signal}</Text>
      </Box>
    </Box>
  );
}
