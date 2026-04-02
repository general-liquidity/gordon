import React from "react";
import { Box, Text } from "ink";

import { COLORS } from "../../theme.ts";
import { type DeskTone, getDeskToneColor } from "./DeskPanel.tsx";

interface TicketCardProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  tone?: DeskTone;
  actions?: string[];
  children?: React.ReactNode;
}

export const TicketCard: React.FC<TicketCardProps> = ({
  eyebrow,
  title,
  subtitle,
  tone = "brand",
  actions,
  children,
}) => {
  const toneColor = getDeskToneColor(tone);
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={toneColor}
      paddingX={1}
      paddingY={1}
      marginBottom={1}
    >
      {eyebrow ? <Text color={COLORS.BRASS_DIM}>{eyebrow.toUpperCase()}</Text> : null}
      <Text color={toneColor} bold>{title}</Text>
      {subtitle ? <Text color={COLORS.DIM}>{subtitle}</Text> : null}
      {actions && actions.length > 0 ? <Text color={COLORS.DIM}>{actions.join("  ")}</Text> : null}
      {children ? <Box marginTop={1} flexDirection="column">{children}</Box> : null}
    </Box>
  );
};
