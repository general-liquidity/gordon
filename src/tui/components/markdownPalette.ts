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

/** Single number — optionally signed, optionally $, optionally %. */
const NUM = "[+\\-]?\\$?\\d[\\d,]*(?:\\.\\d+)?%?";
/** Number or range. Range connector is hyphen, en-dash, or "to". */
const NUM_RANGE = `${NUM}(?:\\s*(?:[\\-–]|to)\\s*${NUM})?`;
/**
 * Separator between label and number. Allows an optional " range" word
 * so "Drawdown range: 5-12%" matches the same as "Drawdown: 5-12%".
 * Also tolerates whitespace, colons, equals, and parens.
 */
const SEP = "(?:\\s+range)?[\\s:=()]+";

/**
 * Labels whose value should render green: win rate, total return,
 * gain, profit, etc. Matches the keyword + separator + number-or-range
 * and captures the number-or-range in group 1.
 */
export const POSITIVE_LABEL_RE = new RegExp(
  `\\b(?:win[\\s\\-]?rate|win range|hit[\\s\\-]?rate|success[\\s\\-]?rate|accuracy|total return|gain|profit|target|upside|return)\\b${SEP}(${NUM_RANGE})`,
  "gi",
);

/**
 * Labels whose value should render red: loss rate, drawdown, miss rate,
 * decline, etc. Same shape as POSITIVE_LABEL_RE — group 1 is the
 * number-or-range to color.
 */
export const NEGATIVE_LABEL_RE = new RegExp(
  `\\b(?:loss[\\s\\-]?rate|loss range|miss[\\s\\-]?rate|failure[\\s\\-]?rate|max[\\s\\-]?(?:dd|drawdown)|drawdown|max[\\s\\-]?loss|stop[\\s\\-]?loss|downside|decline|drop|loss)\\b${SEP}(${NUM_RANGE})`,
  "gi",
);

/** Pick green (positive) or red (negative) based on the sign char. */
export function deltaColor(sign: string): string {
  return sign === "-" ? PALETTE.red : PALETTE.green;
}

/** ANSI variant of deltaColor — for embedded escapes in table cells. */
export function deltaAnsi(sign: string): string {
  return sign === "-" ? ANSI.red : ANSI.green;
}

/**
 * Locate every span of plain text that should render green or red.
 * Combines three sources in priority order:
 *   1. Sign-prefixed numbers (highest priority — explicit sign always wins)
 *   2. Numbers/ranges following negative labels  → red
 *   3. Numbers/ranges following positive labels  → green
 *
 * When sources overlap (e.g. "Total Return: -0.86%" — POSITIVE_LABEL
 * captures "-0.86%" green AND SIGNED captures "-0.86%" red), the
 * higher-priority hit wins so the explicit sign always reflects reality.
 */
export interface ColorHit {
  start: number;
  end: number;
  color: string;
}
export function findColorHits(text: string): ColorHit[] {
  const hits: Array<ColorHit & { prio: number }> = [];

  SIGNED_NUMBER_RE.lastIndex = 0;
  for (const m of text.matchAll(SIGNED_NUMBER_RE)) {
    hits.push({
      start: m.index!,
      end: m.index! + m[0].length,
      color: deltaColor(m[0][0]!),
      prio: 0,
    });
  }
  NEGATIVE_LABEL_RE.lastIndex = 0;
  for (const m of text.matchAll(NEGATIVE_LABEL_RE)) {
    const grp = m[1];
    if (!grp) continue;
    const grpStart = m.index! + m[0].lastIndexOf(grp);
    hits.push({ start: grpStart, end: grpStart + grp.length, color: PALETTE.red, prio: 1 });
  }
  POSITIVE_LABEL_RE.lastIndex = 0;
  for (const m of text.matchAll(POSITIVE_LABEL_RE)) {
    const grp = m[1];
    if (!grp) continue;
    const grpStart = m.index! + m[0].lastIndexOf(grp);
    hits.push({ start: grpStart, end: grpStart + grp.length, color: PALETTE.green, prio: 2 });
  }

  // Sort by start asc, prio asc — lower prio wins on ties.
  hits.sort((a, b) => a.start - b.start || a.prio - b.prio);
  // Drop any hit overlapping an earlier (already-emitted) one.
  const out: ColorHit[] = [];
  let lastEnd = 0;
  for (const h of hits) {
    if (h.start >= lastEnd) {
      out.push({ start: h.start, end: h.end, color: h.color });
      lastEnd = h.end;
    }
  }
  return out;
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
