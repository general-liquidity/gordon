/**
 * WorldQuant 101 Formulaic-Alpha — OPERATOR KERNEL
 * (Kakushadze 2016, "101 Formulaic Alphas", arXiv:1601.00991)
 *
 * The deterministic operator vocabulary the 101 alphas are written in,
 * implemented over a `ticker × date` panel. Two operator classes:
 *
 *   - Cross-sectional (per-date, across tickers): rank, scale, sign, log,
 *     abs, power, signedpower. These look ACROSS the universe on a single
 *     date. `indneutralize` is intentionally OUT — it needs a sector/industry
 *     classification (IndClass) Gordon does not carry on this surface.
 *
 *   - Time-series (per-ticker, across dates, window d): ts_lag/delay,
 *     ts_delta/delta, ts_sum, ts_mean, ts_std, ts_min, ts_max, ts_argmin,
 *     ts_argmax, ts_rank, ts_product, ts_corr, ts_cov, decay_linear.
 *
 * Plus an elementwise binary-op helper (add/sub/mul/div) with null
 * propagation, so the alphas in `formulaic-alphas.ts` compose purely from
 * this kernel.
 *
 * NULL DISCIPLINE (Gordon house convention): a panel cell is `number | null`.
 * `null` means "no value here" (insufficient window, missing input, undefined
 * cross-sectional op). Operators NEVER throw on short/missing data and NEVER
 * fabricate a zero — an insufficient window yields `null` at that cell, and
 * nulls propagate through downstream operators.
 *
 * Pure functions, no I/O. Caller supplies the aligned panel.
 */

// ---------------------------------------------------------------------------
// Panel representation
// ---------------------------------------------------------------------------

/**
 * Row-major panel: `values[dateIdx][tickerIdx]`. `dates` is ordered
 * oldest → newest (time-series operators walk the date axis forward).
 * `tickers` is the cross-sectional axis. A cell is `number | null`.
 */
export interface Panel {
  dates: string[];
  tickers: string[];
  values: (number | null)[][];
}

export type Cell = number | null;

/** Build a panel filled with a constant (default null), shaped like `like`. */
export function emptyLike(like: Panel, fill: Cell = null): Panel {
  return {
    dates: like.dates,
    tickers: like.tickers,
    values: like.dates.map(() => like.tickers.map(() => fill)),
  };
}

/** Construct a panel from raw parts with shape validation at the boundary. */
export function makePanel(dates: string[], tickers: string[], values: Cell[][]): Panel {
  if (values.length !== dates.length) {
    throw new Error(`Panel rows (${values.length}) != dates (${dates.length})`);
  }
  for (let r = 0; r < values.length; r++) {
    if (values[r]!.length !== tickers.length) {
      throw new Error(`Panel row ${r} width (${values[r]!.length}) != tickers (${tickers.length})`);
    }
  }
  return { dates, tickers, values };
}

// ---------------------------------------------------------------------------
// Cross-sectional operators (per-date, across tickers)
// ---------------------------------------------------------------------------

/**
 * Cross-sectional percentile rank, per date, across tickers.
 *
 * Convention: rank ∈ [0, 1]. The smallest value maps to 0, the largest to 1,
 * via `rank_i = (#{j : x_j < x_i} ) / (m - 1)` where m is the count of
 * non-null cells on that date. Ties share the count of strictly-smaller
 * elements (so equal values get equal rank). With a single non-null cell the
 * rank is 0.5 (degenerate, no ordering). Null cells stay null.
 *
 *   rank([10, 20, 30]) -> [0, 0.5, 1]
 *   rank([5, 5, 5])    -> [0, 0, 0]  (all tied at strictly-smaller-count 0)
 */
export function rank(p: Panel): Panel {
  const out = emptyLike(p);
  for (let d = 0; d < p.dates.length; d++) {
    const row = p.values[d]!;
    const present: number[] = [];
    for (const v of row) if (v !== null && Number.isFinite(v)) present.push(v);
    const m = present.length;
    for (let t = 0; t < row.length; t++) {
      const v = row[t]!;
      if (v === null || !Number.isFinite(v)) continue;
      if (m === 1) {
        out.values[d]![t] = 0.5;
        continue;
      }
      let smaller = 0;
      for (const u of present) if (u < v) smaller++;
      out.values[d]![t] = parseFloat((smaller / (m - 1)).toFixed(6));
    }
  }
  return out;
}

