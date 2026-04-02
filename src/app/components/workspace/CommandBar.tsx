import React from "react";
import { Box, Text, useStdout } from "ink";
import { COLORS } from "../../theme.ts";

interface CommandBarProps {
  busy?: boolean;
  queueDepth?: number;
  disabled?: boolean;
  children: React.ReactNode;
  autocomplete?: React.ReactNode;
  hint?: string;
}

export function CommandBar({
  busy = false,
  queueDepth = 0,
  disabled = false,
  children,
  autocomplete,
  hint,
}: CommandBarProps): React.ReactElement {
  const { stdout } = useStdout();
  const headerTone = disabled
    ? COLORS.DIM
    : busy
      ? COLORS.AMBER
      : COLORS.BRASS;
  const borderTone = disabled
    ? COLORS.DIM
    : busy
      ? COLORS.AMBER_DIM
      : COLORS.BRASS_DIM;
  const stateLabel = disabled
    ? "LOCKED"
    : busy
      ? "LIVE"
      : queueDepth > 0
        ? `QUEUE ${queueDepth}`
        : "READY";
  const columns = stdout?.columns ?? 120;
  const ruleWidth = Math.max(28, Math.min(72, columns - 10));

  return (
    <Box marginX={1} flexDirection="column">
      <Box>
        <Text color={headerTone} bold>[CONTROL PLANE]</Text>
        <Text color={COLORS.DIM}> Prompt, slash, staged actions</Text>
      </Box>

      <Box marginTop={1}>
        <Text color={borderTone}>┌</Text>
        <Text color={borderTone}>{"─".repeat(ruleWidth)}</Text>
      </Box>

      <Box flexDirection="row">
        <Text color={headerTone}>│</Text>
        <Box flexDirection="column" marginLeft={1} flexGrow={1}>
          <Box flexWrap="wrap">
            <Text color={headerTone} bold>{stateLabel}</Text>
            <Text color={COLORS.DIM}>  Route the next move</Text>
          </Box>
          <Box marginTop={1}>
            {children}
          </Box>
          {autocomplete && (
            <Box marginTop={1}>
              {autocomplete}
            </Box>
          )}
          {hint && (
            <Box marginTop={1}>
              <Text color={COLORS.DIM}>{hint}</Text>
            </Box>
          )}
        </Box>
      </Box>

      <Box>
        <Text color={borderTone}>└</Text>
        <Text color={borderTone}>{"─".repeat(ruleWidth)}</Text>
      </Box>
    </Box>
  );
}

export default CommandBar;
