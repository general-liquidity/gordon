/**
 * Alternative-Data Adapters (hashrate, Google Trends)
 *
 * Concept: Liu & Zohren, "Machine Learning for Quantitative Finance"
 * (MFIN, arXiv:2307.13832) — alt-data features (network hashrate, search
 * interest, social) augment limited crypto price history for factor models.
 * These adapters fetch + NORMALIZE such signals into a factor-ready series to
 * feed the existing crypto-factor-model.
 *
 * SCOPE: these are READ-ONLY data capabilities to VALIDATE via the harness,
 * NOT edge claims. The network fetchers are NOT live-tested — the live Google
 * Trends endpoint in particular needs the operator's own source/key. The
 * VALUE + the test coverage live in the pure `normalizeAltSeries` /
 * `alignToReturns` core and the fixture-driven parsers.
 */

import { createModuleLogger } from "../../../logger/index.ts";

const logger = createModuleLogger("altdata");

// ============================================================================
// Types
// ============================================================================

export interface AltDataPoint {
  /** Unix epoch (seconds or ms — caller's convention; only ordering matters). */
  time: number;
  value: number;
}

export interface AltDataSeries {
  source: string;
  symbol?: string;
  points: AltDataPoint[];
}

export interface NormalizeOpts {
  /** Apply a (rolling, if `lookback` set) z-score transform. */
  zscore?: boolean;
  /** Rolling window for the z-score; omitted/<=0 ⇒ expanding (full-history). */
  lookback?: number;
  /** Clamp each value to ±N standard deviations before z-scoring. */
  winsorize?: number;
}

// ============================================================================
// Pure normalization core (fully tested)
// ============================================================================

