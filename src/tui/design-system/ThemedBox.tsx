import React from "react";
import { Box, type BoxProps } from "../ink-custom";
import type { GordonTheme } from "../themes/themes.ts";
import { useTheme } from "../themes/ThemeProvider.tsx";

// ============================================================================
// ThemedBox — Box with semantic color tokens
//
// Thin wrapper around Ink Box for semantic naming.  Terminals generally
// don't support background colours well, so tokens resolve to no-bg styles.
// ============================================================================

type ColorToken = "surface" | "elevated" | "overlay" | "sunken";
type BorderTone = "default" | "focus" | "danger" | "brand";

interface Props extends BoxProps {
  colorToken?: ColorToken;
  borderTone?: BorderTone;
}

function borderToneColor(tone: BorderTone, theme: GordonTheme): string {
  switch (tone) {
    case "default":
      return theme.uiBorder;
    case "focus":
      return theme.uiFocus;
    case "danger":
      return theme.riskDanger;
    case "brand":
      return theme.uiBrand;
  }
}

export function ThemedBox({ colorToken, borderTone, borderStyle, borderColor, ...rest }: Props) {
  const theme = useTheme();
  const tokenProps: Partial<BoxProps> =
    colorToken === "overlay" ? { borderStyle: "round", borderColor: theme.uiBorder } : {};
  const toneProps: Partial<BoxProps> = borderTone
    ? { borderStyle: borderStyle ?? "round", borderColor: borderColor ?? borderToneColor(borderTone, theme) }
    : {};
  return <Box {...tokenProps} {...toneProps} borderStyle={borderStyle ?? toneProps.borderStyle ?? tokenProps.borderStyle} borderColor={borderColor ?? toneProps.borderColor ?? tokenProps.borderColor} {...rest} />;
}
