import React from "react";
import { Box, Text } from "ink";

import { COLORS } from "../../theme.ts";

export type DeskTone =
  | "brand"
  | "info"
  | "success"
  | "warning"
  | "danger"
  | "analysis"
  | "operate"
  | "neutral"
  | "muted";

export interface DeskPanelProps {
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  tone?: DeskTone;
  compact?: boolean;
  actions?: string[];
  children?: React.ReactNode;
}

export function getDeskToneColor(tone: DeskTone = "brand"): string {
  switch (tone) {
    case "info":
      return COLORS.ICE;
    case "success":
      return COLORS.MONEY;
    case "warning":
      return COLORS.AMBER;
    case "danger":
      return COLORS.RISK;
    case "analysis":
      return COLORS.VIOLET;
    case "operate":
      return COLORS.ORANGE;
    case "neutral":
      return COLORS.WHITE;
    case "muted":
      return COLORS.BRASS_DIM;
    case "brand":
    default:
      return COLORS.BRASS;
  }
}

export const DeskPanel: React.FC<DeskPanelProps> = ({
  eyebrow,
  title,
  subtitle,
  tone = "brand",
  compact = false,
  actions,
  children,
}) => {
  const toneColor = getDeskToneColor(tone);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={toneColor}
      paddingX={1}
      paddingY={compact ? 0 : 1}
      marginBottom={1}
    >
      <Box flexDirection="column">
        {eyebrow ? (
          <Text color={COLORS.BRASS_DIM}>
            {eyebrow.toUpperCase()}
          </Text>
        ) : null}
        {title ? <Text color={toneColor} bold>{title}</Text> : null}
        {subtitle ? <Text color={COLORS.DIM}>{subtitle}</Text> : null}
        {actions && actions.length > 0 ? (
          <Text color={COLORS.DIM}>{actions.join("  ")}</Text>
        ) : null}
      </Box>
      {children ? <Box marginTop={compact ? 0 : 1} flexDirection="column">{children}</Box> : null}
    </Box>
  );
};
