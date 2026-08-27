import type { ReactNode } from "react";
import { Box, Text, useStdout, type BoxProps } from "../ink-custom";
import type { GordonTheme } from "../themes/themes.ts";
import { useTheme } from "../themes/ThemeProvider.tsx";

// ============================================================================
// TitledBox / Panel — bordered box with the title embedded in the top border
//
// ╭─ ORDER PREVIEW ───────────────────────────────╮
// │  children                                       │
// ╰─────────────────────────────────────────────────╯
//
// Unlike Pane (which draws only a colored top rule), this renders a full
// bordered box. The title is spliced INTO the top border line using the same
// box-drawing glyphs the shipping ink@6 Box uses for the sides and bottom, so
// the joins line up. The top border is a composed Text row; the sides + bottom
// come from a real ink Box with borderTop disabled.
//
// Works on the shipping ink@6 path — no dependency on the custom renderer.
// ============================================================================

export type PanelAlign = "start" | "center" | "end";
export type PanelTone = "brand" | "warning" | "danger" | "success" | "muted" | "info";
export type PanelBorderStyle = "round" | "single" | "double" | "bold" | "classic";

interface TopCorners {
  topLeft: string;
  top: string;
  topRight: string;
}

// Only the top glyphs are needed here — the ink Box owns the rest. Values match
// cli-boxes (the table ink itself renders with) so the corners join cleanly.
const BOX_CHARS: Record<PanelBorderStyle, TopCorners> = {
  round: { topLeft: "╭", top: "─", topRight: "╮" },
  single: { topLeft: "┌", top: "─", topRight: "┐" },
  double: { topLeft: "╔", top: "═", topRight: "╗" },
  bold: { topLeft: "┏", top: "━", topRight: "┓" },
  classic: { topLeft: "+", top: "-", topRight: "+" },
};

export function panelToneColor(tone: PanelTone, theme: GordonTheme): string {
  switch (tone) {
    case "warning":
      return theme.riskWarning;
    case "danger":
      return theme.riskDanger;
    case "success":
      return theme.riskSafe;
    case "muted":
      return theme.uiMuted;
    case "info":
      return theme.uiInfo;
    case "brand":
      return theme.uiBrand;
  }
}

/**
 * Splice a title into a run of `innerWidth` horizontal border glyphs.
 * `innerWidth` is the width BETWEEN the two corners (i.e. total width - 2).
 * Returns a string of exactly `innerWidth` characters.
 */
export function embedTitleInBorder(
  innerWidth: number,
  title: string | undefined,
  align: PanelAlign,
  offset: number,
  h: string,
): string {
  if (innerWidth <= 0) return "";
  const trimmed = (title ?? "").trim();
  if (!trimmed) return h.repeat(innerWidth);

  let label = ` ${trimmed} `;
  if (label.length > innerWidth) {
    // Not enough room — truncate the title with an ellipsis, keep the spaces.
    const room = innerWidth - 2;
    if (room <= 1) return h.repeat(innerWidth);
    label = ` ${trimmed.slice(0, room - 1)}… `;
    if (label.length >= innerWidth) return label.slice(0, innerWidth);
    return label + h.repeat(innerWidth - label.length);
  }

  const remaining = innerWidth - label.length;
  const lead = Math.max(0, offset) + 1;
  let left: number;
  if (align === "center") {
    left = Math.floor(remaining / 2) + Math.max(0, offset);
  } else if (align === "end") {
    left = remaining - lead;
  } else {
    left = lead;
  }
  left = Math.max(0, Math.min(left, remaining));
  const right = remaining - left;
  return h.repeat(left) + label + h.repeat(right);
}

/** Build the full top border line (corners included), exactly `width` chars. */
export function buildTopBorder(opts: {
  width: number;
  title?: string;
  align?: PanelAlign;
  offset?: number;
  style?: PanelBorderStyle;
}): string {
  const { width, title, align = "start", offset = 0, style = "round" } = opts;
  const chars = BOX_CHARS[style];
  const innerWidth = Math.max(0, width - 2);
  const mid = embedTitleInBorder(innerWidth, title, align, offset, chars.top);
  return `${chars.topLeft}${mid}${chars.topRight}`;
}

interface Props extends Omit<BoxProps, "borderStyle" | "borderTop"> {
  title?: string;
  align?: PanelAlign;
  /** Extra horizontal glyphs before the title (start/end aligns). */
  offset?: number;
  tone?: PanelTone;
  /** Explicit border color — overrides `tone`. Accepts any ink color. */
  color?: string;
  borderStyle?: PanelBorderStyle;
  /** Fixed box width. Defaults to the terminal column count. */
  width?: number;
  children: ReactNode;
}

export function TitledBox({
  title,
  align = "start",
  offset = 0,
  tone = "brand",
  color,
  borderStyle = "round",
  width,
  paddingX = 1,
  children,
  ...rest
}: Props) {
  const { stdout } = useStdout();
  const theme = useTheme();
  const resolved = color ?? panelToneColor(tone, theme);
  const cols = width ?? stdout?.columns ?? 80;
  const w = Math.max(4, cols);
  const top = buildTopBorder({ width: w, title, align, offset, style: borderStyle });

  return (
    <Box flexDirection="column" width={w}>
      <Text color={resolved}>{top}</Text>
      <Box
        flexDirection="column"
        width={w}
        borderStyle={borderStyle}
        borderColor={resolved}
        borderTop={false}
        paddingX={paddingX}
        {...rest}
      >
        {children}
      </Box>
    </Box>
  );
}
