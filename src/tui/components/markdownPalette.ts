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
  /** Tradeable assets — crypto + stock tickers. Pale ice so the asset
   *  name reads as "instrument" rather than "positive number" — green
   *  and red stay reserved for direction and outcome. */
  ice: "#CBF3F0",
  /** Standard prices and $-prefixed amounts that aren't deltas. Calm
   *  cream so a wall of dollar amounts doesn't compete with green/red. */
  cream: "#F5DEB3",
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
  ice: ansi24(PALETTE.ice),
  cream: ansi24(PALETTE.cream),
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
/** Sideways arrows — stable / continuation / no-change. Platinum so they
 *  read as neutral, distinct from the green/red of vertical arrows. */
export const SIDE_ARROW_RE = /[→←↔➜]/g;

/** Well-known indicator / metric labels that should highlight in amber
 *  when used as a label (followed by colon). Captures only the label
 *  itself so the value stays in default color (or gets covered by the
 *  signed-number / range pass on top). */
export const INDICATOR_LABEL_RE =
  /\b(?:RSI|MACD|EMA|SMA|ATR|ADX|VWAP|MFI|OBV|CMF|Bollinger|Ichimoku|Stochastic|Supertrend|FVG|ICT|SMC|Fibonacci|Sharpe|Sortino|Calmar|Stop[\s\-]?Loss|Take[\s\-]?Profit|Entry|Exit|Target|Risk|Reward|Position|Leverage|Spread|Direction)\s*(?=:)/gi;

/** snake_case identifiers — function / strategy / parameter names. The
 *  LLM frequently emits these without backticks (volume_surge,
 *  bollinger_bounce, run_backtest), and we want them to read as
 *  invokable handles. Requires at least one underscore so plain words
 *  don't match. Lowercase-only so SCREAMING_CASE constants stay neutral. */
export const SNAKE_CASE_RE = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g;

/** Slash commands — /scan, /dd, /tutorial, /research start. Matched only
 *  when '/' is preceded by whitespace or start-of-line, so URL paths
 *  ("https://x.com/path") and option flags inside command lines don't
 *  get hijacked. */
export const SLASH_COMMAND_RE = /(?<=^|\s)\/[a-z][a-z0-9_-]*/gm;

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

/**
 * Fiat / stablecoin suffixes used by exchange pair conventions
 * (BTCUSDT, ETHEUR, SOLDAI, ...). Small, stable, market-wide list —
 * unlike the crypto / stock universe these don't change weekly.
 *
 * Order matters for the regex engine's alternation backtracking — list
 * longer fiats first so e.g. USDT wins over USD when scanning BTCUSDT.
 */
const FIAT_LIST = ["USDT", "USDC", "FDUSD", "TUSD", "BUSD", "USD", "EUR", "GBP", "JPY", "TRY", "INR", "KRW", "DAI"];

/** Pair like BTCUSDT — generic prefix `[A-Z]{2,10}` + known fiat suffix.
 *  No hardcoded crypto list, so any new asset the API surfaces colors
 *  correctly without a code change. Captures: 1=asset, 2=fiat. */
export const PAIR_RE = new RegExp(
  `\\b([A-Z]{2,10}?)(${FIAT_LIST.join("|")})\\b`,
  "g",
);

/** Standalone fiat tokens (USD, USDT, ...) not part of a pair suffix. */
export const FIAT_RE = new RegExp(
  `(?<![A-Z])\\b(${FIAT_LIST.join("|")})\\b`,
  "g",
);

/** Cash-tag tickers — `$BTC`, `$AAPL`, etc. Catches whatever the user
 *  or LLM types regardless of the registry. Captures group 1 = ticker. */
export const DOLLAR_TICKER_RE = /\$([A-Z]{1,10})\b/g;

/** Plain prices: `$77,820`, `$1.5M`, `$2,313` — any unsigned `$amount`.
 *  Sign-prefixed amounts are caught by SIGNED_NUMBER_RE earlier in the
 *  pipeline and stay green/red. */
export const PRICE_RE = /(?<![\w])\$\d[\d,]*(?:\.\d+)?[KMB]?\b/g;

/** Plain percentages: `39%`, `58%`, `1.2%` — any unsigned percent.
 *  Sign-prefixed deltas (+39%, -1.2%) are caught earlier and stay
 *  green/red; labeled values (Win Rate: 60%) are caught by the label
 *  pass and win on overlap. This catches the leftover plain values like
 *  "ASTER 39%" or "0.62%" inside a sentence. */
export const PERCENT_RE = /(?<![\w\-+.])\d+(?:\.\d+)?%/g;

// ============================================================================
// Runtime symbol registry
// ============================================================================

