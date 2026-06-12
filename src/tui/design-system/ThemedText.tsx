import React from "react";
import { Text, type TextProps } from "../ink-custom";
import type { GordonTheme } from "../themes/themes.ts";
import { useTheme } from "../themes/ThemeProvider.tsx";

// ============================================================================
// ThemedText — Text with semantic tone colours
//
// Maps tone names to active theme tokens.
// ============================================================================

export type TextTone = "brand" | "success" | "error" | "warning" | "info" | "muted";

interface Props extends TextProps {
  tone?: TextTone;
}

export function toneColor(tone: TextTone, theme: GordonTheme): { color?: string; dimColor?: boolean } {
  switch (tone) {
    case "brand":
      return { color: theme.uiBrand };
    case "success":
      return { color: theme.riskSafe };
    case "error":
      return { color: theme.variantError };
    case "warning":
      return { color: theme.riskWarning };
    case "info":
      return { color: theme.uiInfo };
    case "muted":
      return { dimColor: true };
  }
}

export function ThemedText({ tone, children, ...rest }: Props) {
  const theme = useTheme();
  const toneProps = tone ? toneColor(tone, theme) : {};
  return (
    <Text {...toneProps} {...rest}>
      {children}
    </Text>
  );
}
