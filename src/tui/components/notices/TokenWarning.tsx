import { Box, Text } from "../../ink-custom";
import { ProgressBar } from "../../design-system/ProgressBar.js";

// ============================================================================
// TokenWarning — Context window usage indicator with color escalation
// ============================================================================

interface Props {
  usedTokens: number;
  maxTokens: number;
  onCompact?: () => void;
}

export function TokenWarning({ usedTokens, maxTokens }: Props) {
  const pct = Math.min(100, (usedTokens / maxTokens) * 100);
  if (pct < 60) return null;

  const color = pct >= 80 ? "red" : "yellow";
  const msg =
    pct >= 95 ? "AUTO-COMPACT imminent" : pct >= 80 ? "run /compact soon" : "consider /compact";

  return (
    <Box>
      <Text color={color} bold={pct >= 95}>
        {"\u26A0"} Context {Math.round(pct)}%{" "}
      </Text>
      <ProgressBar value={pct / 100} width={20} fillColor={color} />
      <Text color={color}>
        {" "}
        {"\u2014"} {msg}
      </Text>
    </Box>
  );
}
