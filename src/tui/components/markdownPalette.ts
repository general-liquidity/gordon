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
  /** Top-level section emphasis (H1). Bloomberg gold. */
  gold: "#FFD700",
  /** Sub-section emphasis (H2) + table headers. Bloomberg amber. */
  amber: "#FFA500",
  /** Quiet headers (H3), links, fiat tickers (USD/USDT/USDC). */
  platinum: "#E5E4E2",
  /** Ambient ornaments: H4+, borders, blockquote bars, horizontal rules. */
  ash: "#888888",
  /** Positive deltas, PASS, LONG, gains, low risk. Stock-up green. */
  green: "#00C853",
  /** Negative deltas, FAIL, SHORT, losses, drawdowns, high risk. */
  red: "#FF3B30",
  /** Caution / medium risk / timeframes — warm yellow distinct from gold. */
  mustard: "#FFC107",
  /** Function / strategy / parameter IDs (codespan) — warm tan, distinct
   *  from amber so backticked names don't blend with H2 / headers. */
  tan: "#D2B48C",
  /** Crypto tickers (BTC, ETH, SOL...) — emerald, separate from delta green
   *  so symbols read as "asset names" not "positive numbers". */
  emerald: "#50C878",
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
  mustard: ansi24(PALETTE.mustard),
  tan: ansi24(PALETTE.tan),
  emerald: ansi24(PALETTE.emerald),
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

/** Status tokens — green when present, red when absent or failing. */
export const POSITIVE_TOKEN_RE =
  /\b(?:PASS(?:ED)?|OK|APPROVED|ELIGIBLE|HEALTHY|ACTIVE|GREEN|VALID|SUCCESS|WIN|WON|FILLED)\b/g;
export const NEGATIVE_TOKEN_RE =
  /\b(?:FAIL(?:ED)?|FAILURE|WARN(?:ING)?|BLOCKED|REJECTED|DISCARD(?:ED)?|HALTED|STALE|ERROR|ERRORED|RED|INVALID|LOST|MISSED|CANCELED|CANCELLED|TIMEOUT)\b/g;

/** Direction tokens — long/buy = green, short/sell = red. Word-boundary
 *  so "Bollinger" doesn't match "long". Case-sensitive isn't required;
 *  we use case-insensitive but anchor on \b. */
export const LONG_TOKEN_RE = /\b(?:LONG|BUY|BUYS?|BOUGHT|GOING LONG|BULLISH)\b/gi;
export const SHORT_TOKEN_RE = /\b(?:SHORT|SELL|SELLS?|SOLD|GOING SHORT|BEARISH)\b/gi;

/** Up / down arrows immediately followed by an optional number. The
 *  whole match (arrow + number) gets colored together. */
export const UP_ARROW_RE = /(?:↑↑?|↗|🟢)\s*(?:\d[\d,]*(?:\.\d+)?%?)?/g;
export const DOWN_ARROW_RE = /(?:↓↓?|↘|🔴)\s*(?:\d[\d,]*(?:\.\d+)?%?)?/g;

/** Well-known indicator / metric labels that should highlight in amber
 *  when used as a label (followed by colon). Captures only the label
 *  itself so the value stays in default color (or gets covered by the
 *  signed-number / range pass on top). */
export const INDICATOR_LABEL_RE =
  /\b(?:RSI|MACD|EMA|SMA|ATR|ADX|VWAP|MFI|OBV|CMF|Bollinger|Ichimoku|Stochastic|Supertrend|FVG|ICT|SMC|Fibonacci|Sharpe|Sortino|Calmar|Stop[\s\-]?Loss|Take[\s\-]?Profit|Entry|Exit|Target|Risk|Reward|Position|Leverage|Spread|Direction)\s*(?=:)/gi;

/** Risk level tokens. Match only when isolated — preceded by "Risk" or
 *  a table cell separator, otherwise common words like "low volatility"
 *  or "high probability" would over-color. */
