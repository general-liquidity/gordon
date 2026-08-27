import { Box, Text } from "../ink-custom";
import { DataTable, type Column } from "../components/charts/DataTable.tsx";
import { InlineChart } from "../components/charts/InlineChart.tsx";

/**
 * AnalysisRenderer -- Technical analysis view
 * Phase 10: Regime badge + levels table (S1-S3, R1-R3) + InlineChart + signal
 */

interface AnalysisData {
  symbol: string;
  regime: string;
  confidence: number;
  supports: number[];
  resistances: number[];
  rsiState: string;
  macdState: string;
  trendBias: string;
  signal: string;
  priceHistory?: number[];
}

interface Props {
  data: AnalysisData;
}

const REGIME_COLORS: Record<string, string> = {
  trending: "green",
  ranging: "yellow",
  volatile: "red",
  breakout: "cyanBright",
};

export function AnalysisRenderer({ data }: Props) {
  const regimeColor = REGIME_COLORS[data.regime.toLowerCase()] ?? "white";

  // Build levels rows (S1-S3, R1-R3)
  const levelRows: Record<string, unknown>[] = [];
  const maxLevels = Math.max(data.supports.length, data.resistances.length, 3);
  for (let i = 0; i < maxLevels; i++) {
    levelRows.push({
      support:
        data.supports[i] != null ? `S${i + 1}  ${data.supports[i]!.toLocaleString()}` : "\u2014",
      resistance:
        data.resistances[i] != null
          ? `R${i + 1}  ${data.resistances[i]!.toLocaleString()}`
          : "\u2014",
    });
  }

  const levelColumns: Column[] = [
    {
      key: "support",
      header: "SUPPORT",
      width: 18,
      align: "left",
      color: () => "green",
    },
    {
      key: "resistance",
      header: "RESISTANCE",
      width: 18,
      align: "left",
      color: () => "red",
    },
  ];

  const signalLower = data.signal.toLowerCase();
  const signalColor =
    signalLower.includes("buy") || signalLower.includes("long")
      ? "green"
      : signalLower.includes("sell") || signalLower.includes("short")
        ? "red"
        : "yellow";

  return (
    <Box flexDirection="column" paddingLeft={2} marginTop={1}>
      {/* Header: symbol + regime badge */}
      <Box>
        <Text bold color="cyanBright">
          {data.symbol}
        </Text>
        <Text dimColor> {"\u00b7"} </Text>
        <Text bold color={regimeColor}>
          {data.regime.toUpperCase()}
        </Text>
        <Text dimColor> {"\u00b7"} </Text>
        <Text dimColor>{Math.round(data.confidence * 100)}% confidence</Text>
      </Box>

      {/* Levels table (S1-S3, R1-R3) */}
      <DataTable columns={levelColumns} data={levelRows} />

      {/* Indicators line */}
      <Box marginTop={1}>
        <Text dimColor> RSI </Text>
        <Text>{data.rsiState}</Text>
        <Text dimColor> {"\u00b7"} MACD </Text>
        <Text>{data.macdState}</Text>
        <Text dimColor> {"\u00b7"} Trend </Text>
        <Text>{data.trendBias}</Text>
      </Box>

      {/* Price history sparkline via InlineChart */}
      {data.priceHistory && data.priceHistory.length > 2 && (
        <Box marginTop={1} paddingLeft={2}>
          <InlineChart data={data.priceHistory} width={30} />
        </Box>
      )}

      {/* Signal */}
      <Box marginTop={1}>
        <Text dimColor> Signal: </Text>
        <Text bold color={signalColor}>
          {data.signal}
        </Text>
      </Box>
    </Box>
  );
}
