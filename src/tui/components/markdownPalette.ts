/**
 * Markdown Palette — Bloomberg / Wall-Street themed.
 *
 * Reserves green/red for trade-direction signals (handled by trade event
 * renderers, P&L badges, etc.) and uses amber/gold + platinum/white for
 * structural markdown elements. Avoids cyan/magenta/blue — those read as
 * "tech" rather than "finance".
 *
 * Hex strings work in Ink via chalk; the same hex is also encoded as
 * 24-bit ANSI escape sequences for inline rendering inside table cells
 * (where the InlineTable renderer composes a single string per row).
 */

export const PALETTE = {
  /** Top-level section emphasis. Bloomberg gold. */
  gold: "#FFD700",
  /** Sub-section emphasis + ticker / tool-name accent. Bloomberg amber. */
  amber: "#FFA500",
  /** Quiet headers, links, secondary emphasis. */
  platinum: "#E5E4E2",
  /** Ambient ornaments: borders, blockquote bars, horizontal rules. */
  ash: "#888888",
} as const;

/** ANSI 24-bit escape for embedding palette colors inside string-typed
 *  table cells. The width-cache strips ANSI before measuring, so column
 *  alignment stays correct. */
function ansi24(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `\x1b[38;2;${r};${g};${b}m`;
}

export const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  italic: "\x1b[3m",
  strike: "\x1b[9m",
  underline: "\x1b[4m",
  gold: ansi24(PALETTE.gold),
  amber: ansi24(PALETTE.amber),
  platinum: ansi24(PALETTE.platinum),
  ash: ansi24(PALETTE.ash),
} as const;

/** Heading color by depth (1–6). Levels 5–6 collapse to platinum. */
export function headingColor(depth: number): string {
  switch (depth) {
    case 1: return PALETTE.gold;
    case 2: return PALETTE.amber;
    case 3: return PALETTE.platinum;
    default: return PALETTE.ash;
  }
}
