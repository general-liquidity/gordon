import React from "react";
import { Box, Text } from "../../ink-custom";
import type { DiffLine } from "./colorDiff.js";

// ============================================================================
// DiffDetailView — Paginated diff renderer with line numbers
// ============================================================================

interface Props {
  lines: DiffLine[];
  startLine?: number;
  pageSize?: number;
}

export function DiffDetailView({ lines, startLine = 0, pageSize = 30 }: Props) {
  const page = lines.slice(startLine, startLine + pageSize);

  return (
    <Box flexDirection="column">
      {page.map((line, idx) => {
        const absIdx = startLine + idx;
        return <LineRow key={absIdx} line={line} absIdx={absIdx} />;
      })}
    </Box>
  );
}

function LineRow({ line, absIdx }: { line: DiffLine; absIdx: number }) {
  const lineNumStr = line.lineNum != null
    ? String(line.lineNum).padStart(4)
    : "    ";

  switch (line.type) {
    case "added":
      return (
        <Box>
          <Text dimColor>{lineNumStr} </Text>
          <Text color="green">{"+"} {line.content}</Text>
        </Box>
      );
    case "removed":
      return (
        <Box>
          <Text dimColor>{lineNumStr} </Text>
          <Text color="red">{"-"} {line.content}</Text>
        </Box>
      );
    case "header":
      return (
        <Box>
          <Text dimColor>{"    "} </Text>
          <Text color="gray">{"── "}{line.content}{" ──"}</Text>
        </Box>
      );
    case "unchanged":
    default:
      return (
        <Box>
          <Text dimColor>{lineNumStr} </Text>
          <Text dimColor>{"  "}{line.content}</Text>
        </Box>
      );
  }

  void absIdx; // lineNum from DiffLine is used; absIdx kept for key
}
