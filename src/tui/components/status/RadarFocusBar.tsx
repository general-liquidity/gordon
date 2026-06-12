import React from "react";
import { Box, Text } from "../../ink-custom";
import type { RadarFocus } from "../../state/types.ts";
import { useTheme } from "../../themes/ThemeProvider.tsx";

export function RadarFocusBar({ focus }: { focus: RadarFocus | null }): React.JSX.Element | null {
  const theme = useTheme();
  if (!focus) return null;

  return (
    <Box paddingX={2}>
      <Text color={theme.uiFocus} bold>[RADAR]</Text>
      <Text> {focus.title}</Text>
      <Text dimColor> · a ack · p pass · d snooze · Esc release</Text>
    </Box>
  );
}
