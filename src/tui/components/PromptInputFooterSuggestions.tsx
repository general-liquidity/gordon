import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

// ============================================================================
// PromptInputFooterSuggestions — Context-aware trading prompt hints
//
// Shows 3 rotating suggestions below the input when NOT in slash command mode.
// Press 1/2/3 to select a suggestion.
//
// Layout (single line):
//   1 /scan trending   2 what's BTC doing?   3 /positions
// ============================================================================

interface Props {
  visible: boolean;
  onSelect: (suggestion: string) => void;
}

const ALL_SUGGESTIONS = [
  "/scan trending",
  "what's BTC doing?",
  "/positions",
  "should I take profit?",
  "/morning-brief",
  "any momentum plays?",
];

export function PromptInputFooterSuggestions({ visible, onSelect }: Props) {
  // Cycle offset increments so suggestions rotate across renders
  const [offset] = useState<number>(() => 0);

  useInput((input, _key) => {
    if (!visible) return;
    if (input === "1") {
      const s = ALL_SUGGESTIONS[(offset + 0) % ALL_SUGGESTIONS.length];
      if (s) onSelect(s);
    } else if (input === "2") {
      const s = ALL_SUGGESTIONS[(offset + 1) % ALL_SUGGESTIONS.length];
      if (s) onSelect(s);
    } else if (input === "3") {
      const s = ALL_SUGGESTIONS[(offset + 2) % ALL_SUGGESTIONS.length];
      if (s) onSelect(s);
    }
  });

  if (!visible) return null;

  const s1 = ALL_SUGGESTIONS[(offset + 0) % ALL_SUGGESTIONS.length] ?? "";
  const s2 = ALL_SUGGESTIONS[(offset + 1) % ALL_SUGGESTIONS.length] ?? "";
  const s3 = ALL_SUGGESTIONS[(offset + 2) % ALL_SUGGESTIONS.length] ?? "";

  return (
    <Box flexDirection="row" paddingLeft={2} gap={3}>
      <Text dimColor>
        <Text dimColor bold>1</Text>
        {" "}{s1}
      </Text>
      <Text dimColor>
        <Text dimColor bold>2</Text>
        {" "}{s2}
      </Text>
      <Text dimColor>
        <Text dimColor bold>3</Text>
        {" "}{s3}
      </Text>
    </Box>
  );
}
