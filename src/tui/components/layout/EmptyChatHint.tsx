import React from "react";
import { Box, Text } from "../../ink-custom";
import { useTheme } from "../../themes/ThemeProvider.tsx";

export function EmptyChatHint({ hasExchange }: { hasExchange: boolean }): React.JSX.Element {
  const theme = useTheme();
  return (
    <Box flexDirection="column" paddingLeft={2} marginBottom={1}>
      <Text color={theme.uiBrand}>Gordon is ready.</Text>
      <Text dimColor>
        {hasExchange
          ? "Try /scan, /portfolio, /plan BTC, or /modes."
          : "Connect a venue with /setup, or use /modes to choose a safe planning mode."}
      </Text>
    </Box>
  );
}
