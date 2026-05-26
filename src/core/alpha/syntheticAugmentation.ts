/**
 * Synthetic data augmentation — generate alternate-reality candle
 * series from real history for backtest robustness.
 *
 * Pattern from Build Alpha (Bergstrom) and Timothy Masters' MCPT
 * literature. The premise: training on one realized path is fragile —
 * the strategy memorizes that path's quirks. Augmenting with
 * permuted / shifted / noise-injected variants forces the strategy
 * to generalize.
 *
 * Three generators, each a different lens on "what could have
 * happened given the same statistical structure":
 *
 *   1. shiftBars(candles, offset) — re-aggregate bars on a shifted
 *      schedule (e.g. 10:00-10:05 → 10:02-10:07). Tests whether the
 *      strategy depends on a specific bar boundary or just the
 *      underlying price action.
 *
 *   2. mcpPermute(candles, seed) — Masters' Monte Carlo Permutation:
 *      decompose into intra-bar deltas (O→H, O→L, O→C), shuffle the
 *      sequence, reconstruct. Same marginal statistics (volatility,
 *      skew, kurtosis); destroyed temporal patterns.
 *
 *   3. addNoiseBands(candles, volPct) — inject block-level vol noise:
 *      multiply each bar's H-L range by a randomized factor and
 *      recenter. Tests strategy sensitivity to small ATR shifts
 *      without changing the price trajectory.
 *
 * Distinct from `syntheticFutures.ts` which generates correlated
 * FORWARD paths (Cholesky MC for stress testing). This module
 * augments HISTORICAL data for in-sample/walk-forward robustness.
 *
 * All functions pure. Caller seeds the RNG for reproducibility.
 */

export interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  openTime?: number;
  closeTime?: number;
}

/** Deterministic LCG for reproducible runs. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

/**
 * Shift bar boundaries by `offsetBars` positions and re-aggregate.
 * Conceptually: original bars 0..3 → output bar 0 (if offsetBars=4).
 * Useful for "would the strategy still work if the venue's bar close
 * was at :02 instead of :00?" — tests bar-boundary sensitivity.
 *
 * Implementation: groups every `offsetBars` consecutive bars into one
 * synthetic bar (open = group[0].open, close = group[last].close,
 * high/low = group's max/min). Final partial group is dropped.
 */
export function shiftBars(candles: Candle[], offsetBars: number): Candle[] {
  if (!Array.isArray(candles) || candles.length === 0) return [];
  if (!Number.isInteger(offsetBars) || offsetBars < 2) {
    throw new Error("shiftBars: offsetBars must be an integer >= 2");
  }
  const out: Candle[] = [];
  for (let i = 0; i + offsetBars <= candles.length; i += offsetBars) {
    const group = candles.slice(i, i + offsetBars);
    let high = -Infinity;
    let low = Infinity;
    let volume = 0;
    for (const c of group) {
      if (c.high > high) high = c.high;
      if (c.low < low) low = c.low;
      volume += c.volume ?? 0;
    }
    out.push({
      open: group[0]!.open,
      high,
      low,
      close: group[group.length - 1]!.close,
      volume,
      openTime: group[0]!.openTime,
      closeTime: group[group.length - 1]!.closeTime,
    });
  }
  return out;
}

/**
 * Masters' MCPT permutation: decompose each bar into log-deltas
 * (open→high, open→low, open→close), shuffle the sequence, then
 * reconstruct OHLC by walking the shuffled deltas forward.
 *
 * Preserved: marginal distribution of all four price deltas, volatility
 * clustering AT THE BAR LEVEL (each shuffled bar still has its own
 * H-L spread), starting open.
 * Destroyed: temporal patterns, runs, autocorrelation.
 *
 * Use case: re-run a strategy on N permuted series. If the strategy's
 * profit factor on real data sits in the top X% of the permuted
 * distribution, the edge is path-dependent (real). If it sits in the
 * middle, the edge is data-mining bias.
 */
export function mcpPermute(candles: Candle[], seed: number): Candle[] {
  if (!Array.isArray(candles) || candles.length < 2) return candles.slice();
  const rng = makeRng(seed);

  // Decompose each bar (after the first) into log-deltas relative to
  // the previous close. The first bar's open is the anchor.
  const deltas: Array<{ relOpen: number; relHigh: number; relLow: number; relClose: number }> = [];
  for (let i = 1; i < candles.length; i++) {
    const prevClose = candles[i - 1]!.close;
    if (prevClose <= 0) {
      // Degenerate input — return as-is rather than diverging.
      return candles.slice();
    }
    const c = candles[i]!;
    deltas.push({
      relOpen: Math.log(c.open / prevClose),
      relHigh: Math.log(c.high / prevClose),
      relLow: Math.log(c.low / prevClose),
      relClose: Math.log(c.close / prevClose),
    });
  }

  // Fisher-Yates shuffle.
  for (let i = deltas.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = deltas[i]!;
    deltas[i] = deltas[j]!;
    deltas[j] = tmp;
  }

  // Reconstruct OHLC by chaining the shuffled deltas forward from the
  // original first bar's close.
  const out: Candle[] = [candles[0]!];
  let prevClose = candles[0]!.close;
  for (const d of deltas) {
    const open = prevClose * Math.exp(d.relOpen);
    const high = prevClose * Math.exp(d.relHigh);
    const low = prevClose * Math.exp(d.relLow);
    const close = prevClose * Math.exp(d.relClose);
    out.push({ open, high, low, close, volume: 0 });
    prevClose = close;
  }
  return out;
}

/**
 * Inject block-level vol noise: multiply each bar's H-L spread by a
 * random factor in [1 - volPct, 1 + volPct], recentered around the
 * bar's midpoint so the close doesn't drift systematically.
 *
 * Tests strategy sensitivity to small ATR shifts without changing
 * the price trajectory's shape — different from MCP permutation,
 * which destroys patterns entirely.
 *
 * volPct = 0.1 means each bar's range can shrink or grow up to 10%.
 */
export function addNoiseBands(candles: Candle[], volPct: number, seed: number): Candle[] {
  if (!Array.isArray(candles) || candles.length === 0) return [];
  if (!(volPct >= 0 && volPct < 1)) {
    throw new Error("addNoiseBands: volPct must be in [0, 1)");
  }
  const rng = makeRng(seed);
  const out: Candle[] = [];
  for (const c of candles) {
    const mid = (c.high + c.low) / 2;
    const halfRange = (c.high - c.low) / 2;
    const factor = 1 + (rng() * 2 - 1) * volPct;
    const newHalf = halfRange * factor;
    const newHigh = mid + newHalf;
    const newLow = mid - newHalf;
    // Open / close: scaled around the midpoint by the same factor so
    // the bar's shape is preserved. Avoids degenerate open > high cases.
    const newOpen = mid + (c.open - mid) * factor;
    const newClose = mid + (c.close - mid) * factor;
    out.push({
      open: newOpen,
      high: Math.max(newHigh, newOpen, newClose),
      low: Math.min(newLow, newOpen, newClose),
      close: newClose,
      volume: c.volume,
      openTime: c.openTime,
      closeTime: c.closeTime,
    });
  }
  return out;
}