const RISK_PRECEDED = "(?<=Risk[\\s:]+|risk[\\s\\-]?level[\\s:]+|│\\s+|│\\s\\s+|^\\s*)";
export const RISK_LOW_RE = new RegExp(`${RISK_PRECEDED}\\bLow\\b`, "gm");
export const RISK_MEDIUM_RE = new RegExp(`${RISK_PRECEDED}\\bMedium\\b`, "gm");
export const RISK_HIGH_RE = new RegExp(`${RISK_PRECEDED}\\bHigh\\b`, "gm");

/** Timeframes: 1m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 12h, 1d, 1D, 1w, 1W.
 *  Lookbehind rejects matches preceded by a digit or '$' so "$630M",
 *  "1.5M", "1.2h" don't get mis-coloured as timeframes. "M" is omitted
 *  as a suffix because it doubles as the magnitude suffix for millions. */
export const TIMEFRAME_RE = /(?<![\d$.])\b\d{1,3}(?:m|h|d|D|w|W)\b/g;

/** Crypto tickers, conservative whitelist. These are the symbols that
 *  reliably appear as standalone tickers in trading discourse. Pair
 *  detection (BTCUSDT etc.) is handled by PAIR_RE separately so we don't
 *  match "BTC" twice when it's part of "BTCUSDT". */
const CRYPTO_LIST = [
  "BTC", "ETH", "SOL", "BNB", "XRP", "DOGE", "TRX", "ADA", "LTC", "ETC",
  "AVAX", "DOT", "ATOM", "LINK", "UNI", "AAVE", "MATIC", "POL", "NEAR",
  "ARB", "OP", "SUI", "APT", "ICP", "FIL", "VET", "ALGO", "HBAR", "INJ",
  "TIA", "SEI", "STRK", "PYTH", "JUP", "WIF", "BONK", "PEPE", "SHIB",
  "FLOKI", "BCH", "BSV", "XLM", "XMR", "DASH", "ZEC", "EOS", "TRX",
  "AXS", "APE", "GALA", "ALICE", "SLP", "RONIN", "SAND", "MANA",
  "HYPER", "ZBT", "API3", "ASTER", "SAHARA", "ENJ", "CHIP", "RNDR",
  "GRT", "FTM", "RUNE", "KAS", "TON", "ORDI", "SATS",
];
const FIAT_LIST = ["USDT", "USDC", "FDUSD", "TUSD", "BUSD", "USD", "EUR", "GBP", "JPY", "DAI"];

/** Common stock tickers — colored same as crypto since they fill the
 *  same role (tradeable asset). Conservative list to keep false positives
 *  low. Add tickers here as users name them. */
const STOCK_LIST = [
  "AAPL", "NVDA", "MSFT", "GOOGL", "GOOG", "AMZN", "META", "TSLA", "NFLX",
  "AMD", "INTC", "IBM", "ORCL", "CSCO", "CRM", "ADBE", "PYPL", "AVGO",
  "QCOM", "TXN", "COIN", "MSTR", "MARA", "RIOT", "HOOD", "PLTR",
  "JPM", "BAC", "GS", "MS", "WFC", "C", "BLK", "BX",
  "SPY", "QQQ", "IWM", "DIA", "VOO", "VTI", "ARKK", "GLD", "SLV", "TLT",
];

export const STOCK_RE = new RegExp(`\\b(${STOCK_LIST.join("|")})\\b`, "g");

/** Pair like BTCUSDT — split into crypto + fiat halves so each half
 *  colors in its own bucket. Captures: 1=crypto, 2=fiat. */
export const PAIR_RE = new RegExp(
  `\\b(${CRYPTO_LIST.join("|")})(${FIAT_LIST.join("|")})\\b`,
  "g",
);
/** Standalone crypto ticker not followed by a fiat suffix. */
export const CRYPTO_RE = new RegExp(
  `\\b(${CRYPTO_LIST.join("|")})\\b(?!(?:${FIAT_LIST.join("|")})\\b)`,
  "g",
);
/** Standalone fiat ticker not preceded by a crypto prefix. */
export const FIAT_RE = new RegExp(
  `(?<!\\b(?:${CRYPTO_LIST.join("|")}))\\b(${FIAT_LIST.join("|")})\\b`,
  "g",
);

