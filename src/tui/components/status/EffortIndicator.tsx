import { Text } from "../../ink-custom";

// ============================================================================
// EffortIndicator — Compact analysis depth level display
// ============================================================================

type Level = "low" | "medium" | "high" | "max";
const ICONS: Record<Level, string> = {
  low: "\u25CB",
  medium: "\u25D0",
  high: "\u25D1",
  max: "\u25CF",
};
const COLORS: Record<Level, string> = {
  low: "gray",
  medium: "yellow",
  high: "cyan",
  max: "cyanBright",
};

interface Props {
  level: Level;
}

export function EffortIndicator({ level }: Props) {
  return (
    <Text color={COLORS[level]} bold={level === "max"}>
      {ICONS[level]} {level}
    </Text>
  );
}
