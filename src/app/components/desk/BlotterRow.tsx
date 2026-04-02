import React from "react";
import { Box, Text } from "ink";

import { COLORS } from "../../theme.ts";
import { type DeskTone, getDeskToneColor } from "./DeskPanel.tsx";

interface BlotterRowProps {
  label: string;
  value: string;
  detail?: string;
  tone?: DeskTone;
}

export const BlotterRow: React.FC<BlotterRowProps> = ({
  label,
  value,
  detail,
  tone = "muted",
}) => {
  return (
    <Box gap={1}>
      <Text color={COLORS.BRASS_DIM}>{label.toUpperCase()}</Text>
      <Text color={COLORS.DIM}>/</Text>
      <Text color={getDeskToneColor(tone)}>{value}</Text>
      {detail ? (
        <>
          <Text color={COLORS.DIM}>/</Text>
          <Text color={COLORS.DIM}>{detail}</Text>
        </>
      ) : null}
    </Box>
  );
};

