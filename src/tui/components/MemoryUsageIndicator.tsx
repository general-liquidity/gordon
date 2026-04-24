import React from "react";
import { Text } from "../ink-custom";

// Memory usage indicator — shows context window fill percentage
// Appears in footer when > 50% full, turns red when > 90%
interface Props {
  /** 0-1 ratio of context used */
  usageRatio: number;
  /** Total token limit */
  tokenLimit?: number;
}

export function MemoryUsageIndicator({ usageRatio, tokenLimit }: Props) {
  if (usageRatio < 0.5) return null;

  const pct = Math.round(usageRatio * 100);
  const color = usageRatio > 0.9 ? "red" : usageRatio > 0.7 ? "yellow" : "gray";
  const tokenStr = tokenLimit
    ? ` (${Math.round(usageRatio * tokenLimit / 1000)}K/${Math.round(tokenLimit / 1000)}K)`
    : "";

  return (
    <Text color={color}>
      {"\u2193"} {pct}% ctx{tokenStr}
      {usageRatio > 0.9 && " — /compact recommended"}
    </Text>
  );
}
