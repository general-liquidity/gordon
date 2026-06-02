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
 *
 * Named-pathology stress injectors (injectGaps / injectCrashBlocks /
 * injectFlatlineBlocks / stretchVolatility / reversePath /
 * invertTrendWindows) live below the three core generators — a robustness
 * axis distinct from permutation: inject SPECIFIC failure modes, re-backtest,
 * then two-sample test scenario PnL vs baseline (twoSampleTest.ts).
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

// ---------------------------------------------------------------------------
// Named-pathology stress injection. Rather than asking "would noise look this
// good?", these inject SPECIFIC market failure modes (gaps, crashes,
// illiquidity flatlines, vol regime shifts, path reversal) into a real series
// so the caller can re-backtest and two-sample test scenario PnL vs baseline.
// All deterministic: index-driven or seeded via the shared makeRng LCG.
// ---------------------------------------------------------------------------

/** Resolve targets from explicit `atIndices` (wins) or an `everyN` stride. */
function resolveTargetIndices(
  length: number,
  atIndices: number[] | undefined,
  everyN: number | undefined,
): number[] {
  const set = new Set<number>();
  if (Array.isArray(atIndices)) {
    for (const i of atIndices) {
      if (Number.isInteger(i) && i >= 0 && i < length) set.add(i);
    }
  } else if (Number.isInteger(everyN) && everyN! >= 1) {
    for (let i = everyN!; i < length; i += everyN!) set.add(i);
  }
  return [...set].sort((a, b) => a - b);
}

/** Deterministic block-start indices via the shared LCG (mcpPermute pattern). */
function seededStartIndices(
  length: number,
  lengthBars: number,
  count: number,
  seed: number,
): number[] {
  const maxStart = length - lengthBars;
  if (maxStart < 0 || count < 1) return [];
  const rng = makeRng(seed);
  const set = new Set<number>();
  const maxAttempts = count * 20 + 50;
  for (let a = 0; a < maxAttempts && set.size < count; a++) {
    set.add(Math.floor(rng() * (maxStart + 1)));
  }
  return [...set].sort((a, b) => a - b);
}

function cleanStarts(length: number, startIndices: number[]): number[] {
  return [
    ...new Set(startIndices.filter((i) => Number.isInteger(i) && i >= 0 && i < length)),
  ].sort((a, b) => a - b);
}

function rounded(x: number): number {
  return parseFloat(x.toFixed(8));
}

/**
 * Inject discrete price gaps: at each target bar, shift that bar's whole OHLC
 * by a ±magnitudePct multiplicative factor (internal shape preserved, level
 * jumps). Gaps are local discontinuities — subsequent bars are NOT cascaded.
 *
 *   direction "up" → +magnitudePct; "down" → −magnitudePct;
 *   "alternate" → +,−,+,− across the target sequence.
 *
 * Anchor: flat series, atIndices=[2], magnitudePct=2 → bar 2 open = orig×1.02.
 */
export function injectGaps(
  candles: Candle[],
  opts: {
    magnitudePct: number;
    atIndices?: number[];
    everyN?: number;
    direction?: "up" | "down" | "alternate";
    seed?: number;
  },
): Candle[] {
  if (!Array.isArray(candles) || candles.length === 0) return [];
  if (!Number.isFinite(opts?.magnitudePct) || opts.magnitudePct === 0) {
    return candles.map((c) => ({ ...c }));
  }
  const targets = resolveTargetIndices(candles.length, opts.atIndices, opts.everyN);
  const dir = opts.direction ?? "up";
  const mag = Math.abs(opts.magnitudePct) / 100;
  const factorByIndex = new Map<number, number>();
  targets.forEach((idx, k) => {
    let sign: number;
    if (dir === "up") sign = 1;
    else if (dir === "down") sign = -1;
    else sign = k % 2 === 0 ? 1 : -1;
    factorByIndex.set(idx, 1 + sign * mag);
  });
  return candles.map((c, i) => {
    const factor = factorByIndex.get(i);
    if (factor == null) return { ...c };
    return {
      open: rounded(c.open * factor),
      high: rounded(c.high * factor),
      low: rounded(c.low * factor),
      close: rounded(c.close * factor),
      volume: c.volume,
      openTime: c.openTime,
      closeTime: c.closeTime,
    };
  });
}

/**
 * Inject multi-bar crash blocks: a cumulative drawdown of `dropPct` spread
 * geometrically over `lengthBars` bars (per-bar factor f, f^lengthBars =
 * 1−dropPct/100). Post-block bars stay level-shifted by the block's total
 * factor so the crash persists.
 *
 * Anchor: lengthBars=3, dropPct=9 → close at block end ≈ start × 0.91.
 */
export function injectCrashBlocks(
  candles: Candle[],
  opts: {
    dropPct: number;
    lengthBars: number;
    startIndices?: number[];
    count?: number;
    seed?: number;
  },
): Candle[] {
  if (!Array.isArray(candles) || candles.length === 0) return [];
  const len = opts?.lengthBars;
  if (!Number.isInteger(len) || len < 1) return candles.map((c) => ({ ...c }));
  if (!Number.isFinite(opts?.dropPct) || opts.dropPct <= 0 || opts.dropPct >= 100) {
    return candles.map((c) => ({ ...c }));
  }
  const starts = Array.isArray(opts.startIndices)
    ? cleanStarts(candles.length, opts.startIndices)
    : seededStartIndices(candles.length, len, opts.count ?? 1, opts.seed ?? 0);
  if (starts.length === 0) return candles.map((c) => ({ ...c }));

  const perBar = Math.pow(1 - opts.dropPct / 100, 1 / len);
  const out: Candle[] = candles.map((c) => ({ ...c }));
  const startSet = new Set<number>(starts);

  let cum = 1;
  let barsLeft = 0;
  for (let i = 0; i < out.length; i++) {
    if (startSet.has(i)) barsLeft = len;
    if (barsLeft > 0) {
      cum *= perBar;
      barsLeft--;
    }
    const c = out[i]!;
    out[i] = {
      open: rounded(c.open * cum),
      high: rounded(c.high * cum),
      low: rounded(c.low * cum),
      close: rounded(c.close * cum),
      volume: c.volume,
      openTime: c.openTime,
      closeTime: c.closeTime,
    };
  }
  return out;
}

