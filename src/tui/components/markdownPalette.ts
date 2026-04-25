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
  /** Positive deltas: +pct, +$amount, gains. */
  green: "#00C853",
  /** Negative deltas: -pct, -$amount, losses, drawdowns. */
  red: "#FF3B30",
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
  green: ansi24(PALETTE.green),
  red: ansi24(PALETTE.red),
} as const;

/**
 * Match signed numeric literals: +54.5%, -0.83%, -1.49, +$100, -$50.5,
 * +0.022. Used for green/red delta coloring inside markdown text.
 *
 * Lookbehind rejects matches preceded by a word char or another dash, so
 * neither a range like "10-20%" nor a hyphenated word like "co-author"
 * is mis-coloured. Lookahead requires a digit after the optional $, so
 * the sign always ends up attached to a real number.
 *
 * `g` so the regex is reusable across calls; we always reset .lastIndex
 * with .exec or use String.matchAll.
 */
export const SIGNED_NUMBER_RE = /(?<![\w\-])[+\-]\$?\d[\d,]*(?:\.\d+)?%?/g;

/** Pick green (positive) or red (negative) based on the sign char. */
export function deltaColor(sign: string): string {
  return sign === "-" ? PALETTE.red : PALETTE.green;
}

/** ANSI variant of deltaColor — for embedded escapes in table cells. */
export function deltaAnsi(sign: string): string {
  return sign === "-" ? ANSI.red : ANSI.green;
}

/** Heading color by depth (1–6). Levels 5–6 collapse to platinum. */
export function headingColor(depth: number): string {
  switch (depth) {
    case 1: return PALETTE.gold;
    case 2: return PALETTE.amber;
    case 3: return PALETTE.platinum;
    default: return PALETTE.ash;
  }
}