/**
 * Tickers registered at runtime by API consumers (Binance market list,
 * Finnhub symbol search, etc). Lets us color any ticker the platform
 * actually surfaces without maintaining a hardcoded universe.
 *
 * Modules that fetch symbol catalogs should call `registerSymbols(...)`
 * during startup or after each API response. The set is mutated in
 * place — no event subscription needed.
 *
 * The seed below is intentionally tiny — just the few names that show
 * up in cold-start onboarding before any API call has populated the
 * registry. Production usage should backfill the registry from the
 * actual exchange / broker.
 */
const SYMBOL_REGISTRY = new Set<string>([
  "BTC", "ETH", "SOL", "BNB", "XRP", "USD", "AAPL", "NVDA", "SPY",
]);

/** Add tickers to the runtime registry. Idempotent, case-normalized. */
export function registerSymbols(symbols: Iterable<string>): void {
  for (const s of symbols) {
    if (typeof s !== "string") continue;
    const norm = s.trim().toUpperCase();
    if (/^[A-Z]{1,10}$/.test(norm)) SYMBOL_REGISTRY.add(norm);
  }
}

/** Read the current registry — for tests / debugging only. Mutating
 *  this set directly is unsupported; use registerSymbols. */
export function listRegisteredSymbols(): string[] {
  return [...SYMBOL_REGISTRY].sort();
}

/** Match standalone registered tickers in text. We rebuild the regex
 *  on each call so registry additions take effect immediately — the
 *  registry is small and findColorHits already does linear-ish work, so
 *  the rebuild cost is negligible. */
function findRegisteredTickers(text: string): Array<{ start: number; end: number }> {
  if (SYMBOL_REGISTRY.size === 0) return [];
  // Stable-sort by length desc so longer registered tickers (e.g. ETHF)
  // win over shorter prefixes (ETH).
  const sorted = [...SYMBOL_REGISTRY].sort((a, b) => b.length - a.length);
  const re = new RegExp(
    // Negative lookahead for fiat suffix so PAIR_RE owns `BTCUSDT` and
    // we don't double-color the asset half.
    `(?<![A-Z])\\b(${sorted.join("|")})\\b(?!(?:${FIAT_LIST.join("|")})\\b)`,
    "g",
  );
  const out: Array<{ start: number; end: number }> = [];
  for (const m of text.matchAll(re)) {
    out.push({ start: m.index!, end: m.index! + m[0].length });
  }
  return out;
}

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
  pushAll(SIDE_ARROW_RE, text, PALETTE.platinum, 3, hits);
  pushAll(RISK_LOW_RE, text, PALETTE.green, 3, hits);
  pushAll(RISK_MEDIUM_RE, text, PALETTE.mustard, 3, hits);
  pushAll(RISK_HIGH_RE, text, PALETTE.red, 3, hits);

  // prio 4 — known indicator labels (RSI:, MACD:, etc.) in amber
  pushAll(INDICATOR_LABEL_RE, text, PALETTE.amber, 4, hits);
  // prio 4 — snake_case identifiers and slash commands in tan (same
  // family as backticked codespans). Catches volume_surge, /tutorial,
  // and similar when the LLM omits backticks.
  pushAll(SNAKE_CASE_RE, text, PALETTE.tan, 4, hits);
  pushAll(SLASH_COMMAND_RE, text, PALETTE.tan, 4, hits);

  // prio 5 — symbols, timeframes, prices. Pair detection runs first so
  // its halves take precedence over standalone registered tickers /
  // FIAT_RE for compounds like BTCUSDT.
  PAIR_RE.lastIndex = 0;
  for (const m of text.matchAll(PAIR_RE)) {
    const asset = m[1];
    const fiat = m[2];
    if (!asset || !fiat) continue;
    const assetStart = m.index!;
    hits.push({ start: assetStart, end: assetStart + asset.length, color: PALETTE.ice, prio: 5 });
    const fiatStart = assetStart + asset.length;
    hits.push({ start: fiatStart, end: fiatStart + fiat.length, color: PALETTE.platinum, prio: 5 });
  }
  // $-prefixed ticker like $BTC, $AAPL — works regardless of registry.
  DOLLAR_TICKER_RE.lastIndex = 0;
  for (const m of text.matchAll(DOLLAR_TICKER_RE)) {
    const ticker = m[1];
    if (!ticker) continue;
    const tickerStart = m.index! + 1; // skip the '$'
    hits.push({ start: tickerStart, end: tickerStart + ticker.length, color: PALETTE.ice, prio: 5 });
  }
  // Standalone tickers from the runtime registry (BTC, ETH, AAPL, ...
  // populated from API responses).
  for (const r of findRegisteredTickers(text)) {
    hits.push({ start: r.start, end: r.end, color: PALETTE.ice, prio: 5 });
  }
  pushAll(FIAT_RE, text, PALETTE.platinum, 5, hits);
  pushAll(TIMEFRAME_RE, text, PALETTE.mustard, 5, hits);
  pushAll(PRICE_RE, text, PALETTE.cream, 5, hits);
  pushAll(PERCENT_RE, text, PALETTE.cream, 5, hits);

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