/**
 * Locate every span of plain text that should render in a non-default
 * color. Sources combined in priority order:
 *
 *   prio 0 — Sign-prefixed numbers           → green / red (explicit)
 *   prio 1 — Numbers after negative labels   → red
 *   prio 2 — Numbers after positive labels   → green
 *   prio 3 — PASS / WARN / FAIL tokens       → green / red
 *   prio 3 — LONG / SHORT direction tokens   → green / red
 *   prio 3 — Up / down arrows (+ number)     → green / red
 *   prio 4 — Known indicator labels          → amber
 *
 * Lower prio wins on overlap. The explicit sign always reflects reality,
 * even when surrounded by an optimistic positive label.
 */
export interface ColorHit {
  start: number;
  end: number;
  color: string;
}
function pushAll(
  re: RegExp,
  text: string,
  color: string,
  prio: number,
  hits: Array<ColorHit & { prio: number }>,
  groupIdx = 0,
): void {
  re.lastIndex = 0;
  for (const m of text.matchAll(re)) {
    const grp = groupIdx === 0 ? m[0] : m[groupIdx];
    if (!grp) continue;
    const grpStart =
      groupIdx === 0 ? m.index! : m.index! + m[0].lastIndexOf(grp);
    hits.push({ start: grpStart, end: grpStart + grp.length, color, prio });
  }
}

export function findColorHits(text: string): ColorHit[] {
  const hits: Array<ColorHit & { prio: number }> = [];

  // prio 0 — explicit sign always wins
  SIGNED_NUMBER_RE.lastIndex = 0;
  for (const m of text.matchAll(SIGNED_NUMBER_RE)) {
    hits.push({
      start: m.index!,
      end: m.index! + m[0].length,
      color: deltaColor(m[0][0]!),
      prio: 0,
    });
  }

  // prio 1/2 — labeled metrics (numbers after win-rate / drawdown / etc.)
  pushAll(NEGATIVE_LABEL_RE, text, PALETTE.red, 1, hits, 1);
  pushAll(POSITIVE_LABEL_RE, text, PALETTE.green, 2, hits, 1);

  // prio 3 — PASS/WARN, LONG/SHORT, ↑/↓ arrows, risk levels
  pushAll(POSITIVE_TOKEN_RE, text, PALETTE.green, 3, hits);
  pushAll(NEGATIVE_TOKEN_RE, text, PALETTE.red, 3, hits);
  pushAll(LONG_TOKEN_RE, text, PALETTE.green, 3, hits);
  pushAll(SHORT_TOKEN_RE, text, PALETTE.red, 3, hits);
  pushAll(UP_ARROW_RE, text, PALETTE.green, 3, hits);
  pushAll(DOWN_ARROW_RE, text, PALETTE.red, 3, hits);
  pushAll(RISK_LOW_RE, text, PALETTE.green, 3, hits);
  pushAll(RISK_MEDIUM_RE, text, PALETTE.mustard, 3, hits);
  pushAll(RISK_HIGH_RE, text, PALETTE.red, 3, hits);

  // prio 4 — known indicator labels (RSI:, MACD:, etc.) in amber
  pushAll(INDICATOR_LABEL_RE, text, PALETTE.amber, 4, hits);

  // prio 5 — symbols and timeframes. Pair detection runs first so its
  // halves take precedence over standalone CRYPTO_RE/FIAT_RE for pairs
  // like BTCUSDT.
  PAIR_RE.lastIndex = 0;
  for (const m of text.matchAll(PAIR_RE)) {
    const crypto = m[1];
    const fiat = m[2];
    if (!crypto || !fiat) continue;
    const cryptoStart = m.index!;
    hits.push({ start: cryptoStart, end: cryptoStart + crypto.length, color: PALETTE.emerald, prio: 5 });
    const fiatStart = cryptoStart + crypto.length;
    hits.push({ start: fiatStart, end: fiatStart + fiat.length, color: PALETTE.platinum, prio: 5 });
  }
  pushAll(CRYPTO_RE, text, PALETTE.emerald, 5, hits);
  pushAll(STOCK_RE, text, PALETTE.emerald, 5, hits);
  pushAll(FIAT_RE, text, PALETTE.platinum, 5, hits);
  pushAll(TIMEFRAME_RE, text, PALETTE.mustard, 5, hits);

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
