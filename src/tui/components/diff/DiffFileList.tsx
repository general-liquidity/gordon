import React, { useState } from "react";
import { Box, Text, useInput } from "../../ink-custom";

// ============================================================================
// DiffFileList — Navigable list of changed strategy/config files
//
// M=yellow (modified), A=green (added), D=red (removed)
// Arrow keys to navigate, Enter to select.
// ============================================================================

export interface FileChange {
  name: string;
  changeType: "modified" | "added" | "removed";
  linesAdded?: number;
  linesRemoved?: number;
}

interface Props {
  files: FileChange[];
  onSelect: (file: FileChange) => void;
}

const CHANGE_SYMBOL: Record<FileChange["changeType"], string> = {
  modified: "M",
  added: "A",
  removed: "D",
};

const CHANGE_COLOR: Record<FileChange["changeType"], string> = {
  modified: "yellow",
  added: "green",
  removed: "red",
};

export function DiffFileList({ files, onSelect }: Props) {
  const [focusIdx, setFocusIdx] = useState(0);

  useInput((_, key) => {
    if (key.upArrow) {
      setFocusIdx((i) => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setFocusIdx((i) => Math.min(files.length - 1, i + 1));
    } else if (key.return) {
      const file = files[focusIdx];
      if (file) onSelect(file);
    }
  });

  if (files.length === 0) {
    return (
      <Box paddingX={2}>
        <Text dimColor>No changes.</Text>
      </Box>
    );
  }

  const maxName = Math.max(...files.map((f) => f.name.length));

  return (
    <Box flexDirection="column">
      {files.map((file, i) => {
        const isFocused = i === focusIdx;
        const sym = CHANGE_SYMBOL[file.changeType];
        const col = CHANGE_COLOR[file.changeType];

        return (
          <Box key={file.name}>
            <Text color={isFocused ? "cyanBright" : undefined}>
              {isFocused ? "▸ " : "  "}
            </Text>
            <Text color={col as string} bold>{sym}</Text>
            <Text> </Text>
            <Text bold={isFocused} color={isFocused ? "cyanBright" : undefined}>
              {file.name.padEnd(maxName + 2)}
            </Text>
            {file.linesAdded != null && file.linesAdded > 0 && (
              <Text color="green">+{file.linesAdded} </Text>
            )}
            {file.linesRemoved != null && file.linesRemoved > 0 && (
              <Text color="red">-{file.linesRemoved}</Text>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
