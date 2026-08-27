import { Box, Text } from "../ink-custom";

/**
 * IndicatorRenderer -- RSI gauge, MACD state, trend direction
 * Phase 10: Visual gauge for RSI, colored MACD state, trend arrow
 */

interface IndicatorData {
  symbol: string;
  rsi: number;
  rsiState: string;
  macd: number;
  macdSignal: number;
  macdHistogram: number;
  macdState: string;
  trend: string;
  trendStrength: number;
  ema20?: number;
  ema50?: number;
  ema200?: number;
}

interface Props {
  data: IndicatorData;
}

function rsiGauge(value: number): { bar: string; color: string } {
  const width = 20;
  const pos = Math.min(width, Math.max(0, Math.round((value / 100) * width)));
  const bar = "\u2588".repeat(pos) + "\u2591".repeat(width - pos);
  const color = value >= 70 ? "red" : value <= 30 ? "green" : "yellow";
  return { bar, color };
}

function trendArrow(trend: string): string {
  const t = trend.toLowerCase();
  if (t.includes("up") || t.includes("bull")) return "\u2191";
  if (t.includes("down") || t.includes("bear")) return "\u2193";
  return "\u2192";
}

function trendColor(trend: string): string {
  const t = trend.toLowerCase();
  if (t.includes("up") || t.includes("bull")) return "green";
  if (t.includes("down") || t.includes("bear")) return "red";
  return "yellow";
}

export function IndicatorRenderer({ data }: Props) {
  const rsi = rsiGauge(data.rsi);
  const macdColor = data.macdHistogram > 0 ? "green" : data.macdHistogram < 0 ? "red" : "yellow";

  return (
    <Box flexDirection="column" paddingLeft={2} marginTop={1}>
      {/* Header */}
      <Box>
        <Text bold color="cyanBright">
          {data.symbol}
        </Text>
        <Text dimColor> {"\u00b7"} INDICATORS</Text>
      </Box>

      {/* RSI gauge */}
      <Box marginTop={1}>
        <Box width={12}>
          <Text bold> RSI</Text>
        </Box>
        <Text color={rsi.color}>{rsi.bar}</Text>
        <Text> </Text>
        <Text color={rsi.color} bold>
          {data.rsi.toFixed(1)}
        </Text>
        <Text dimColor> {data.rsiState}</Text>
      </Box>

      {/* MACD */}
      <Box>
        <Box width={12}>
          <Text bold> MACD</Text>
        </Box>
        <Text color={macdColor}>
          {data.macdHistogram > 0 ? "\u25B2" : data.macdHistogram < 0 ? "\u25BC" : "\u25C6"}{" "}
          {data.macd.toFixed(4)}
        </Text>
        <Text dimColor> / sig {data.macdSignal.toFixed(4)}</Text>
        <Text dimColor> {"\u00b7"} </Text>
        <Text color={macdColor}>{data.macdState}</Text>
      </Box>

      {/* Trend */}
      <Box>
        <Box width={12}>
          <Text bold> TREND</Text>
        </Box>
        <Text color={trendColor(data.trend)}>
          {trendArrow(data.trend)} {data.trend}
        </Text>
        <Text dimColor>
          {" "}
          {"\u00b7"} strength {Math.round(data.trendStrength * 100)}%
        </Text>
      </Box>

      {/* EMAs if available */}
      {(data.ema20 != null || data.ema50 != null || data.ema200 != null) && (
        <Box marginTop={1}>
          <Text dimColor> EMAs: </Text>
          {data.ema20 != null && <Text>20={data.ema20.toLocaleString()} </Text>}
          {data.ema50 != null && <Text>50={data.ema50.toLocaleString()} </Text>}
          {data.ema200 != null && <Text>200={data.ema200.toLocaleString()}</Text>}
        </Box>
      )}
    </Box>
  );
}