/**
 * Inject flatline (frozen / illiquidity) blocks: across each block the bar
 * collapses to O=H=L=C frozen at the pre-block close (or the block's own first
 * open when it starts at bar 0). Volume zeroed across the block. Models a
 * venue halt / dead-book period.
 *
 * Anchor: O==H==L==C across every bar of the block.
 */
export function injectFlatlineBlocks(
  candles: Candle[],
  opts: { lengthBars: number; startIndices?: number[]; count?: number; seed?: number },
): Candle[] {
  if (!Array.isArray(candles) || candles.length === 0) return [];
  const len = opts?.lengthBars;
  if (!Number.isInteger(len) || len < 1) return candles.map((c) => ({ ...c }));
  const starts = Array.isArray(opts.startIndices)
    ? cleanStarts(candles.length, opts.startIndices)
    : seededStartIndices(candles.length, len, opts.count ?? 1, opts.seed ?? 0);
  if (starts.length === 0) return candles.map((c) => ({ ...c }));

  const out: Candle[] = candles.map((c) => ({ ...c }));
  for (const s of starts) {
    const frozen = s > 0 ? out[s - 1]!.close : out[s]!.open;
    for (let i = s; i < Math.min(s + len, out.length); i++) {
      const c = out[i]!;
      out[i] = {
        open: rounded(frozen),
        high: rounded(frozen),
        low: rounded(frozen),
        close: rounded(frozen),
        volume: 0,
        openTime: c.openTime,
        closeTime: c.closeTime,
      };
    }
  }
  return out;
}

/**
 * Deterministic uniform volatility stretch: widen each bar's H–L range by
 * ×factor around its CLOSE (close held fixed); open/high/low repositioned by
 * scaling their distance from the close. Vol-regime shift without changing the
 * close-to-close path.
 *
 * Anchor: factor=2 → (high − low) doubles, close unchanged.
 */
export function stretchVolatility(candles: Candle[], opts: { factor: number }): Candle[] {
  if (!Array.isArray(candles) || candles.length === 0) return [];
  const f = opts?.factor;
  if (!Number.isFinite(f) || f <= 0) return candles.map((c) => ({ ...c }));
  return candles.map((c) => {
    const close = c.close;
    return {
      open: rounded(close + (c.open - close) * f),
      high: rounded(close + (c.high - close) * f),
      low: rounded(close + (c.low - close) * f),
      close: rounded(close),
      volume: c.volume,
      openTime: c.openTime,
      closeTime: c.closeTime,
    };
  });
}

/**
 * Reverse chronological order (each bar's OHLC shape preserved) to test
 * directional dependence. The original time axis is reassigned in forward
 * order so timestamps stay monotonic; only the bar SHAPES are reversed.
 *
 * Anchor: output[0]'s OHLC equals the original last bar's OHLC.
 */
export function reversePath(candles: Candle[]): Candle[] {
  if (!Array.isArray(candles) || candles.length === 0) return [];
  const n = candles.length;
  const out: Candle[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const src = candles[n - 1 - i]!;
    const axis = candles[i]!;
    out[i] = {
      open: src.open,
      high: src.high,
      low: src.low,
      close: src.close,
      volume: src.volume,
      openTime: axis.openTime,
      closeTime: axis.closeTime,
    };
  }
  return out;
}

/**
 * Invert trending windows into flat segments: scan non-overlapping windows of
 * `window` bars; any window whose net close-to-close move exceeds 1% is
 * replaced by a flat segment frozen at the window's first open (O=H=L=C).
 * Tests dependence on trend persistence. `seed` is accepted for signature
 * symmetry but detection is deterministic (threshold-driven, no randomness).
 */
export function invertTrendWindows(
  candles: Candle[],
  opts: { window: number; seed?: number },
): Candle[] {
  if (!Array.isArray(candles) || candles.length === 0) return [];
  const w = opts?.window;
  if (!Number.isInteger(w) || w < 2 || candles.length < w) {
    return candles.map((c) => ({ ...c }));
  }
  const out: Candle[] = candles.map((c) => ({ ...c }));
  for (let start = 0; start + w <= out.length; start += w) {
    const first = out[start]!;
    const last = out[start + w - 1]!;
    if (first.open <= 0) continue;
    const netMove = Math.abs(last.close / first.open - 1);
    if (netMove <= 0.01) continue;
    const frozen = first.open;
    for (let i = start; i < start + w; i++) {
      const c = out[i]!;
      out[i] = {
        open: rounded(frozen),
        high: rounded(frozen),
        low: rounded(frozen),
        close: rounded(frozen),
        volume: c.volume,
        openTime: c.openTime,
        closeTime: c.closeTime,
      };
    }
  }
  return out;
}
