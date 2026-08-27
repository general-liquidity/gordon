/**
 * Dual Session VWAP (GORDON_DUAL_VWAP).
 *
 * Two VWAPs simultaneously over the same input:
 *
 *   - Session VWAP: cumulative since the start of the current UTC day
 *     (or caller-supplied session boundary). Resets each day. Useful for
 *     intraday mean-reversion and execution benchmarking.
 *   - Rolling VWAP: continuous N-bar trailing VWAP. Smooths out the
 *     session-reset cliff and gives a "where has volume been agreeing
 *     on price lately" signal independent of session boundaries.
 *
 * Both VWAPs ship with volume-weighted ±1σ / ±2σ bands. The signed gap
 * between them (sessionVwap − rollingVwap) is exposed as a divergence
 * metric — when they disagree by more than `divergencePct`, the day's
 * activity has dragged price away from the recent equilibrium.
 *
 * Complements Gordon's existing single-VWAP in `core/indicators/vwap.ts`
 * which only does the cumulative-since-start variant.
 *
 * Pure compute. No I/O.
 */

export interface DualVwapCandle {
  timestamp: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface DualVwapInput {
  candles: ReadonlyArray<DualVwapCandle>;
  /** Rolling window in bars. Default 100. */
  rollingPeriod?: number;
  /** UTC hour at which the trading day begins. Default 0. */
  sessionStartHourUtc?: number;
  /** Std multipliers for ±band1 / ±band2. Default 1.0, 2.0. */
  band1Multiplier?: number;
  band2Multiplier?: number;
  /** Significant divergence threshold as % of price. Default 0.005 (0.5%). */
  divergencePct?: number;
}

export type DualVwapPosition = "far_above" | "above" | "at" | "below" | "far_below";

export interface DualVwapBands {
  vwap: number;
  upper1: number;
  upper2: number;
  lower1: number;
  lower2: number;
}

export interface DualVwapResult {
  session: DualVwapBands;
  rolling: DualVwapBands;
  sessionPosition: DualVwapPosition;
  rollingPosition: DualVwapPosition;
  /** sessionVwap − rollingVwap (signed). */
  divergence: number;
  /** Divergence as fraction of rollingVwap. */
  divergencePctValue: number;
  divergenceSignificant: boolean;
  sampleSize: number;
  reasoning: string;
}

const DEFAULT_ROLLING = 100;
const DEFAULT_BAND_1 = 1.0;
const DEFAULT_BAND_2 = 2.0;
const DEFAULT_DIVERGENCE_PCT = 0.005;
const MS_PER_DAY = 86_400_000;
const MS_PER_HOUR = 3_600_000;

const EMPTY_BANDS: DualVwapBands = {
  vwap: Number.NaN,
  upper1: Number.NaN,
  upper2: Number.NaN,
  lower1: Number.NaN,
  lower2: Number.NaN,
};

function typicalPrice(c: DualVwapCandle): number {
  return (c.high + c.low + c.close) / 3;
}

function computeVwapWithBands(
  candles: ReadonlyArray<DualVwapCandle>,
  band1Mult: number,
  band2Mult: number,
): DualVwapBands {
  let cumPv = 0;
  let cumV = 0;
  let cumPvSq = 0;
  for (const c of candles) {
    if (c.volume <= 0) continue;
    const tp = typicalPrice(c);
    cumPv += tp * c.volume;
    cumPvSq += tp * tp * c.volume;
    cumV += c.volume;
  }
  if (cumV === 0) return { ...EMPTY_BANDS };
  const vwap = cumPv / cumV;
  // Volume-weighted variance: E[X²] − E[X]²
  const varV = Math.max(0, cumPvSq / cumV - vwap * vwap);
  const sigma = Math.sqrt(varV);
  return {
    vwap,
    upper1: vwap + band1Mult * sigma,
    upper2: vwap + band2Mult * sigma,
    lower1: vwap - band1Mult * sigma,
    lower2: vwap - band2Mult * sigma,
  };
}

function positionRelativeTo(price: number, bands: DualVwapBands): DualVwapPosition {
  if (!Number.isFinite(bands.vwap)) return "at";
  if (price >= bands.upper2) return "far_above";
  if (price >= bands.upper1) return "above";
  if (price <= bands.lower2) return "far_below";
  if (price <= bands.lower1) return "below";
  return "at";
}

function dayIndex(ts: number, sessionStartHourUtc: number): number {
  return Math.floor((ts - sessionStartHourUtc * MS_PER_HOUR) / MS_PER_DAY);
}

export function computeDualVwap(input: DualVwapInput): DualVwapResult {
  const candles = input.candles;
  const rollingPeriod = input.rollingPeriod ?? DEFAULT_ROLLING;
  const band1 = input.band1Multiplier ?? DEFAULT_BAND_1;
  const band2 = input.band2Multiplier ?? DEFAULT_BAND_2;
  const divPct = input.divergencePct ?? DEFAULT_DIVERGENCE_PCT;
  const sessionHour = input.sessionStartHourUtc ?? 0;

  if (candles.length === 0) {
    return {
      session: { ...EMPTY_BANDS },
      rolling: { ...EMPTY_BANDS },
      sessionPosition: "at",
      rollingPosition: "at",
      divergence: 0,
      divergencePctValue: 0,
      divergenceSignificant: false,
      sampleSize: 0,
      reasoning: "no candles provided",
    };
  }

  const last = candles[candles.length - 1]!;
  const currentDay = dayIndex(last.timestamp, sessionHour);

  // Session VWAP: all candles whose day index equals currentDay.
  const sessionCandles: DualVwapCandle[] = [];
  for (const c of candles) {
    if (dayIndex(c.timestamp, sessionHour) === currentDay) sessionCandles.push(c);
  }
  const session = computeVwapWithBands(sessionCandles, band1, band2);

  // Rolling VWAP: last N bars regardless of day.
  const rollingCandles = candles.slice(-rollingPeriod);
  const rolling = computeVwapWithBands(rollingCandles, band1, band2);

  const price = last.close;
  const sessionPosition = positionRelativeTo(price, session);
  const rollingPosition = positionRelativeTo(price, rolling);

  const divergence =
    Number.isFinite(session.vwap) && Number.isFinite(rolling.vwap)
      ? session.vwap - rolling.vwap
      : 0;
  const divergencePctValue =
    Number.isFinite(rolling.vwap) && rolling.vwap !== 0 ? divergence / rolling.vwap : 0;
  const divergenceSignificant = Math.abs(divergencePctValue) >= divPct;

  const reasoning =
    Number.isFinite(session.vwap) && Number.isFinite(rolling.vwap)
      ? `session VWAP=${session.vwap.toFixed(6)} (${sessionPosition}), ` +
        `rolling(${rollingPeriod}) VWAP=${rolling.vwap.toFixed(6)} (${rollingPosition}), ` +
        `divergence=${(divergencePctValue * 100).toFixed(3)}%` +
        (divergenceSignificant ? " [significant]" : "")
      : "insufficient volume to compute VWAP";

  return {
    session,
    rolling,
    sessionPosition,
    rollingPosition,
    divergence,
    divergencePctValue,
    divergenceSignificant,
    sampleSize: candles.length,
    reasoning,
  };
}

export function dualVwapToPayload(result: DualVwapResult): Record<string, unknown> {
  return {
    kind: "dual_vwap.computed",
    sessionVwap: Number.isFinite(result.session.vwap)
      ? Number(result.session.vwap.toFixed(6))
      : null,
    rollingVwap: Number.isFinite(result.rolling.vwap)
      ? Number(result.rolling.vwap.toFixed(6))
      : null,
    sessionPosition: result.sessionPosition,
    rollingPosition: result.rollingPosition,
    divergencePct: Number((result.divergencePctValue * 100).toFixed(4)),
    divergenceSignificant: result.divergenceSignificant,
    sampleSize: result.sampleSize,
  };
}