const isFinitePoint = (p: AltDataPoint): boolean =>
  Number.isFinite(p.time) && Number.isFinite(p.value);

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stdev(xs: number[], mu: number): number {
  if (xs.length < 2) return 0;
  const variance = xs.reduce((a, b) => a + (b - mu) * (b - mu), 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

/**
 * Sort by time, drop non-finite points, then optionally winsorize and
 * z-score (rolling if `lookback` given, else expanding) into a factor-ready
 * series. Pure — no I/O, no mutation of the input array.
 */
export function normalizeAltSeries(
  points: AltDataPoint[],
  opts: NormalizeOpts = {},
): AltDataPoint[] {
  const clean = points
    .filter(isFinitePoint)
    .slice()
    .sort((a, b) => a.time - b.time);

  if (clean.length === 0) return [];

  let values = clean.map((p) => p.value);

  // Winsorize to ±N stdev around the (full-history) mean.
  if (opts.winsorize != null && opts.winsorize > 0) {
    const mu = mean(values);
    const sd = stdev(values, mu);
    if (sd > 0) {
      const lo = mu - opts.winsorize * sd;
      const hi = mu + opts.winsorize * sd;
      values = values.map((v) => Math.min(hi, Math.max(lo, v)));
    }
  }

  if (!opts.zscore) {
    return clean.map((p, i) => ({ time: p.time, value: values[i]! }));
  }

  const lookback = opts.lookback && opts.lookback > 0 ? opts.lookback : undefined;
  const out: AltDataPoint[] = [];

  for (let i = 0; i < values.length; i++) {
    const start = lookback ? Math.max(0, i - lookback + 1) : 0;
    const window = values.slice(start, i + 1);
    const mu = mean(window);
    const sd = stdev(window, mu);
    const z = sd > 0 ? (values[i]! - mu) / sd : 0;
    out.push({ time: clean[i]!.time, value: z });
  }

  return out;
}

/**
 * Align an alt-data series onto a returns timeline: for each returns
 * timestamp, forward-fill the last known alt value at or before that time.
 * Before the first alt observation, emit 0. Returns one number per returns
 * point, in the returns array's order. Pure.
 */
export function alignToReturns(series: AltDataSeries, returns: { time: number }[]): number[] {
  const sorted = series.points
    .filter(isFinitePoint)
    .slice()
    .sort((a, b) => a.time - b.time);

  const out: number[] = [];
  let idx = 0;
  let last = Number.NaN;

  // Returns may be unsorted; resolve each independently against the sorted
  // alt series via a monotonic cursor only when returns are ascending, else
  // fall back to a per-point scan. Keep it simple + correct: per-point scan.
  for (const r of returns) {
    // Advance `last` to the newest alt point with time <= r.time.
    // Reset the cursor if this return precedes the cursor (unsorted input).
    const prev = sorted[idx - 1];
    if (idx > 0 && prev && prev.time > r.time) {
      idx = 0;
      last = Number.NaN;
    }
    let cur = sorted[idx];
    while (idx < sorted.length && cur && cur.time <= r.time) {
      last = cur.value;
      idx++;
      cur = sorted[idx];
    }
    out.push(Number.isNaN(last) ? 0 : last);
  }

  return out;
}

// ============================================================================
// Parsers (fixture-tested)
// ============================================================================

/**
 * blockchain.info/charts-style payload:
 *   { "values": [ { "x": <unixSeconds>, "y": <hashrate> }, ... ] }
 * Tolerates missing/garbage entries by dropping non-finite pairs.
 */
export function parseHashrateChart(json: unknown): AltDataPoint[] {
  const values = (json as { values?: unknown })?.values;
  if (!Array.isArray(values)) return [];
  const out: AltDataPoint[] = [];
  for (const v of values) {
    const x = (v as { x?: unknown })?.x;
    const y = (v as { y?: unknown })?.y;
    const time = Number(x);
    const value = Number(y);
    if (Number.isFinite(time) && Number.isFinite(value)) {
      out.push({ time, value });
    }
  }
  return out;
}

/**
 * Google-Trends-over-time shape (as exposed by common scraper/proxy JSON):
 *   { "default": { "timelineData": [
 *       { "time": "<unixSeconds-as-string>", "value": [<n>] }, ... ] } }
 * Live Google Trends has no simple public JSON — the operator must supply a
 * source/proxy; this parser only fixes the expected shape.
 */
export function parseTrendsTimeline(json: unknown): AltDataPoint[] {
  const timeline = (json as { default?: { timelineData?: unknown } })?.default?.timelineData;
  if (!Array.isArray(timeline)) return [];
  const out: AltDataPoint[] = [];
  for (const t of timeline) {
    const time = Number((t as { time?: unknown })?.time);
    const raw = (t as { value?: unknown })?.value;
    const value = Array.isArray(raw) ? Number(raw[0]) : Number(raw);
    if (Number.isFinite(time) && Number.isFinite(value)) {
      out.push({ time, value });
    }
  }
  return out;
}

// ============================================================================
// Network adapters (guarded; NOT live-tested)
// ============================================================================

/** Injectable for tests; defaults to the global fetch. */
type FetchImpl = (url: string) => Promise<{ json: () => Promise<unknown> }>;

const defaultFetch: FetchImpl = (url) => fetch(url);

export interface HashrateOpts {
  /** Override the chart endpoint. Default: blockchain.info hash-rate chart. */
  url?: string;
  fetchImpl?: FetchImpl;
}

const DEFAULT_HASHRATE_URL =
  "https://api.blockchain.info/charts/hash-rate?timespan=1year&format=json&sampled=true";

/**
 * Fetch the Bitcoin network hash-rate series. Network-guarded: any failure
 * (transport, non-JSON, parse) returns an empty series — never throws.
 * NOT live-tested.
 */
export async function fetchHashrate(opts: HashrateOpts = {}): Promise<AltDataSeries> {
  const url = opts.url ?? DEFAULT_HASHRATE_URL;
  const doFetch = opts.fetchImpl ?? defaultFetch;
  try {
    const res = await doFetch(url);
    const json = await res.json();
    return { source: "blockchain.info/hash-rate", symbol: "BTC", points: parseHashrateChart(json) };
  } catch (err) {
    logger.warn("fetchHashrate failed; returning empty series", { url, err: String(err) });
    return { source: "blockchain.info/hash-rate", symbol: "BTC", points: [] };
  }
}

export interface GoogleTrendsOpts {
  /**
   * Trends endpoint for the keyword. Live Google Trends needs the operator's
   * own source/proxy/key — there is no simple public JSON endpoint, so this
   * must be supplied for a real fetch. Without it, an empty series is returned.
   */
  url?: string;
  fetchImpl?: FetchImpl;
}

/**
 * Fetch a Google Trends interest-over-time series for `keyword`. Interface +
 * parsing shape only: callers MUST inject a `url` (and may inject `fetchImpl`)
 * pointing at their own Trends source. Network-guarded: any failure returns an
 * empty series — never throws. NOT live-tested.
 */
export async function fetchGoogleTrends(
  keyword: string,
  opts: GoogleTrendsOpts = {},
): Promise<AltDataSeries> {
  const base: AltDataSeries = { source: "google-trends", symbol: keyword, points: [] };
  if (!opts.url) {
    logger.warn("fetchGoogleTrends: no url supplied (operator must provide a Trends source)", {
      keyword,
    });
    return base;
  }
  const doFetch = opts.fetchImpl ?? defaultFetch;
  try {
    const res = await doFetch(opts.url);
    const json = await res.json();
    return { ...base, points: parseTrendsTimeline(json) };
  } catch (err) {
    logger.warn("fetchGoogleTrends failed; returning empty series", {
      keyword,
      err: String(err),
    });
    return base;
  }
}
