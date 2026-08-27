import { Box, Text } from "../../ink-custom";
import { Pane } from "../../design-system/Pane.js";

export interface SymbolStats {
  symbol: string;
  totalPredictions: number;
  resolvedPredictions: number;
  accuracy: number;
  winRate: number;
  avgReturn: number;
  bestSignal: "BULLISH" | "BEARISH" | "NEUTRAL";
  bestSignalAccuracy: number;
}

interface Props {
  stats: SymbolStats[];
  title?: string;
}

export function SymbolAccuracyTable({ stats, title = "PER-SYMBOL ACCURACY" }: Props) {
  return (
    <Pane title={title}>
      <Box flexDirection="column">
        <Box>
          <Text dimColor bold>
            {"SYMBOL".padEnd(10)}
          </Text>
          <Text dimColor bold>
            {"N".padEnd(6)}
          </Text>
          <Text dimColor bold>
            {"ACC".padEnd(8)}
          </Text>
          <Text dimColor bold>
            {"WIN".padEnd(8)}
          </Text>
          <Text dimColor bold>
            {"AVG RET".padEnd(10)}
          </Text>
          <Text dimColor bold>
            BEST
          </Text>
        </Box>
        {stats.map((s) => {
          const accColor = s.accuracy > 0.7 ? "green" : s.accuracy > 0.55 ? "yellow" : "red";
          const retColor = s.avgReturn > 0 ? "green" : "red";
          return (
            <Box key={s.symbol}>
              <Text bold>{s.symbol.padEnd(10)}</Text>
              <Text dimColor>{s.resolvedPredictions.toString().padEnd(6)}</Text>
              <Text color={accColor}>{(s.accuracy * 100).toFixed(0).padStart(3)}% </Text>
              <Text>{(s.winRate * 100).toFixed(0).padStart(3)}% </Text>
              <Text color={retColor}>
                {s.avgReturn >= 0 ? "+" : ""}
                {(s.avgReturn * 100).toFixed(2)}%{" "}
              </Text>
              <Text dimColor>
                {s.bestSignal} ({(s.bestSignalAccuracy * 100).toFixed(0)}%)
              </Text>
            </Box>
          );
        })}
      </Box>
    </Pane>
  );
}
