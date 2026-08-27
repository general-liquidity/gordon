import { Box, Text } from "../../ink-custom";
import { Pane } from "../../design-system/Pane.js";

export interface PlanVersion {
  version: number;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  sizeUsd: number;
  confidence: number;
  reasoning?: string;
}

interface Props {
  previous: PlanVersion;
  current: PlanVersion;
}

interface FieldDiff {
  label: string;
  from: number;
  to: number;
  isPrice: boolean;
  direction?: "up" | "down" | "same";
}

function formatValue(v: number, isPrice: boolean): string {
  return isPrice ? `$${v.toFixed(2)}` : `$${v.toFixed(0)}`;
}

export function PlanDiff({ previous, current }: Props) {
  const diffs: FieldDiff[] = [
    { label: "Entry", from: previous.entry, to: current.entry, isPrice: true },
    { label: "Stop Loss", from: previous.stopLoss, to: current.stopLoss, isPrice: true },
    { label: "Take Profit", from: previous.takeProfit, to: current.takeProfit, isPrice: true },
    { label: "Size", from: previous.sizeUsd, to: current.sizeUsd, isPrice: false },
    { label: "Confidence", from: previous.confidence, to: current.confidence, isPrice: false },
  ].map((d) => ({
    ...d,
    direction:
      d.to > d.from ? ("up" as const) : d.to < d.from ? ("down" as const) : ("same" as const),
  }));

  const changed = diffs.filter((d) => d.direction !== "same");

  if (changed.length === 0) {
    return (
      <Pane title={`PLAN v${previous.version} → v${current.version}`} tone="muted">
        <Text dimColor italic>
          No changes from previous version
        </Text>
      </Pane>
    );
  }

  return (
    <Pane title={`PLAN v${previous.version} → v${current.version}`}>
      <Box flexDirection="column">
        {changed.map((d) => {
          const arrow = d.direction === "up" ? "↑" : "↓";
          const color = d.direction === "up" ? "green" : "red";
          const delta = d.to - d.from;
          const pctChange = d.from !== 0 ? (delta / d.from) * 100 : 0;
          return (
            <Box key={d.label}>
              <Text dimColor>{d.label.padEnd(14)}</Text>
              <Text>{formatValue(d.from, d.isPrice).padEnd(12)}</Text>
              <Text color={color} bold>
                {arrow}{" "}
              </Text>
              <Text bold>{formatValue(d.to, d.isPrice).padEnd(12)}</Text>
              <Text color={color} dimColor>
                ({delta >= 0 ? "+" : ""}
                {pctChange.toFixed(1)}%)
              </Text>
            </Box>
          );
        })}
        <Box marginTop={1}>
          <Text dimColor italic>
            {changed.length} change{changed.length > 1 ? "s" : ""} from v{previous.version}
          </Text>
        </Box>
      </Box>
    </Pane>
  );
}
