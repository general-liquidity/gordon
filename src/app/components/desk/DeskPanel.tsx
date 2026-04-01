import React from "react";
import { Box, Text } from "ink";
import { COLORS } from "../../theme.ts";

export type DeskTone =
  | "neutral"
  | "brand"
  | "success"
  | "danger"
  | "warning"
  | "info"
  | "analysis"
  | "operate";

export interface DeskToneTokens {
  border: string;
  label: string;
  title: string;
  meta: string;
}

export function getDeskToneTokens(tone: DeskTone = "neutral"): DeskToneTokens {
  switch (tone) {
    case "brand":
      return { border: COLORS.BRASS_DIM, label: COLORS.BRASS, title: COLORS.WHITE, meta: COLORS.DIM };
    case "success":
      return { border: COLORS.MONEY_DIM, label: COLORS.MONEY, title: COLORS.WHITE, meta: COLORS.DIM };
    case "danger":
      return { border: COLORS.RISK_DIM, label: COLORS.RISK, title: COLORS.WHITE, meta: COLORS.DIM };
    case "warning":
      return { border: COLORS.AMBER_DIM, label: COLORS.AMBER, title: COLORS.WHITE, meta: COLORS.DIM };
    case "info":
      return { border: COLORS.ICE_DIM, label: COLORS.ICE, title: COLORS.WHITE, meta: COLORS.DIM };
    case "analysis":
      return { border: COLORS.VIOLET_DIM, label: COLORS.VIOLET, title: COLORS.WHITE, meta: COLORS.DIM };
    case "operate":
      return { border: COLORS.ORANGE_DIM, label: COLORS.ORANGE, title: COLORS.WHITE, meta: COLORS.DIM };
    case "neutral":
    default:
      return { border: COLORS.BRASS_DIM, label: COLORS.BRASS, title: COLORS.WHITE, meta: COLORS.DIM };
  }
}

interface DeskPanelProps {
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  tone?: DeskTone;
  compact?: boolean;
  children?: React.ReactNode;
}

export function DeskPanel({
  eyebrow,
  title,
  subtitle,
  tone = "neutral",
  compact = false,
  children,
}: DeskPanelProps): React.ReactElement {
  const tokens = getDeskToneTokens(tone);

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={tokens.border}
      paddingX={compact ? 1 : 2}
      paddingY={compact ? 0 : 1}
    >
      {(eyebrow || title || subtitle) && (
        <Box flexDirection="column" marginBottom={children ? 1 : 0}>
          {eyebrow && (
            <Text color={tokens.label} bold>
              {eyebrow.toUpperCase()}
            </Text>
          )}
          {title && (
            <Text color={tokens.title} bold>
              {title}
            </Text>
          )}
          {subtitle && (
            <Text color={tokens.meta}>
              {subtitle}
            </Text>
          )}
        </Box>
      )}
      {children}
    </Box>
  );
}

export default DeskPanel;
