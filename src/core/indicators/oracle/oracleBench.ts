/**
 * Oracle bench — differential comparison of a production indicator series
 * against a reference (oracle) series.
 *
 * The LDD recipe in code: one comparator (equality with a relative tolerance,
 * nulls match nulls), one report (% of points matching — the hill-climb signal),
 * and a deterministic "random" input generator so the differential leg is
 * reproducible in CI without Math.random.
 */

export interface SeriesMismatch {
  index: number;
  actual: number | null;
  expected: number | null;
  absDiff?: number;
}

export interface SeriesDiff {
  matched: number;
  total: number;
  /** Fraction of aligned points that matched (1 = identical). */
  matchRate: number;
  mismatches: SeriesMismatch[];
}

/**
 * Compare two series point-by-point. Numbers match within a relative tolerance;
 * a null matches only another null (a present value vs an absent one is a real
 * mismatch — the kind of windowing/off-by-one bug the bench exists to catch).
 */
export function compareSeries(
  actual: ReadonlyArray<number | null>,
  expected: ReadonlyArray<number | null>,
  tol = 1e-9,
): SeriesDiff {
  const total = Math.max(actual.length, expected.length);
  const mismatches: SeriesMismatch[] = [];
  let matched = 0;

  for (let i = 0; i < total; i++) {
    const a = actual[i] ?? null;
    const e = expected[i] ?? null;
    let ok: boolean;
    if (a === null || e === null) {
      ok = a === null && e === null;
    } else {
      ok = Math.abs(a - e) <= Math.max(tol, Math.abs(e) * tol);
    }
    if (ok) matched++;
    else
      mismatches.push({
        index: i,
        actual: a,
        expected: e,
        absDiff: a !== null && e !== null ? Math.abs(a - e) : undefined,
      });
  }

  return { matched, total, matchRate: total === 0 ? 1 : matched / total, mismatches };
}

export interface OracleResult {
  name: string;
  matchRate: number;
  mismatches: number;
  passed: boolean;
  /** First few mismatches, for a readable failure. */
  sample: SeriesMismatch[];
}

/** Run one differential case: production series vs oracle series. */
export function runOracleCase(
  name: string,
  actual: ReadonlyArray<number | null>,
  expected: ReadonlyArray<number | null>,
  tol = 1e-9,
): OracleResult {
  const diff = compareSeries(actual, expected, tol);
  return {
    name,
    matchRate: diff.matchRate,
    mismatches: diff.mismatches.length,
    passed: diff.mismatches.length === 0,
    sample: diff.mismatches.slice(0, 5),
  };
}

export interface OracleReport {
  results: OracleResult[];
  passed: boolean;
  /** Mean match rate across cases — the aggregate signal. */
  matchRate: number;
  summary: string;
}

/** Aggregate many cases into one report (the LDD "% green" gate). */
export function runOracleBench(results: OracleResult[]): OracleReport {
  const passed = results.every((r) => r.passed);
  const matchRate =
    results.length === 0 ? 1 : results.reduce((s, r) => s + r.matchRate, 0) / results.length;
  const failed = results.filter((r) => !r.passed);
  const summary =
    `${results.length} oracle cases: ${results.length - failed.length} matched, ${failed.length} diverged` +
    (failed.length > 0
      ? ` — DIVERGED: ${failed.map((r) => `${r.name} (${r.mismatches})`).join("; ")}`
      : "");
  return { results, passed, matchRate, summary };
}

/**
 * Deterministic LCG — reproducible "random" inputs for the differential leg.
 * (Math.random would make CI non-reproducible; a fixed seed gives the same
 * series every run, so a failure is debuggable.)
 */
export function makePrng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A reproducible random-walk price series for differential testing. */
export function randomSeries(n: number, prng: () => number, base = 100, vol = 2): number[] {
  const out: number[] = [];
  let p = base;
  for (let i = 0; i < n; i++) {
    p = Math.max(1, p + (prng() - 0.5) * vol);
    out.push(p);
  }
  return out;
}
