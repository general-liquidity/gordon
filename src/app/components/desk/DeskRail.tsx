import React from "react";
import { Box, Text } from "ink";
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

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={tokens.border}
      paddingX={1}
      paddingY={0}
      width="100%"
    >
      {(title || subtitle) && (
        <Box marginBottom={1}>
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
    </Box>
  );
}

export default DeskRail;
