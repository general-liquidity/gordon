import React from "react";
import { Box, Text } from "ink";
import { COLORS } from "../../theme.ts";
import { getDeskToneTokens, type DeskTone } from "./DeskPanel.tsx";

interface TicketCardProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  tone?: DeskTone;
  actions?: string[];
  children?: React.ReactNode;
}

export function TicketCard({
  eyebrow,
  title,
  subtitle,
  tone = "neutral",
  actions,
  children,
}: TicketCardProps): React.ReactElement {
  const tokens = getDeskToneTokens(tone);

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={tokens.border}
      paddingX={1}
      paddingY={0}
    >
      {eyebrow && (
        <Text color={tokens.label} bold>
          {eyebrow.toUpperCase()}
        </Text>
      )}
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
        <Box marginTop={1}>
          <Text color={COLORS.DIM}>
            {actions.join(" · ")}
          </Text>
        </Box>
      )}
    </Box>
  );
}

export default TicketCard;
