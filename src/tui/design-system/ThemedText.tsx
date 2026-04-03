import React from "react";
import { Text, type TextProps } from "ink";

// ============================================================================
// ThemedText — Text with semantic tone colours
//
// Maps tone names to terminal-safe ANSI colours.
// ============================================================================

type Tone = "brand" | "success" | "error" | "warning" | "info" | "muted";

interface Props extends TextProps {
  tone?: Tone;
}

const toneMap: Record<Tone, Partial<TextProps>> = {
  brand: { color: "cyanBright" },
  success: { color: "green" },
  error: { color: "red" },
  warning: { color: "yellow" },
  info: { color: "cyan" },
  muted: { dimColor: true },
};

export function ThemedText({ tone, children, ...rest }: Props) {
  const toneProps = tone ? toneMap[tone] : {};
  return (
    <Text {...toneProps} {...rest}>
      {children}
    </Text>
  );
}
