import React from "react";
import { Box, Text } from "ink";

import { COLORS } from "../../theme.ts";
import { DeskPanel, type DeskTone, getDeskToneColor } from "./DeskPanel.tsx";

interface DeskRailProps {
  title: string;
  subtitle?: string;
  tone?: DeskTone;
  children?: React.ReactNode;
}

export const DeskRail: React.FC<DeskRailProps> = ({
  title,
  subtitle,
  tone = "brand",
  children,
}) => {
  const toneColor = getDeskToneColor(tone);

  return (
    <DeskPanel eyebrow="Interlock" title={title} subtitle={subtitle} tone={tone} compact>
      <Box flexDirection="column">
        <Text color={toneColor}>{"=".repeat(18)}</Text>
        {children}
      </Box>
    </DeskPanel>
  );
};

