import React from "react";
import { Box, Text, useStdout } from "ink";
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
  accent: string;
}

export function getDeskToneTokens(tone: DeskTone = "neutral"): DeskToneTokens {
  switch (tone) {
    case "brand":
      return { border: COLORS.BRASS_DIM, label: COLORS.BRASS, title: COLORS.WHITE, meta: COLORS.DIM, accent: COLORS.BRASS };
    case "success":
      return { border: COLORS.MONEY_DIM, label: COLORS.MONEY, title: COLORS.WHITE, meta: COLORS.DIM, accent: COLORS.MONEY };
    case "danger":
      return { border: COLORS.RISK_DIM, label: COLORS.RISK, title: COLORS.WHITE, meta: COLORS.DIM, accent: COLORS.RISK };
    case "warning":
      return { border: COLORS.AMBER_DIM, label: COLORS.AMBER, title: COLORS.WHITE, meta: COLORS.DIM, accent: COLORS.AMBER };
    case "info":
      return { border: COLORS.ICE_DIM, label: COLORS.ICE, title: COLORS.WHITE, meta: COLORS.DIM, accent: COLORS.ICE };
    case "analysis":
      return { border: COLORS.VIOLET_DIM, label: COLORS.VIOLET, title: COLORS.WHITE, meta: COLORS.DIM, accent: COLORS.VIOLET };
    case "operate":
      return { border: COLORS.ORANGE_DIM, label: COLORS.ORANGE, title: COLORS.WHITE, meta: COLORS.DIM, accent: COLORS.ORANGE };
    case "neutral":
    default:
      return { border: COLORS.BRASS_DIM, label: COLORS.BRASS, title: COLORS.WHITE, meta: COLORS.DIM, accent: COLORS.BRASS };
  }
}

function buildRule(length: number, glyph: string = "─"): string {
  return glyph.repeat(Math.max(8, length));
}

interface DeskPanelProps {
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  tone?: DeskTone;
  compact?: boolean;
  selected?: boolean;
  children?: React.ReactNode;
}

export function DeskPanel({
  eyebrow,
  title,
  subtitle,
  tone = "neutral",
  compact = false,
  selected = false,
  children,
}: DeskPanelProps): React.ReactElement {
  const tokens = getDeskToneTokens(tone);
  const { stdout } = useStdout();
  const borderColor = selected ? tokens.accent : tokens.border;
  const labelColor = selected ? COLORS.WHITE : tokens.label;
  const rule = buildRule(
    Math.min(compact ? 28 : 44, Math.max(12, (stdout?.columns ?? 120) - (compact ? 18 : 24))),
  );

  return (
    <Box flexDirection="column">
      {(eyebrow || title || subtitle) && (
        <Box flexDirection="column" marginBottom={children ? 1 : 0}>
          <Box>
            <Text color={labelColor} bold>
              {selected ? "▶ " : ""}[{(eyebrow ?? "Desk").toUpperCase()}]
            </Text>
            <Text color={borderColor}> {rule}</Text>
          </Box>
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

      {children && (
        <Box flexDirection="row">
          <Text color={tokens.accent}>
            {selected ? "█" : compact ? "▌" : "┃"}
          </Text>
          <Box flexDirection="column" marginLeft={1} flexGrow={1}>
            {children}
          </Box>
        </Box>
      )}

      {!compact && (
        <Box marginTop={children ? 1 : 0}>
          <Text color={borderColor}>
            {buildRule(Math.max(18, Math.floor(rule.length * 0.7)))}
          </Text>
        </Box>
      )}
    </Box>
  );
}

export default DeskPanel;
