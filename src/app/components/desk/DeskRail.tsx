import React from "react";
import { Box, Text, useStdout } from "ink";
import { COLORS } from "../../theme.ts";
import { getDeskToneTokens, type DeskTone } from "./DeskPanel.tsx";

interface DeskRailProps {
  title?: string;
  subtitle?: string;
  tone?: DeskTone;
  children: React.ReactNode;
}

export function DeskRail({
  title,
  subtitle,
  tone = "brand",
  children,
}: DeskRailProps): React.ReactElement {
  const tokens = getDeskToneTokens(tone);
  const { stdout } = useStdout();
  const width = Math.max(24, Math.min((stdout?.columns ?? 120) - 4, 120));
  const topRule = "═".repeat(width);
  const bottomRule = "─".repeat(Math.max(18, width - 8));

  return (
    <Box flexDirection="column" width="100%">
      <Text color={tokens.border}>{topRule}</Text>
      {(title || subtitle) && (
        <Box marginBottom={1} flexWrap="wrap">
          {title && (
            <Text color={tokens.label} bold>
              {title.toUpperCase()}
            </Text>
          )}
          {subtitle && (
            <Text color={COLORS.DIM}>
              {title ? " · " : ""}
              {subtitle}
            </Text>
          )}
        </Box>
      )}
      {children}
      <Box marginTop={1}>
        <Text color={tokens.border}>{bottomRule}</Text>
      </Box>
    </Box>
  );
}

export default DeskRail;
