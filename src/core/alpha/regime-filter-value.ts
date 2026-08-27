/**
 * Regime-Filter Value Test ("The Regime Filter Trap").
 *
 * Before building a regime filter for a strategy, measure what a WRONG
 * switch costs. A filter that misreads the regime hurts twice: it pulls
 * you out of conditions the strategy was eating well, then puts you back
 * late, after the favourable stretch already paid everyone who stayed. A
 * mediocre filter can cost more than the hostile regimes it was built to
 * dodge.
 *
 * The exercise (per the essay), at the STRATEGY-RETURN level — distinct
 * from regime-detection-lag (which scores classifier responsiveness vs
 * ground truth) and regime-policy (which allocates given a regime):
 *
 *   1. Per-regime attribution — split the strategy's realized returns by
 *      regime label. Which regimes does it make/lose money in? Is it even
 *      regime-sensitive? (Filtering a regime-insensitive strategy is pure
 *      cost.)
 *   2. Price the misclassification — re-run the same returns with the
 *      filter deliberately DEGRADED: shift every switch late by a
 *      realistic detection lag, and flip a share of the calls outright.
 *      Filters detect changes after they start, so the lagged version is
 *      closer to what you'll actually own than the clean one.
 *   3. Verdict — if losses concentrate in identifiable regimes AND the
 *      edge survives the lagged/degraded filter, build it. If the
 *      per-regime attribution is mushy or the degraded filter eats the
 *      edge, the filter is a complexity tax.
 *
 * The "filter" here goes flat (return 0) during hostile regimes — those
 * supplied by the caller, or, if none given, the regimes with negative
 * mean expectancy. Pure function; deterministic (flips are evenly spaced
 * by index, no RNG).
 */

export type RegimeFilterVerdict =
  | "build_filter"
  | "complexity_tax"
  | "regime_insensitive"
  | "insufficient_data";

export interface RegimeAttribution {
  regime: string;
  bars: number;
  meanReturn: number;
  totalReturn: number;
  winRate: number;
  hostile: boolean;
}

export interface RegimeFilterValueResult {
  perRegime: RegimeAttribution[];
  hostileRegimes: string[];
  /** Mean per-bar return, no filter. */
  unfilteredMean: number;
  /** Mean per-bar return, perfect-foresight filter (flat in hostile regimes). Upper bound. */
  cleanFilteredMean: number;
  /** Mean per-bar return, filter degraded by detection lag + flipped calls. What you'll actually own. */
  degradedFilteredMean: number;
  /** degradedFilteredMean − unfilteredMean. >0 = the realistic filter adds value. */
  filterValue: number;
  /** cleanFilteredMean − unfilteredMean. The best a perfect filter could do. */
  cleanFilterValue: number;
  /** filterValue / cleanFilterValue ∈ (−∞, 1]. How much of the ideal edge survives degradation. */
  edgeRetention: number | null;
  /** Spread of per-regime mean returns (max − min). Low = regime-insensitive. */
  regimeSensitivity: number;
  detectionLagBars: number;
  flipFraction: number;
  sampleSize: number;
  verdict: RegimeFilterVerdict;
  interpretation: string;
}

export interface RegimeFilterValueOptions {
  /** Regimes to filter OUT (go flat). Default: regimes with negative mean return. */
  hostileRegimes?: string[];
  /** Bars to delay every filter switch (realistic detection lag). Default 2. */
  detectionLagBars?: number;
  /** Fraction of filter segments to flip outright (misclassification). Default 0.15. */
  flipFraction?: number;
}

const DEFAULT_LAG = 2;
const DEFAULT_FLIP = 0.15;
const MIN_BARS = 20;

