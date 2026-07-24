/**
 * Triangular Arbitrage Parity (TAP) deviation (GORDON_TRIANGULAR_ARBITRAGE_PARITY).
 *
 * A deterministic 3-leg no-arbitrage-breakdown dislocation measure. For a
 * triangle (A/B, B/C, A/C via a vehicle asset B) the three cross rates must
 * close the loop: converting A -> B -> C should match the direct A -> C
 * quote, so the implied A/C equals (A/B) * (B/C) and the log loop-closure
 * deviation sits at ~0. When price formation is impaired, the loop stops
 * closing and the deviation moves off zero.
 *
 *   Parity (units: price(X/Y) = Y per 1 X):
 *     price(A/C) = price(A/B) * price(B/C)
 *   Deviation per observation:
 *     d_t = ln(directAC_t) - ln(legAB_t) - ln(legBC_t)   (~0 when consistent)
 *
 * We aggregate the intraday deviations to their STANDARD DEVIATION (not the
 * mean): opposite-direction violations (+d and -d) average toward zero but
 * their std stays positive, so a busy two-sided dislocation does not cancel
 * itself out. High / rising TAP-std is a leading price-formation stress
 * marker (BIS WP 1291 surfaced the March-2023 turmoil ~3 months early).
 *
 * Pure over injected leg-quote series — no hardcoded pairs. The canonical
 * crypto triangle is legAB = ETH/BTC, legBC = BTC/USDT, directAC = ETH/USDT;
 * FX triangles (EUR/USD, USD/JPY, EUR/JPY) map the same way.
 *
 * DISTINCT from crossVenueDivergence (2-node same-instrument mid divergence,
 * not the 3-leg loop closure).
 *
 * Reference: BIS Working Paper No. 1291 (triangular no-arbitrage deviations
 * as a market-functioning / price-formation stress indicator).
 */

export interface TriangleInput {
  /** A/B rate series (e.g. ETH/BTC): price of A quoted in B, parallel timestamp index. */
  legAB: ReadonlyArray<number>;
  /** B/C rate series (e.g. BTC/USDT): price of the vehicle asset B quoted in C. */
  legBC: ReadonlyArray<number>;
  /** Direct A/C rate series (e.g. ETH/USDT): price of A quoted in C. */
  directAC: ReadonlyArray<number>;
  /** Optional trailing-window length for the rolling-std dislocation read. Default 20. */
  rollingWindow?: number;
  /** Z-score above which the latest rolling std counts as a rising dislocation. Default 2. */
  zScoreThreshold?: number;
  /** Optional asset labels for the reason string. */
  labels?: { a?: string; b?: string; c?: string };
}

export interface TriangularArbitrageParityResult {
  /** Per-observation log loop-closure deviation (aligned to the shortest leg, positive rates only). */
  deviations: number[];
  observations: number;
  /** Standard deviation of the deviations (log units) — the headline TAP measure. */
  tapStd: number;
  /** tapStd expressed in basis points (log deviation ~ fractional deviation for small values). */
  tapStdBps: number;
  /** Mean deviation (for reference — ~0 for a symmetric two-sided break, non-zero for a persistent wedge). */
  meanDeviation: number;
  /** Largest absolute single-observation deviation. */
  maxAbsDeviation: number;
  /** Trailing-window std series when there are enough observations, else null. */
  rollingStd: number[] | null;
  /** Latest rolling std vs the distribution of earlier rolling stds (rising-dislocation z-score), else null. */
  dislocationZScore: number | null;
  /** True when the latest rolling std is rising beyond zScoreThreshold. */
  dislocationFlag: boolean;
  reason: string;
}

const DEFAULT_ROLLING_WINDOW = 20;
const DEFAULT_Z_THRESHOLD = 2;

/** Sample standard deviation (n-1). Returns 0 for fewer than 2 points. */
function std(xs: ReadonlyArray<number>): number {
  const n = xs.length;
  if (n < 2) return 0;
  let sum = 0;
  for (const v of xs) sum += v;
  const mean = sum / n;
  let ss = 0;
  for (const v of xs) {
    const d = v - mean;
    ss += d * d;
  }
  return Math.sqrt(ss / (n - 1));
}