/**
 * scale(x, a): L1-normalize each date's cross-section so that
 * Σ|x_i| = a (default a = 1). Sign is preserved. If the date's L1 norm is 0
 * (all zero or all null), cells pass through unchanged (zeros stay zero).
 */
export function scale(p: Panel, a = 1): Panel {
  const out = emptyLike(p);
  for (let d = 0; d < p.dates.length; d++) {
    const row = p.values[d]!;
    let l1 = 0;
    for (const v of row) if (v !== null && Number.isFinite(v)) l1 += Math.abs(v);
    for (let t = 0; t < row.length; t++) {
      const v = row[t]!;
      if (v === null || !Number.isFinite(v)) continue;
      out.values[d]![t] = l1 === 0 ? v : parseFloat(((v * a) / l1).toFixed(8));
    }
  }
  return out;
}

// ---- Elementwise unary cross-sectional / pointwise ops ----

function mapCells(p: Panel, fn: (v: number) => number): Panel {
  const out = emptyLike(p);
  for (let d = 0; d < p.values.length; d++) {
    const row = p.values[d]!;
    for (let t = 0; t < row.length; t++) {
      const v = row[t]!;
      if (v === null || !Number.isFinite(v)) continue;
      const r = fn(v);
      out.values[d]![t] = Number.isFinite(r) ? r : null;
    }
  }
  return out;
}

/** sign(x): -1 / 0 / +1. */
export function sign(p: Panel): Panel {
  return mapCells(p, (v) => Math.sign(v));
}

/** log(x): natural log. Non-positive inputs -> null (log undefined). */
export function log(p: Panel): Panel {
  return mapCells(p, (v) => (v > 0 ? Math.log(v) : NaN));
}

/** abs(x). */
export function abs(p: Panel): Panel {
  return mapCells(p, (v) => Math.abs(v));
}

/** power(x, e): x^e. */
export function power(p: Panel, e: number): Panel {
  return mapCells(p, (v) => v ** e);
}

/**
 * signedpower(x, e): sign(x) * |x|^e. The 101-paper's `SignedPower`.
 * Preserves sign while raising the magnitude to e.
 */
export function signedpower(p: Panel, e: number): Panel {
  return mapCells(p, (v) => Math.sign(v) * Math.abs(v) ** e);
}

// ---------------------------------------------------------------------------
// Elementwise binary ops (null-propagating)
// ---------------------------------------------------------------------------

export type BinaryOp = "add" | "sub" | "mul" | "div";

/** Elementwise binary op between two same-shaped panels. Any null -> null. */
export function binary(a: Panel, b: Panel, op: BinaryOp): Panel {
  const out = emptyLike(a);
  for (let d = 0; d < a.values.length; d++) {
    const ra = a.values[d]!;
    const rb = b.values[d]!;
    for (let t = 0; t < ra.length; t++) {
      const x = ra[t]!;
      const y = rb[t]!;
      if (x === null || y === null || !Number.isFinite(x) || !Number.isFinite(y)) continue;
      let r: number;
      switch (op) {
        case "add":
          r = x + y;
          break;
        case "sub":
          r = x - y;
          break;
        case "mul":
          r = x * y;
          break;
        case "div":
          if (y === 0) continue; // div-by-zero -> null
          r = x / y;
          break;
      }
      out.values[d]![t] = Number.isFinite(r) ? r : null;
    }
  }
  return out;
}

export const add = (a: Panel, b: Panel): Panel => binary(a, b, "add");
export const sub = (a: Panel, b: Panel): Panel => binary(a, b, "sub");
export const mul = (a: Panel, b: Panel): Panel => binary(a, b, "mul");
export const div = (a: Panel, b: Panel): Panel => binary(a, b, "div");

/** Add a scalar to every cell. */
export function addScalar(p: Panel, s: number): Panel {
  return mapCells(p, (v) => v + s);
}

/** Multiply every cell by a scalar. */
export function mulScalar(p: Panel, s: number): Panel {
  return mapCells(p, (v) => v * s);
}

