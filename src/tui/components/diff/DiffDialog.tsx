import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { StrategyDiff } from "./StrategyDiff.js";

// ============================================================================
// DiffDialog — Full-screen diff viewer dialog
//
// Bordered round box (gray). Shows StrategyDiff inside.
// Escape/q to close. Arrow keys scroll (passed as startLine to StrategyDiff).
// ============================================================================

interface Props {
  title?: string;
  before: string;
  after: string;
  fileName?: string;
  onClose: () => void;
}

const PAGE_STEP = 5;

export function DiffDialog({ title, before, after, fileName, onClose }: Props) {
  const [scrollOffset, setScrollOffset] = useState(0);
  const displayTitle = title ?? `DIFF: ${fileName ?? "Changes"}`;

  useInput((input, key) => {
    if (key.escape || input === "q" || input === "Q") {
      onClose();
    } else if (key.upArrow) {
      setScrollOffset((o) => Math.max(0, o - 1));
    } else if (key.downArrow) {
      setScrollOffset((o) => o + 1);
    } else if (key.pageUp) {
      setScrollOffset((o) => Math.max(0, o - PAGE_STEP));
    } else if (key.pageDown) {
      setScrollOffset((o) => o + PAGE_STEP);
    }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="gray"
      paddingX={1}
      paddingY={0}
    >
      <Box marginBottom={1}>
        <Text bold color="gray">{displayTitle}</Text>
      </Box>
      <StrategyDiff
        strategyName={fileName ?? "Changes"}
        before={before}
        after={after}
        maxLines={30}
      />
      <Box marginTop={1}>
        <Text dimColor>[Q/Esc] Close</Text>
        <Text dimColor> · </Text>
        <Text dimColor>[↑↓] Scroll</Text>
      </Box>
    </Box>
  );
}
