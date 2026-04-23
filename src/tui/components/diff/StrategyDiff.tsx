import React from "react";
import { Box, Text } from "ink";
import { parseDiff } from "./colorDiff.js";
import type { DiffLine } from "./colorDiff.js";

// ============================================================================
// StrategyDiff — Renders a colored line-based diff for strategy files
// ============================================================================

interface Props {
  strategyName: string;
  before: string;
  after: string;
  maxLines?: number;
}

export function StrategyDiff({ strategyName, before, after, maxLines = 20 }: Props) {
  const lines = parseDiff(before, after);
  const visible = lines.slice(0, maxLines);
  const overflow = lines.length - visible.length;

  return (
    <Box flexDirection="column">
      <Box>
        <Text color="gray">{"── "}{strategyName}{" ──"}</Text>
      </Box>
      {visible.map((line, i) => (
        <DiffLineRow key={i} line={line} />
      ))}
      {overflow > 0 && (
        <Text dimColor>{"  "}... {overflow} more line{overflow === 1 ? "" : "s"}</Text>
      )}
    </Box>
  );
}

function DiffLineRow({ line }: { line: DiffLine }) {
  switch (line.type) {
    case "added":
      return (
        <Box>
          <Text color="green">{"+ "}{line.content}</Text>
        </Box>
      );
    case "removed":
      return (
        <Box>
          <Text color="red">{"- "}{line.content}</Text>
        </Box>
      );
    case "header":
      return (
        <Box>
          <Text color="gray">{"── "}{line.content}{" ──"}</Text>
        </Box>
      );
    case "unchanged":
    default:
      return (
        <Box>
          <Text dimColor>{"  "}{line.content}</Text>
        </Box>
      );
  }
}
