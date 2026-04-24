import React from "react";
import { Box, Text } from "ink";

// CollapsedReadSearchContent — collapsible view for large search/scan results.
// Collapsed: ⎿ {summary} · {N} lines [E] expand
// Expanded:  shows scroll-truncated content lines.

interface Props {
  summary: string;
  lineCount: number;
  onExpand: () => void;
  expanded?: boolean;
  lines?: string[];
}

const MAX_VISIBLE_LINES = 12;

export const CollapsedReadSearchContent = React.memo(function CollapsedReadSearchContent({
  summary,
  lineCount,
  onExpand,
  expanded = false,
  lines = [],
}: Props) {
  if (!expanded) {
    return (
      <Box flexDirection="row" marginTop={0}>
        <Text dimColor>{"⎿ "}</Text>
        <Text dimColor>{summary}</Text>
        <Text dimColor>{" · "}</Text>
        <Text dimColor>{lineCount} line{lineCount !== 1 ? "s" : ""}</Text>
        <Text dimColor>{" [E] expand"}</Text>
      </Box>
    );
  }

  const visible = lines.slice(0, MAX_VISIBLE_LINES);
  const overflow = lines.length - visible.length;

  return (
    <Box flexDirection="column" marginTop={0}>
      <Box flexDirection="row">
        <Text dimColor>{"⎿ "}</Text>
        <Text dimColor>{summary}</Text>
        <Text dimColor>{" · "}</Text>
        <Text dimColor>{lineCount} line{lineCount !== 1 ? "s" : ""}</Text>
      </Box>
      <Box flexDirection="column" paddingLeft={3}>
        {visible.map((line, i) => (
          <Text key={i} dimColor>{line}</Text>
        ))}
        {overflow > 0 && (
          <Text dimColor>{`... (+${overflow} more)`}</Text>
        )}
      </Box>
    </Box>
  );
});
