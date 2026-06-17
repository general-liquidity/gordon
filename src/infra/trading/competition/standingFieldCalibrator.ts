/**
 * Calibrates the competition standing-monitor's field distributions from REAL peer
 * leaderboard data. The live monitor (`standingMonitor.ts` / `computeStanding`) currently
 * scores us against STATIC placeholder field models — `DEFAULT_FIELD` (return),
 * `DEFAULT_SHARPE_FIELD`, `DEFAULT_DRAWDOWN_FIELD` — that encode a "most entrants gamble"
 * prior rather than observed peers.
 *
 * Once the Round-1/2 peer leaderboard is wired, feed the empirical estimates from this
 * module into `computeStanding({ field, sharpeField, drawdownField })` to replace those
 * gambling-field placeholders:
 *   - `calibrateReturnField(peerReturns)`   → `field`        (FieldModel: { mean, std, n })
 *   - `calibrateMetricField(sharpes, fb)`   → `sharpeField`  (MetricField: { mean, std })
 *   - `calibrateMetricField(drawdowns, fb)` → `drawdownField`(MetricField: { mean, std })
 *
 * PURE: no I/O, no imports from other competition modules — returns plain objects so a
 * stale import can't break it. Both estimators use the sample (Bessel-corrected) std.
 */

/** Sample mean of finite values. Caller guarantees `values.length >= 1`. */
function sampleMean(values: number[]): number {
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/** Sample (Bessel, n−1) standard deviation. Caller guarantees `values.length >= 2`. */
function sampleStd(values: number[], mean: number): number {
  let ss = 0;
  for (const v of values) {
    const d = v - mean;
    ss += d * d;
  }
  return Math.sqrt(ss / (values.length - 1));
}

/**
 * Empirical return field from peer leaderboard returns: sample mean + sample (Bessel) std
 * of the finite peer returns; `n` = count of finite values. With <2 finite values there's
 * no dispersion to estimate, so fall back to the existing `DEFAULT_FIELD` default
 * ({ mean: 0, std: 0.4 }) with `n = max(1, finiteCount)`.
 */
export function calibrateReturnField(peerReturns: number[]): { mean: number; std: number; n: number } {
  const finite = peerReturns.filter((v) => Number.isFinite(v));
  if (finite.length < 2) {
    return { mean: 0, std: 0.4, n: Math.max(1, finite.length) };
  }
  const mean = sampleMean(finite);
  return { mean, std: sampleStd(finite, mean), n: finite.length };
}

/**
 * Empirical per-metric field (Sharpe or drawdown) from peer values: sample mean + sample
 * (Bessel) std of the finite values. With <2 finite values, return the supplied `fallback`
 * (e.g. `DEFAULT_SHARPE_FIELD` / `DEFAULT_DRAWDOWN_FIELD`).
 */
export function calibrateMetricField(
  values: number[],
  fallback: { mean: number; std: number },
): { mean: number; std: number } {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length < 2) return fallback;
  const mean = sampleMean(finite);
  return { mean, std: sampleStd(finite, mean) };
}
