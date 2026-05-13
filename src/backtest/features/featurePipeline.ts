/**
 * FeaturePipeline — leakage-proof feature builder.
 *
 * Port of the FeaturePipeline pattern from the AI-Quant article. Solves
 * the #1 LLM-generated-strategy failure mode: look-ahead bias from
 * features that accidentally peek at future data.
 *
 * The fix is structural rather than after-the-fact testing: each feature
 * function only receives a window of strictly past bars. Forgetting
 * `shift(1)`, using `center=True` on a moving average, or normalizing
 * over the full dataset are all mechanically impossible because the
 * pipeline never hands the function anything except past data.
 *
 * Each transform declares its lookback. At bar index t the function
 * receives `data.slice(t - lookback, t)` — strictly the past, never
 * including t itself. Output at indices < lookback is `null`.
 *
 * The pipeline is generic over the row type so it works for OHLCV bars,
 * order-book snapshots, fundamental data, or any time-series. The only
 * requirement is that input rows are sorted ascending by time.
 *
 * Pair with `src/infra/trading/ops/backtestCredibility.ts` (PSR/DSR/CPCV)
 * for the full credibility stack: leakage-proof features in, statistically
 * deflated Sharpe out.
 */

export type FeatureFn<TRow> = (window: TRow[]) => number | null;

export interface FeatureTransform<TRow> {
  /** Unique feature name; becomes the output column key. */
  name: string;
  /** Window length (in rows) the function will receive. */
  lookback: number;
  /** Pure function: window → scalar (or null if undefined). */
  fn: FeatureFn<TRow>;
}

export interface FeatureMatrix {
  /** Feature column names, in declared order. */
  columns: string[];
  /**
   * Row-major matrix. `rows[i][j]` is the value of feature
   * `columns[j]` at input row `i`. `null` = undefined (typically because
   * `i < lookback` for that feature, or the function returned null).
   */
  rows: (number | null)[][];
}

export class FeaturePipeline<TRow> {
  private readonly transforms: FeatureTransform<TRow>[] = [];

  /**
   * Register a feature. Returns `this` for chaining.
   *
   * The fn receives an array of strictly past rows — the row at the
   * current index is NOT included. This is the structural guarantee
   * that prevents look-ahead.
   */
  add(name: string, lookback: number, fn: FeatureFn<TRow>): this {
    if (lookback < 1) {
      throw new Error(`Feature "${name}" lookback must be >= 1, got ${lookback}`);
    }
    if (!Number.isFinite(lookback) || !Number.isInteger(lookback)) {
      throw new Error(`Feature "${name}" lookback must be a positive integer`);
    }
    if (this.transforms.some((t) => t.name === name)) {
      throw new Error(`Feature "${name}" already registered`);
    }
    this.transforms.push({ name, lookback, fn });
    return this;
  }

  /** Inspect registered transforms (for diagnostics / serialization). */
  list(): readonly FeatureTransform<TRow>[] {
    return this.transforms;
  }

  /**
   * Compute the feature matrix for `data`. Rows must be sorted ascending
   * by time; the pipeline does not re-sort.
   *
   * For row index `i` and feature with `lookback = L`:
   *   - If `i < L`, the cell is `null` (insufficient history).
   *   - Otherwise the function receives `data.slice(i - L, i)` (length L,
   *     ending one bar BEFORE i — strictly past).
   *
   * If a function throws, the cell is `null` and the error is silently
   * swallowed (matches the article's pattern). Use `transformStrict` if
   * you want errors propagated.
   */
  transform(data: readonly TRow[]): FeatureMatrix {
    const n = data.length;
    const columns = this.transforms.map((t) => t.name);
    const rows: (number | null)[][] = Array.from({ length: n }, () =>
      Array.from({ length: this.transforms.length }, () => null),
    );

    for (let j = 0; j < this.transforms.length; j++) {
      const t = this.transforms[j]!;
      for (let i = t.lookback; i < n; i++) {
        const window = data.slice(i - t.lookback, i);
        try {
          const v = t.fn(window);
          rows[i]![j] = Number.isFinite(v as number) ? (v as number) : null;
        } catch {
          rows[i]![j] = null;
        }
      }
    }

    return { columns, rows };
  }

  /**
   * Same as `transform` but propagates exceptions thrown by feature
   * functions instead of swallowing them. Use during development to
   * surface bugs; use `transform` in production loops where one
   * bad row should not abort the entire backtest.
   */
  transformStrict(data: readonly TRow[]): FeatureMatrix {
    const n = data.length;
    const columns = this.transforms.map((t) => t.name);
    const rows: (number | null)[][] = Array.from({ length: n }, () =>
      Array.from({ length: this.transforms.length }, () => null),
    );

    for (let j = 0; j < this.transforms.length; j++) {
      const t = this.transforms[j]!;
      for (let i = t.lookback; i < n; i++) {
        const window = data.slice(i - t.lookback, i);
        const v = t.fn(window);
        rows[i]![j] = Number.isFinite(v as number) ? (v as number) : null;
      }
    }

    return { columns, rows };
  }
}

// ============================================================================
// Common feature builders (OHLCV)
// ============================================================================

export interface OhlcvBar {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Simple momentum: close / first-close - 1 over the lookback window. */
export const momentum = (lookback: number): FeatureTransform<OhlcvBar> => ({
  name: `mom_${lookback}`,
  lookback,
  fn: (w) => {
    const first = w[0]?.close;
    const last = w[w.length - 1]?.close;
    if (first === undefined || last === undefined || first === 0) return null;
    return last / first - 1;
  },
});

/** Realized volatility of log returns. */
export const realizedVol = (lookback: number, annualization = 252): FeatureTransform<OhlcvBar> => ({
  name: `vol_${lookback}`,
  lookback,
  fn: (w) => {
    if (w.length < 2) return null;
    const rets: number[] = [];
    for (let k = 1; k < w.length; k++) {
      const prev = w[k - 1]!.close;
      const curr = w[k]!.close;
      if (prev <= 0 || curr <= 0) return null;
      rets.push(Math.log(curr / prev));
    }
    if (rets.length < 2) return null;
    const mean = rets.reduce((s, x) => s + x, 0) / rets.length;
    const variance = rets.reduce((s, x) => s + (x - mean) ** 2, 0) / (rets.length - 1);
    return Math.sqrt(variance) * Math.sqrt(annualization);
  },
});

/** Z-score of last close against the lookback window's mean and std. */
export const zscore = (lookback: number): FeatureTransform<OhlcvBar> => ({
  name: `zscore_${lookback}`,
  lookback,
  fn: (w) => {
    if (w.length < 2) return null;
    const closes = w.map((b) => b.close);
    const mean = closes.reduce((s, x) => s + x, 0) / closes.length;
    const variance = closes.reduce((s, x) => s + (x - mean) ** 2, 0) / (closes.length - 1);
    const std = Math.sqrt(variance);
    if (std === 0) return null;
    return (closes[closes.length - 1]! - mean) / std;
  },
});

/** High-low range as fraction of close. */
export const range = (lookback: number): FeatureTransform<OhlcvBar> => ({
  name: `range_${lookback}`,
  lookback,
  fn: (w) => {
    if (w.length === 0) return null;
    let hi = -Infinity;
    let lo = Infinity;
    for (const b of w) {
      if (b.high > hi) hi = b.high;
      if (b.low < lo) lo = b.low;
    }
    const last = w[w.length - 1]!.close;
    if (last === 0) return null;
    return (hi - lo) / last;
  },
});
