import type { ReactNode } from "react";
import { Box, Text, useInput, useStdout } from "../ink-custom";
import type { GordonTheme } from "../themes/themes.ts";
import { useTheme } from "../themes/ThemeProvider.tsx";

// ============================================================================
// Dialog — Modal dialog wrapper with border, title, and key handling
//
// ╭─ Title ──────────────────────────╮
// │  Optional subtitle               │
// │  children                        │
// ╰──────────────────────────────────╯
//
// Escape closes, Enter confirms. Captures input when mounted.
// ============================================================================

interface Props {
  title: string;
  subtitle?: string;
  tone?: "warning" | "danger" | "brand" | "info";
  onClose: () => void;
  onConfirm?: () => void;
  children: ReactNode;
}

function dialogToneColor(tone: NonNullable<Props["tone"]>, theme: GordonTheme): string {
  switch (tone) {
    case "warning":
      return theme.riskWarning;
    case "danger":
      return theme.riskDanger;
    case "brand":
      return theme.uiBrand;
    case "info":
      return theme.uiInfo;
  }
}

export function Dialog({ title, subtitle, tone = "warning", onClose, onConfirm, children }: Props) {
  const { stdout } = useStdout();
  const theme = useTheme();
  const width = Math.min(stdout?.columns ?? 80, 60);
  const color = dialogToneColor(tone, theme);

  useInput((_input, key) => {
    if (key.escape) {
      onClose();
    } else if (key.return && onConfirm) {
      onConfirm();
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={color} width={width} paddingX={1}>
      <Text color={color} bold>
        {title}
      </Text>
      {subtitle ? <Text dimColor>{subtitle}</Text> : null}
      <Box flexDirection="column" marginTop={1}>
        {children}
      </Box>
    </Box>
  );
}
