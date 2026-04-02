import React from "react";
import { Box, Text, useStdout } from "ink";
import { COLORS } from "../../theme.ts";
import { getDeskToneTokens, type DeskTone } from "./DeskPanel.tsx";

interface TicketCardProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  tone?: DeskTone;
  actions?: string[];
  selected?: boolean;
  children?: React.ReactNode;
}

export function TicketCard({
  eyebrow,
  title,
  subtitle,
  tone = "neutral",
  actions,
  selected = false,
  children,
}: TicketCardProps): React.ReactElement {
  const tokens = getDeskToneTokens(tone);
  const { stdout } = useStdout();
  const ruleWidth = Math.max(12, Math.min((stdout?.columns ?? 120) - 20, 36));
  const headerRule = "─".repeat(ruleWidth);
  const footerRule = "─".repeat(Math.max(18, ruleWidth + 8));
  const headerLabel = (eyebrow ?? "Ticket").toUpperCase();
  const borderColor = selected ? tokens.accent : tokens.border;
  const labelColor = selected ? COLORS.WHITE : tokens.label;

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={borderColor}>{selected ? "┏━" : "┌─"}</Text>
        <Text color={labelColor} bold>{selected ? `▶ ${headerLabel}` : headerLabel}</Text>
        <Text color={borderColor}> {headerRule}</Text>
      </Box>
      <Box flexDirection="row">
        <Text color={tokens.accent}>│</Text>
        <Box flexDirection="column" marginLeft={1} flexGrow={1}>
          <Text color={tokens.title} bold>
            {title}
          </Text>
          {subtitle && (
            <Text color={tokens.meta}>
              {subtitle}
            </Text>
          )}
          {children && (
            <Box marginTop={1} flexDirection="column">
              {children}
            </Box>
          )}
          {actions && actions.length > 0 && (
            <Box marginTop={1} flexWrap="wrap">
              <Text color={COLORS.DIM}>
                Next:
              </Text>
              <Text color={COLORS.WHITE}>
                {" "}{actions.join(" · ")}
              </Text>
            </Box>
          )}
        </Box>
      </Box>
      <Box>
        <Text color={borderColor}>{selected ? "┗" : "└"}{footerRule}</Text>
      </Box>
    </Box>
  );
}

export default TicketCard;
