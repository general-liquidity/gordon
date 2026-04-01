import React from "react";
import { Box, Text } from "ink";
import { COLORS } from "../../theme.ts";
import { getDeskToneTokens, type DeskTone } from "./DeskPanel.tsx";

interface BlotterRowProps {
  label: string;
  value: string;
  detail?: string;
  tone?: DeskTone;
}

export function BlotterRow({
  label,
  value,
  detail,
  tone = "neutral",
}: BlotterRowProps): React.ReactElement {
  const tokens = getDeskToneTokens(tone);

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color={tokens.label} bold>
          {label.toUpperCase()}
        </Text>
        <Text color={COLORS.DIM}> · </Text>
        <Text color={COLORS.WHITE}>
          {value}
        </Text>
      </Box>
      {detail && (
        <Text color={COLORS.DIM}>
          {detail}
        </Text>
      )}
    </Box>
  );
}

export default BlotterRow;