/** Negate every cell. */
export function neg(p: Panel): Panel {
  return mapCells(p, (v) => -v);
}

// ---------------------------------------------------------------------------
// Time-series operators (per-ticker, across dates, window d)
// ---------------------------------------------------------------------------

/**
 * Pull the contiguous window of `d` values ending at date index `dEnd` for one
 * ticker. Returns null if the window runs off the start of the panel OR if any
 * cell in the window is null (insufficient/contaminated window -> null result).
 */
function windowOf(p: Panel, dEnd: number, t: number, d: number): number[] | null {
  const start = dEnd - d + 1;
  if (start < 0) return null;
  const w: number[] = [];
  for (let i = start; i <= dEnd; i++) {
    const v = p.values[i]![t]!;
    if (v === null || !Number.isFinite(v)) return null;
    w.push(v);
  }
  return w;
}

/** Generic per-ticker rolling reducer over the trailing window of length d. */
function tsReduce(p: Panel, d: number, reducer: (w: number[]) => number): Panel {
  const out = emptyLike(p);
  for (let t = 0; t < p.tickers.length; t++) {
    for (let dEnd = 0; dEnd < p.dates.length; dEnd++) {
      const w = windowOf(p, dEnd, t, d);
      if (w === null) continue;
      const r = reducer(w);
      out.values[dEnd]![t] = Number.isFinite(r) ? r : null;
    }
  }
  return out;
}

/** delay/ts_lag: value of x, d days ago. */
export function ts_lag(p: Panel, d: number): Panel {
  const out = emptyLike(p);
  for (let t = 0; t < p.tickers.length; t++) {
    for (let dEnd = 0; dEnd < p.dates.length; dEnd++) {
      const src = dEnd - d;
      if (src < 0) continue;
      const v = p.values[src]![t]!;
      if (v === null || !Number.isFinite(v)) continue;
      out.values[dEnd]![t] = v;
    }
  }
  return out;
}
export const delay = ts_lag;

/** ts_delta/delta: x_today - x_{d days ago}. */
export function ts_delta(p: Panel, d: number): Panel {
  return sub(p, ts_lag(p, d));
}
export const delta = ts_delta;

/** ts_sum: rolling sum over the trailing window of d days. */
export function ts_sum(p: Panel, d: number): Panel {
  return tsReduce(p, d, (w) => w.reduce((s, x) => s + x, 0));
}

/** ts_mean: rolling mean. */
export function ts_mean(p: Panel, d: number): Panel {
  return tsReduce(p, d, (w) => w.reduce((s, x) => s + x, 0) / w.length);
}

/** ts_std: rolling sample standard deviation (ddof=1). d<2 -> null. */
export function ts_std(p: Panel, d: number): Panel {
  if (d < 2) return emptyLike(p);
  return tsReduce(p, d, (w) => {
    const mean = w.reduce((s, x) => s + x, 0) / w.length;
    let ss = 0;
    for (const x of w) ss += (x - mean) ** 2;
    return Math.sqrt(ss / (w.length - 1));
  });
}

/** ts_min: rolling min. */
export function ts_min(p: Panel, d: number): Panel {
  return tsReduce(p, d, (w) => Math.min(...w));
}

/** ts_max: rolling max. */
export function ts_max(p: Panel, d: number): Panel {
  return tsReduce(p, d, (w) => Math.max(...w));
}

/**
 * ts_argmin: index (days ago) of the min within the trailing d-day window.
 * 101-paper convention: position counted from the END, so the MOST RECENT day
 * is 0 and the oldest is d-1. Returns the days-ago of the minimum.
 */
export function ts_argmin(p: Panel, d: number): Panel {
  return tsReduce(p, d, (w) => {
    let mi = 0;
    for (let i = 1; i < w.length; i++) if (w[i]! < w[mi]!) mi = i;
    return w.length - 1 - mi; // days-ago from the window end
  });
}

/** ts_argmax: days-ago of the max within the trailing d-day window. */
export function ts_argmax(p: Panel, d: number): Panel {
  return tsReduce(p, d, (w) => {
    let mi = 0;
    for (let i = 1; i < w.length; i++) if (w[i]! > w[mi]!) mi = i;
    return w.length - 1 - mi;
  });
}