function round(x: number, n = 6): number {
  return Number(x.toFixed(n));
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function neutral(lag: number, flip: number, n: number, why: string): RegimeFilterValueResult {
  return {
    perRegime: [],
    hostileRegimes: [],
    unfilteredMean: 0,
    cleanFilteredMean: 0,
    degradedFilteredMean: 0,
    filterValue: 0,
    cleanFilterValue: 0,
    edgeRetention: null,
    regimeSensitivity: 0,
    detectionLagBars: lag,
    flipFraction: flip,
    sampleSize: n,
    verdict: "insufficient_data",
    interpretation: `Neutral — ${why}.`,
  };
}

export function computeRegimeFilterValue(input: {
  returns: ReadonlyArray<number>;
  regimeLabels: ReadonlyArray<string>;
  options?: RegimeFilterValueOptions;
}): RegimeFilterValueResult {
  const opts = input.options ?? {};
  const lag = Math.max(0, Math.floor(opts.detectionLagBars ?? DEFAULT_LAG));
  const flip = Math.min(0.99, Math.max(0, opts.flipFraction ?? DEFAULT_FLIP));

  const returns = input.returns ?? [];
  const labels = input.regimeLabels ?? [];
  const n = Math.min(returns.length, labels.length);

  if (n < MIN_BARS) {
    return neutral(lag, flip, n, `need ≥ ${MIN_BARS} aligned bars, got ${n}`);
  }
  const r = returns.slice(0, n);
  const lbl = labels.slice(0, n);
  if (!r.every((x) => Number.isFinite(x))) {
    return neutral(lag, flip, n, "non-finite return encountered");
  }

  // Per-regime attribution.
  const byRegime = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    let arr = byRegime.get(lbl[i]!);
    if (arr == null) {
      arr = [];
      byRegime.set(lbl[i]!, arr);
    }
    arr.push(r[i]!);
  }
  if (byRegime.size < 2) {
    return neutral(lag, flip, n, "need ≥ 2 distinct regimes to evaluate a filter");
  }

  const hostileSet = new Set(opts.hostileRegimes ?? []);
  const deriveHostile = (opts.hostileRegimes ?? []).length === 0;

  const perRegime: RegimeAttribution[] = [];
  const regimeMean = new Map<string, number>();
  for (const [regime, rs] of byRegime) {
    const m = mean(rs);
    regimeMean.set(regime, m);
    const wins = rs.filter((x) => x > 0).length;
    const hostile = deriveHostile ? m < 0 : hostileSet.has(regime);
    if (deriveHostile && hostile) hostileSet.add(regime);
    perRegime.push({
      regime,
      bars: rs.length,
      meanReturn: round(m),
      totalReturn: round(rs.reduce((a, b) => a + b, 0)),
      winRate: round(wins / rs.length, 4),
      hostile,
    });
  }
  perRegime.sort((a, b) => b.meanReturn - a.meanReturn);

  const means = [...regimeMean.values()];
  const regimeSensitivity = Math.max(...means) - Math.min(...means);

  // Raw "in-market" mask: flat (false) during hostile regimes.
  const rawMask = lbl.map((g) => !hostileSet.has(g));

  // Degrade 1 — detection lag: every transition registers `lag` bars late.
  const laggedMask = rawMask.map((_, i) => (i < lag ? rawMask[0]! : rawMask[i - lag]!));

  // Degrade 2 — flip an evenly-spaced share of contiguous filter segments.
  const segments: Array<{ start: number; end: number; value: boolean }> = [];
  for (let i = 0; i < n; i++) {
    if (i === 0 || laggedMask[i] !== laggedMask[i - 1]) {
      segments.push({ start: i, end: i, value: laggedMask[i]! });
    } else {
      segments[segments.length - 1]!.end = i;
    }
  }
  const segCount = segments.length;
  const flips = Math.floor(flip * segCount);
  const degradedMask = laggedMask.slice();
  if (flips > 0) {
    for (let k = 0; k < segCount; k++) {
      // Bresenham-style even spacing of `flips` flipped segments.
      if ((k * flips) % segCount < flips) {
        const seg = segments[k]!;
        for (let i = seg.start; i <= seg.end; i++) degradedMask[i] = !seg.value;
      }
    }
  }

  const unfilteredMean = mean(r);
  const cleanFiltered: number[] = [];
  const degradedFiltered: number[] = [];
  for (let i = 0; i < n; i++) {
    cleanFiltered.push(rawMask[i] ? r[i]! : 0);
    degradedFiltered.push(degradedMask[i] ? r[i]! : 0);
  }
  const cleanFilteredMean = mean(cleanFiltered);
  const degradedFilteredMean = mean(degradedFiltered);

  const filterValue = degradedFilteredMean - unfilteredMean;
  const cleanFilterValue = cleanFilteredMean - unfilteredMean;
  const edgeRetention =
    Math.abs(cleanFilterValue) > 1e-12 ? round(filterValue / cleanFilterValue, 4) : null;

  // Verdict. Sensitivity is judged relative to the return scale.
  const scale = Math.max(1e-9, Math.sqrt(mean(r.map((x) => x * x))));
  const sensitive = regimeSensitivity > 0.5 * scale && cleanFilterValue > 0;

  let verdict: RegimeFilterVerdict;
  if (!sensitive) {
    verdict = "regime_insensitive";
  } else if (filterValue > 0) {
    verdict = "build_filter";
  } else {
    verdict = "complexity_tax";
  }

  const pct = (x: number) => `${(x * 100).toFixed(3)}%`;
  let interpretation: string;
  if (verdict === "regime_insensitive") {
    interpretation =
      `Regime-insensitive: per-regime expectancy spread ${pct(regimeSensitivity)} is small vs return scale ${pct(scale)}` +
      (cleanFilterValue <= 0 ? " (even a perfect filter wouldn't help)" : "") +
      `. Filtering this strategy is pure cost — leave it unfiltered.`;
  } else if (verdict === "build_filter") {
    interpretation =
      `Build the filter: hostile regime(s) [${[...hostileSet].join(", ")}] concentrate losses, and the edge survives ` +
      `a ${lag}-bar lag + ${(flip * 100).toFixed(0)}% flipped calls — degraded filter adds ${pct(filterValue)}/bar ` +
      `(${edgeRetention == null ? "n/a" : `${(edgeRetention * 100).toFixed(0)}%`} of the perfect-filter edge ${pct(cleanFilterValue)}).`;
  } else {
    interpretation =
      `Complexity tax: a perfect filter would add ${pct(cleanFilterValue)}/bar, but under a realistic ${lag}-bar lag + ` +
      `${(flip * 100).toFixed(0)}% misclassification it nets ${pct(filterValue)}/bar — the lag/error eats the edge. ` +
      `Don't build it (or tighten detection first).`;
  }

  return {
    perRegime,
    hostileRegimes: [...hostileSet],
    unfilteredMean: round(unfilteredMean),
    cleanFilteredMean: round(cleanFilteredMean),
    degradedFilteredMean: round(degradedFilteredMean),
    filterValue: round(filterValue),
    cleanFilterValue: round(cleanFilterValue),
    edgeRetention,
    regimeSensitivity: round(regimeSensitivity),
    detectionLagBars: lag,
    flipFraction: flip,
    sampleSize: n,
    verdict,
    interpretation,
  };
}
