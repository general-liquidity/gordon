import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { StructuredDiff, type DiffHunk } from "./StructuredDiff.js";

// ============================================================================
// DiffDialog — Browse diffs per trading session with file list and detail view
// ============================================================================

export interface FileDiff { path: string; additions: number; deletions: number; hunks: DiffHunk[]; }
interface Props { diffs: FileDiff[]; onClose: () => void; }

export function DiffDialog({ diffs, onClose }: Props) {
  const [selected, setSelected] = useState(0);
  const [viewDetail, setViewDetail] = useState(false);

  useInput((_, key) => {
    if (key.escape) { if (viewDetail) setViewDetail(false); else onClose(); }
    else if (key.return) setViewDetail(true);
    else if (key.upArrow && !viewDetail) setSelected((p) => Math.max(0, p - 1));
    else if (key.downArrow && !viewDetail) setSelected((p) => Math.min(diffs.length - 1, p + 1));
  });

  if (viewDetail && diffs[selected]) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
        <Text bold color="cyanBright">DIFF: {diffs[selected]!.path}</Text>
        <StructuredDiff hunks={diffs[selected]!.hunks} filePath={diffs[selected]!.path} />
        <Text dimColor>Esc to go back</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold color="cyanBright">SESSION DIFFS</Text>
      {diffs.map((diff, i) => (
        <Box key={i}>
          <Text color={i === selected ? "cyanBright" : undefined}>{i === selected ? "\u25B8 " : "  "}</Text>
          <Text bold={i === selected}>{diff.path}</Text>
          <Text color="green"> +{diff.additions}</Text>
          <Text color="red"> -{diff.deletions}</Text>
        </Box>
      ))}
      <Text dimColor>{diffs.length} files {"\u00B7"} Enter to view {"\u00B7"} Esc to close</Text>
    </Box>
  );
}
