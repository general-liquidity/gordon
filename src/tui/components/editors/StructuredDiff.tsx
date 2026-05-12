import React from "react";
import { Box, Text } from "../../ink-custom";

// ============================================================================
// StructuredDiff — Syntax-highlighted unified diff with line numbers
// ============================================================================

export interface DiffLine { type: "add" | "remove" | "context"; content: string; }
export interface DiffHunk { oldStart: number; newStart: number; lines: DiffLine[]; }

interface Props { hunks: DiffHunk[]; filePath?: string; }

const COLORS = { add: "green", remove: "red", context: undefined } as const;
const PREFIXES = { add: "+", remove: "-", context: " " } as const;

export function StructuredDiff({ hunks, filePath }: Props) {
  let oldLine = 0, newLine = 0;
  return (
    <Box flexDirection="column">
      {filePath ? <Text bold dimColor>{filePath}</Text> : null}
      {hunks.map((hunk, hi) => {
        oldLine = hunk.oldStart; newLine = hunk.newStart;
        return (
          <Box key={hi} flexDirection="column">
            <Text color="cyan">@@ -{hunk.oldStart} +{hunk.newStart} @@</Text>
            {hunk.lines.map((line, li) => {
              const ln = line.type === "remove" ? (oldLine++).toString().padStart(4) :
                         line.type === "add" ? (newLine++).toString().padStart(4) :
                         (oldLine++, (newLine++).toString().padStart(4));
              return (
                <Box key={li}>
                  <Text dimColor>{ln} </Text>
                  <Text color={COLORS[line.type]}>{PREFIXES[line.type]}{line.content}</Text>
                </Box>
              );
            })}
          </Box>
        );
      })}
    </Box>
  );
}