function mean(xs: ReadonlyArray<number>): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const v of xs) s += v;
  return s / xs.length;
}

export function computeTriangularArbitrageParity(
  input: TriangleInput,
): TriangularArbitrageParityResult {
  const { legAB, legBC, directAC } = input;
  const n = Math.min(legAB.length, legBC.length, directAC.length);
  const rollingWindow = input.rollingWindow ?? DEFAULT_ROLLING_WINDOW;
  const zThreshold = input.zScoreThreshold ?? DEFAULT_Z_THRESHOLD;

  const deviations: number[] = [];
  for (let k = 0; k < n; k++) {
    const ab = legAB[k]!;
    const bc = legBC[k]!;
    const ac = directAC[k]!;
    // Rates must be strictly positive to take logs — skip malformed ticks.
    if (!(ab > 0) || !(bc > 0) || !(ac > 0)) continue;
    deviations.push(Math.log(ac) - Math.log(ab) - Math.log(bc));
  }

  if (deviations.length === 0) {
    return {
      deviations: [],
      observations: 0,
      tapStd: 0,
      tapStdBps: 0,
      meanDeviation: 0,
      maxAbsDeviation: 0,
      rollingStd: null,
      dislocationZScore: null,
      dislocationFlag: false,
      reason: "no valid observations (need positive rates on all three legs)",
    };
  }

  const tapStd = std(deviations);
  const meanDeviation = mean(deviations);
  let maxAbsDeviation = 0;
  for (const d of deviations) {
    const abs = Math.abs(d);
    if (abs > maxAbsDeviation) maxAbsDeviation = abs;
  }

  // Rolling-std series + rising-dislocation z-score: is the latest window's
  // TAP-std elevated relative to the earlier windows in the sample?
  let rollingStd: number[] | null = null;
  let dislocationZScore: number | null = null;
  let dislocationFlag = false;
  if (deviations.length >= rollingWindow * 2 && rollingWindow >= 2) {
    const series: number[] = [];
    for (let end = rollingWindow; end <= deviations.length; end++) {
      series.push(std(deviations.slice(end - rollingWindow, end)));
    }
    rollingStd = series;
    const latest = series[series.length - 1]!;
    const history = series.slice(0, series.length - 1);
    const histMean = mean(history);
    const histStd = std(history);
    if (histStd > 0) {
      dislocationZScore = (latest - histMean) / histStd;
      dislocationFlag = dislocationZScore >= zThreshold;
    }
  }

  const a = input.labels?.a ?? "A";
  const b = input.labels?.b ?? "B";
  const c = input.labels?.c ?? "C";
  const reason = dislocationFlag
    ? `${a}/${b}/${c} TAP-std rising (${tapStd.toExponential(2)}, z=${dislocationZScore!.toFixed(2)}) — impaired loop closure`
    : `${a}/${b}/${c} TAP-std ${tapStd.toExponential(2)} over ${deviations.length} obs`;

  return {
    deviations,
    observations: deviations.length,
    tapStd,
    tapStdBps: tapStd * 10000,
    meanDeviation,
    maxAbsDeviation,
    rollingStd,
    dislocationZScore,
    dislocationFlag,
    reason,
  };
}

export function triangularArbitrageParityToPayload(
  result: TriangularArbitrageParityResult,
): Record<string, unknown> {
  return {
    kind: "triangular_arbitrage_parity.evaluated",
    observations: result.observations,
    tapStdBps: Number(result.tapStdBps.toFixed(4)),
    maxAbsDeviationBps: Number((result.maxAbsDeviation * 10000).toFixed(4)),
    dislocationFlag: result.dislocationFlag,
    ...(result.dislocationZScore !== null && {
      dislocationZScore: Number(result.dislocationZScore.toFixed(3)),
    }),
  };
}