/**
 * ts_rank: rolling percentile rank of the CURRENT value within the trailing
 * d-day window, ∈ [0, 1]. Same convention as cross-sectional `rank`:
 * rank = (#{strictly smaller}) / (d - 1). d<2 windows -> 0.5.
 */
export function ts_rank(p: Panel, d: number): Panel {
  return tsReduce(p, d, (w) => {
    const cur = w[w.length - 1]!;
    if (w.length < 2) return 0.5;
    let smaller = 0;
    for (const x of w) if (x < cur) smaller++;
    return parseFloat((smaller / (w.length - 1)).toFixed(6));
  });
}

/** ts_product: rolling product over the trailing d-day window. */
export function ts_product(p: Panel, d: number): Panel {
  return tsReduce(p, d, (w) => w.reduce((s, x) => s * x, 1));
}

/**
 * decay_linear (ts_weighted_mean): linearly-weighted average over the trailing
 * d-day window, with the MOST RECENT day weighted highest. Weights are
 * w_k = (k) / (1+2+...+d) for k = 1..d on oldest..newest, so they sum to 1.
 *
 *   decay_linear over [a, b, c] (d=3): (1a + 2b + 3c) / 6.
 */
export function decay_linear(p: Panel, d: number): Panel {
  const denom = (d * (d + 1)) / 2;
  return tsReduce(p, d, (w) => {
    let acc = 0;
    for (let k = 0; k < w.length; k++) acc += w[k]! * (k + 1);
    return acc / denom;
  });
}

/**
 * ts_corr: rolling Pearson correlation between two aligned panels over the
 * trailing d-day window. d<2 or zero-variance window -> null. Identical
 * series -> 1.
 */
export function ts_corr(a: Panel, b: Panel, d: number): Panel {
  const out = emptyLike(a);
  if (d < 2) return out;
  for (let t = 0; t < a.tickers.length; t++) {
    for (let dEnd = 0; dEnd < a.dates.length; dEnd++) {
      const wa = windowOf(a, dEnd, t, d);
      const wb = windowOf(b, dEnd, t, d);
      if (wa === null || wb === null) continue;
      const r = pearson(wa, wb);
      if (r === null) continue;
      out.values[dEnd]![t] = parseFloat(r.toFixed(6));
    }
  }
  return out;
}

/**
 * ts_cov: rolling sample covariance (ddof=1) between two aligned panels over
 * the trailing d-day window. d<2 -> null.
 */
export function ts_cov(a: Panel, b: Panel, d: number): Panel {
  const out = emptyLike(a);
  if (d < 2) return out;
  for (let t = 0; t < a.tickers.length; t++) {
    for (let dEnd = 0; dEnd < a.dates.length; dEnd++) {
      const wa = windowOf(a, dEnd, t, d);
      const wb = windowOf(b, dEnd, t, d);
      if (wa === null || wb === null) continue;
      const ma = wa.reduce((s, x) => s + x, 0) / wa.length;
      const mb = wb.reduce((s, x) => s + x, 0) / wb.length;
      let cov = 0;
      for (let i = 0; i < wa.length; i++) cov += (wa[i]! - ma) * (wb[i]! - mb);
      out.values[dEnd]![t] = parseFloat((cov / (wa.length - 1)).toFixed(8));
    }
  }
  return out;
}

function pearson(a: number[], b: number[]): number | null {
  const n = a.length;
  if (n < 2) return null;
  const ma = a.reduce((s, x) => s + x, 0) / n;
  const mb = b.reduce((s, x) => s + x, 0) / n;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i]! - ma;
    const db = b[i]! - mb;
    cov += da * db;
    va += da * da;
    vb += db * db;
  }
  if (va === 0 || vb === 0) return null;
  return cov / Math.sqrt(va * vb);
}

// ---------------------------------------------------------------------------
// Convenience: returns panel from a close panel
// ---------------------------------------------------------------------------

/**
 * Daily simple returns: (close_t - close_{t-1}) / close_{t-1}, per ticker.
 * First date per ticker -> null. Used when a caller has close but not a
 * precomputed returns panel.
 */
export function dailyReturns(close: Panel): Panel {
  const lag = ts_lag(close, 1);
  return div(sub(close, lag), lag);
}
