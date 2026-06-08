/**
 * GMMA — Guppy Multiple Moving Average (Daryl Guppy).
 *
 * Two EMA bundles plotted together:
 *   - trader group   {3, 5, 8, 10, 12, 15}  — short-term sentiment
 *   - investor group {30, 35, 40, 45, 50, 60} — long-term conviction
 *
 * The read is the RELATIONSHIP between the bundles, not any single line:
 *   - trader bundle above investor bundle = uptrend (below = downtrend);
 *   - investor-bundle COMPRESSION → EXPANSION = a high-probability breakout /
 *     regime shift (conviction money committing);
 *   - trader bundle stretched far above the investor bundle = blow-off / exhaustion.
 *
 * Distinct from Gordon's individual MAs (SMA/EMA/DEMA/MAMA/KAMA/…) — the value
 * is the grouped-ribbon separation/compression dynamics. Pure; never throws.
 */

const TRADER = [3, 5, 8, 10, 12, 15];
const INVESTOR = [30, 35, 40, 45, 50, 60];
const MAXP = 60;

const round = (x: number, p = 4): number => parseFloat(x.toFixed(p));
const mean = (a: number[]): number => a.reduce((s, x) => s + x, 0) / a.length;

/** EMA series (SMA-seeded at index period-1; null before). */
function emaSeries(values: number[], period: number): (number | null)[] {
  const n = values.length;
  const out: (number | null)[] = new Array(n).fill(null);
  if (n < period) return out;
  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i]!;
  let prev = seed / period;
  out[period - 1] = prev;
  for (let i = period; i < n; i++) {
    prev = values[i]! * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export interface GmmaResult {
  /** Current trader-group EMA values {3,5,8,10,12,15}. */
  trader: number[];
  /** Current investor-group EMA values {30,35,40,45,50,60}. */
  investor: number[];
  traderMean: number;
  investorMean: number;
  /** (traderMean − investorMean)/investorMean × 100 — trend strength / direction. */
  separationPct: number;
  /** Trader-bundle width as % of price (intra-group spread). */
  traderSpreadPct: number;
  /** Investor-bundle width as % of price (compression measure). */
  investorSpreadPct: number;
  trend: "up" | "down" | "neutral";
  compression: "compressed" | "expanding" | "normal";
  signal: "breakout" | "exhaustion" | "trend_up" | "trend_down" | "neutral";
  interpretation: string;
}

export interface GmmaInput {
  closes: number[];
  /** Bars of investor-spread history for compression/exhaustion. Default 20. */
  lookback?: number;
}

export function calculateGMMA(closes: number[], input: { lookback?: number } = {}): GmmaResult {
  const lookback = Math.max(5, Math.floor(input.lookback ?? 20));
  const n = closes.length;
  const empty: GmmaResult = {
    trader: [], investor: [], traderMean: 0, investorMean: 0, separationPct: 0,
    traderSpreadPct: 0, investorSpreadPct: 0, trend: "neutral", compression: "normal",
    signal: "neutral", interpretation: `insufficient data — need ≥ ${MAXP} closes, got ${n}`,
  };
  if (n < MAXP) return empty;

  const traderS = TRADER.map((p) => emaSeries(closes, p));
  const investorS = INVESTOR.map((p) => emaSeries(closes, p));

  // Per-bar group spread% series (from the first bar where the 60-EMA exists).
  const invSpreadSeries: number[] = [];
  const sepSeries: number[] = [];
  for (let i = MAXP - 1; i < n; i++) {
    const tr = traderS.map((s) => s[i]!);
    const inv = investorS.map((s) => s[i]!);
    const px = closes[i]!;
    invSpreadSeries.push(((Math.max(...inv) - Math.min(...inv)) / px) * 100);
    sepSeries.push(((mean(tr) - mean(inv)) / mean(inv)) * 100);
  }

  const trader = traderS.map((s) => round(s[n - 1]!));
  const investor = investorS.map((s) => round(s[n - 1]!));
  const px = closes[n - 1]!;
  const traderMean = mean(trader);
  const investorMean = mean(investor);
  const separationPct = round(((traderMean - investorMean) / investorMean) * 100);
  const traderSpreadPct = round(((Math.max(...trader) - Math.min(...trader)) / px) * 100);
  const investorSpreadPct = round(((Math.max(...investor) - Math.min(...investor)) / px) * 100);

  const trend: GmmaResult["trend"] = separationPct > 0.1 ? "up" : separationPct < -0.1 ? "down" : "neutral";

  // Compression state from the investor-spread history.
  let compression: GmmaResult["compression"] = "normal";
  const cur = invSpreadSeries[invSpreadSeries.length - 1]!;
  if (invSpreadSeries.length >= lookback) {
    const win = invSpreadSeries.slice(-lookback);
    const lo = Math.min(...win);
    const hi = Math.max(...win);
    const band = hi - lo;
    const compressedLevel = lo + 0.25 * band;
    const back = invSpreadSeries[invSpreadSeries.length - 1 - Math.min(5, invSpreadSeries.length - 1)]!;
    if (band > 0 && cur <= compressedLevel) compression = "compressed";
    else if (band > 0 && back <= compressedLevel && cur > back * 1.15) compression = "expanding";
  }

  // Exhaustion: separation near the top of its recent range while trending up.
  let exhausted = false;
  if (sepSeries.length >= lookback && trend === "up") {
    const win = sepSeries.slice(-lookback);
    const hi = Math.max(...win);
    exhausted = hi > 0 && separationPct >= 0.9 * hi && traderSpreadPct > investorSpreadPct;
  }

  const signal: GmmaResult["signal"] =
    compression === "expanding" && trend !== "neutral"
      ? "breakout"
      : exhausted
        ? "exhaustion"
        : trend === "up"
          ? "trend_up"
          : trend === "down"
            ? "trend_down"
            : "neutral";

  const interpretation =
    signal === "breakout"
      ? `investor band expanding off compression with trader bundle ${trend} — high-probability ${trend} breakout`
      : signal === "exhaustion"
        ? `trader bundle stretched ${separationPct}% above investors (near recent extreme) — blow-off / exhaustion risk`
        : signal === "trend_up"
          ? `trader bundle above investors (sep ${separationPct}%) — uptrend${compression === "compressed" ? ", investor band compressed (watch for breakout)" : ""}`
          : signal === "trend_down"
            ? `trader bundle below investors (sep ${separationPct}%) — downtrend`
            : `bundles intertwined (sep ${separationPct}%) — no clear trend${compression === "compressed" ? ", compressed (coiling)" : ""}`;

  return {
    trader, investor, traderMean: round(traderMean), investorMean: round(investorMean),
    separationPct, traderSpreadPct, investorSpreadPct, trend, compression, signal, interpretation,
  };
}
