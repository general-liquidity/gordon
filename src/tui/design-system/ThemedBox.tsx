import React from "react";
import { Box, type BoxProps } from "ink";

// ============================================================================
// ThemedBox — Box with semantic color tokens
//
// Thin wrapper around Ink Box for semantic naming.  Terminals generally
// don't support background colours well, so tokens resolve to no-bg styles.
// ============================================================================

type ColorToken = "surface" | "elevated" | "overlay" | "sunken";

interface Props extends BoxProps {
  colorToken?: ColorToken;
}

// Token → style mapping (kept intentionally minimal for terminal compat)
const tokenStyles: Record<ColorToken, Partial<BoxProps>> = {
  surface: {},
  elevated: {},
  overlay: { borderStyle: "round" },
  sunken: {},
};

export function ThemedBox({ colorToken, ...rest }: Props) {
  const tokenProps = colorToken ? tokenStyles[colorToken] : {};
  return <Box {...tokenProps} {...rest} />;
}
