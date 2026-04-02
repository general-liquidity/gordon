import React from "react";
import { Box, Text, useStdout } from "ink";
import { COLORS } from "../../theme.ts";
import { getDeskToneTokens, type DeskTone } from "../desk/DeskPanel.tsx";

interface SurfaceFrameProps {
  eyebrow: string;
  title: string;
  subtitle?: string;
  tone?: DeskTone;
  selected?: boolean;
  actions?: string[];
  children?: React.ReactNode;
}

export function SurfaceFrame({
  eyebrow,
  title,
  subtitle,
  tone = "neutral",
  selected = false,
  actions,
  children,
}: SurfaceFrameProps): React.ReactElement {
  const tokens = getDeskToneTokens(tone);
  const { stdout } = useStdout();
  const columns = stdout?.columns ?? 120;
  const ruleWidth = Math.max(10, Math.min(40, columns - eyebrow.length - 24));
  const rule = "─".repeat(ruleWidth);

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={selected ? tokens.accent : tokens.label} bold>
          {selected ? "▶ " : ""}[{eyebrow.toUpperCase()}]
        </Text>
        <Text color={selected ? tokens.accent : tokens.border}> {rule}</Text>
      </Box>
      <Box flexDirection="row" marginTop={1}>
        <Text color={selected ? tokens.accent : tokens.border}>
          {selected ? "█" : "┃"}
        </Text>
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
            <Box flexDirection="column" marginTop={1}>
              {children}
            </Box>
          )}
          {selected && actions && actions.length > 0 && (
            <Box marginTop={1} flexWrap="wrap">
              <Text color={COLORS.DIM}>Act</Text>
              <Text color={COLORS.WHITE}> {" "}{actions.slice(0, 4).join(" · ")}</Text>
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}

export default SurfaceFrame;
