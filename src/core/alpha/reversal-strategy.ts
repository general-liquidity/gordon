/**
 * Short-Term Reversal Strategy primitive.
 *
 * Across this session's cost-honest validations, short-term reversal was the
 * ONLY consistently-positive cross-sectional signal out-of-sample (crypto IC
 * ~+0.16), matching the QuantNest-7 finding (reversal t=6.19, "past losers
 * outperform", strongest near a ~7-day lookback) and the choppy, mean-reverting
 * regime in the Model to Market data. This consolidates that result into a real,
 * tunable, pure primitive.
 *
 * The thesis is contrarian over a SHORT horizon: when price has just fallen well
 * below its recent mean (oversold) it tends to bounce; when it has run well above
 * (overbought) it tends to fade. The score is the NEGATED z-score of the latest
 * close vs a short rolling mean, so oversold → positive (buy the dip), overbought
 * → negative (fade the rip). Stops/targets scale with recent realized volatility.
 *
 * Pure: no I/O, no venue, no LLM. Defensive on short input (returns 0 / null).
 *
 * Distinct from:
 *   - `cross-sectional-contrarian.ts`  (cross-sectional demeaning across N assets;
 *                                       this is a single-instrument time-series score)
 *   - `mean-reversion` in the dry-run validator (raw z-band; this normalizes the
 *                                       score and derives vol-scaled stop/target)
 */

/** Arithmetic mean of a finite series. Empty → 0. */
function mean(xs: ReadonlyArray<number>): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const v of xs) s += v;
  return s / xs.length;
}

/** Population standard deviation. Fewer than 2 points → 0. */
function std(xs: ReadonlyArray<number>): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let acc = 0;
  for (const v of xs) acc += (v - m) ** 2;
  return Math.sqrt(acc / xs.length);
}

/** Simple consecutive-close returns of the last `n+1` closes → `n` returns. */
function recentReturns(closes: ReadonlyArray<number>, n: number): number[] {
  const out: number[] = [];
  const start = Math.max(1, closes.length - n);
  for (let i = start; i < closes.length; i++) {
    const prev = closes[i - 1]!;
    if (prev > 0) out.push(closes[i]! / prev - 1);
  }
  return out;
}

/**
 * Normalized short-term reversal score for the latest close.
 *
 * Computes the z-score of the latest close against the mean/stdev of the last
 * `lookback` closes, then NEGATES it: price far below its recent mean (oversold)
 * → large POSITIVE score (expect a bounce); price far above (overbought) → large
 * NEGATIVE score (expect a fade). The magnitude is in standard-deviation units.
 *
 * Defensive: needs at least `lookback` closes and non-zero dispersion, else 0.
 */
export function reversalScore(closes: ReadonlyArray<number>, lookback: number): number {
  const lb = Math.max(2, Math.floor(lookback));
  if (closes.length < lb) return 0;
  const window = closes.slice(-lb);
  const last = window[window.length - 1]!;
  const m = mean(window);
  const sd = std(window);
  if (sd === 0 || !Number.isFinite(sd)) return 0;
  // z = (last - mean)/sd ; reversal score negates it (oversold → positive).
  return -(last - m) / sd;
}

export interface ReversalSignalOptions {
  /** Rolling window for the mean/z-score and the vol estimate. Default 14. */
  lookback?: number;
  /** Score magnitude (in stdevs) required to fire. Default 1.0. */
  zThreshold?: number;
  /** Override the per-fill vol used for stop/target (fraction of price, e.g. stdev
   *  of recent returns). When omitted it's derived from `closes`. */
  volForStops?: number;
  /** Stop distance = volFraction × price × stopMult. Default 2. */
  stopMult?: number;
  /** Target distance = volFraction × price × targetMult. Default 1.5. */
  targetMult?: number;
}

export interface ReversalSignal {
  side: "long" | "short";
  /** Reversal-score magnitude (in stdevs) at fire time — a conviction proxy. */
  strength: number;
  /** Price distance from entry to the protective stop (> 0). */
  stopDistance: number;
  /** Price distance from entry to the take-profit (> 0). */
  targetDistance: number;
}

/**
 * Fire a short-term reversal signal off a close series.
 *
 *   LONG  when reversalScore > +zThreshold  (oversold → expect a bounce)
 *   SHORT when reversalScore < -zThreshold  (overbought → expect a fade)
 *   null  inside the neutral band, or on insufficient/degenerate input.
 *
 * Stop and target scale with recent realized volatility: the per-bar return
 * stdev × price gives a one-sigma price move, then × stopMult / targetMult.
 * Pure; defensive on short input.
 */
export function reversalSignal(
  closes: ReadonlyArray<number>,
  opts: ReversalSignalOptions = {},
): ReversalSignal | null {
  const lookback = Math.max(2, Math.floor(opts.lookback ?? 14));
  const zThreshold = opts.zThreshold ?? 1.0;
  const stopMult = opts.stopMult ?? 2;
  const targetMult = opts.targetMult ?? 1.5;

  if (closes.length < lookback) return null;

  const score = reversalScore(closes, lookback);
  if (!Number.isFinite(score) || Math.abs(score) < zThreshold) return null;

  const price = closes[closes.length - 1]!;
  if (!(price > 0)) return null;

  // Volatility fraction of price: caller override, else stdev of recent returns.
  const volFraction = opts.volForStops ?? std(recentReturns(closes, lookback));
  // Fall back to a tiny floor so stop/target are always positive and finite.
  const oneSigma = price * Math.max(volFraction, 1e-6);

  const side = score > 0 ? "long" : "short";
  return {
    side,
    strength: Math.abs(score),
    stopDistance: oneSigma * stopMult,
    targetDistance: oneSigma * targetMult,
  };
}
