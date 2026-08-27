import type { ReactNode } from "react";
import { Box, Text, useStdout } from "../ink-custom";
import { useTheme } from "../themes/ThemeProvider.tsx";

// ============================================================================
// Pane — Bordered section container with colored top-line
//
// ┌── Title ──────────────────────────┐
// │  children                          │
// └────────────────────────────────────┘
//
// When modal=true, skips the divider and uses tighter padding.
// ============================================================================

interface Props {
  title?: string;
  color?: string;
  tone?: "brand" | "warning" | "danger" | "success" | "muted" | "info";
  modal?: boolean;
  children: ReactNode;
}

export function Pane({ title, color, tone = "brand", modal = false, children }: Props) {
  const { stdout } = useStdout();
  const theme = useTheme();
  const width = stdout?.columns ?? 80;
  const resolvedColor =
    color ??
    (tone === "warning"
      ? theme.riskWarning
      : tone === "danger"
        ? theme.riskDanger
        : tone === "success"
          ? theme.riskSafe
          : tone === "muted"
            ? theme.uiMuted
            : tone === "info"
              ? theme.uiInfo
              : theme.uiBrand);

  if (modal) {
    return (
      <Box flexDirection="column" paddingX={1}>
        {title ? (
          <Text color={resolvedColor} bold>
            {title}
          </Text>
        ) : null}
        {children}
      </Box>
    );
  }

  // Build the top border line
  const prefix = "\u2500\u2500 ";
  const suffix = " ";
  const titleStr = title ?? "";
  const lineChars = titleStr
    ? Math.max(0, width - prefix.length - titleStr.length - suffix.length - 2)
    : width - 2;

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={resolvedColor}>
          {titleStr
            ? `${prefix}${titleStr}${suffix}${"\u2500".repeat(lineChars)}`
            : "\u2500".repeat(width - 2)}
        </Text>
      </Box>
      <Box flexDirection="column" paddingX={2}>
        {children}
      </Box>
    </Box>
  );
}
