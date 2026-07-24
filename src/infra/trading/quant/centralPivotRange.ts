/**
 * Central Pivot Range — CPR (GORDON_CPR).
 *
 * Extension of standard daily pivots with three central lines plus the
 * usual R1-R3 / S1-S3 support/resistance grid:
 *
 *   CP = (prevHigh + prevLow + prevClose) / 3
 *   TC = (prevHigh + prevLow) / 2
 *   BC = (CP × 2) − TC
 *
 * Where TC and BC sandwich CP. CPR width (|TC − BC| / CP) is the
 * forward-looking day-mode predictor:
 *
 *   Narrow CPR (< narrowThreshold %) → trending day expected
 *   Wide   CPR (≥ narrowThreshold %) → range / mean-reversion day expected
 *
 * Crypto adaptation: defaults to UTC day boundaries (24/7 market, no
 * session gaps). Default narrow threshold tuned to crypto's higher
 * baseline volatility (0.3%) vs the equities convention (~0.1%).
 *
 * Pure compute. No I/O.
 */

export interface CprDailyOhlc {
  high: number;
  low: number;
  close: number;
}

export interface CprInput {
  /** Prior period's OHLC. Just H/L/C — open is not used by CPR. */
  prev: CprDailyOhlc;
  /** Current price for bias / zone classification. Optional. */
  currentPrice?: number;
  /** Width threshold below which CPR is classified "narrow". Default 0.003 (0.3%). */
  narrowThresholdPct?: number;
}

export type CprBias = "bullish" | "bearish" | "neutral";
export type CprMode = "narrow" | "wide";

export interface CprResult {
  centralPivot: number;
  topCentral: number;
  bottomCentral: number;
  r1: number;
  r2: number;
  r3: number;
  s1: number;
  s2: number;
  s3: number;
  widthAbsolute: number;
  widthPct: number;
  mode: CprMode;
  bias: CprBias;
  reasoning: string;
}

const DEFAULT_NARROW_PCT = 0.003;

export function computeCpr(input: CprInput): CprResult {
  const { high: h, low: l, close: c } = input.prev;
  if (!(h > 0) || !(l > 0) || !(c > 0)) {
    throw new Error("prev high/low/close must be positive numbers");
  }
  if (h < l) {
    throw new Error("prev.high must be ≥ prev.low");
  }

  const cp = (h + l + c) / 3;
  const tcRaw = (h + l) / 2;
  const bcRaw = cp * 2 - tcRaw;
  // TC must sit above BC; if the math inverts them (when prevClose is
  // far from the midpoint), swap so the band is well-defined.
  const tc = Math.max(tcRaw, bcRaw);
  const bc = Math.min(tcRaw, bcRaw);

  const r1 = 2 * cp - l;
  const r2 = cp + (h - l);
  const r3 = h + 2 * (cp - l);
  const s1 = 2 * cp - h;
  const s2 = cp - (h - l);
  const s3 = l - 2 * (h - cp);

  const widthAbsolute = tc - bc;
  const widthPct = cp > 0 ? widthAbsolute / cp : 0;

  const narrowPct = input.narrowThresholdPct ?? DEFAULT_NARROW_PCT;
  const mode: CprMode = widthPct < narrowPct ? "narrow" : "wide";

  let bias: CprBias = "neutral";
  if (input.currentPrice !== undefined && Number.isFinite(input.currentPrice)) {
    const p = input.currentPrice;
    if (p > tc) bias = "bullish";
    else if (p < bc) bias = "bearish";
    else bias = "neutral";
  }

  const reasoning =
    `CPR width ${(widthPct * 100).toFixed(3)}% → ${mode} (threshold ${(narrowPct * 100).toFixed(2)}%); ` +
    `CP=${cp.toFixed(4)}, TC=${tc.toFixed(4)}, BC=${bc.toFixed(4)}; bias=${bias}`;

  return {
    centralPivot: cp,
    topCentral: tc,
    bottomCentral: bc,
    r1, r2, r3, s1, s2, s3,
    widthAbsolute,
    widthPct,
    mode,
    bias,
    reasoning,
  };
}

export function cprToPayload(result: CprResult): Record<string, unknown> {
  return {
    kind: "cpr.computed",
    cp: Number(result.centralPivot.toFixed(6)),
    tc: Number(result.topCentral.toFixed(6)),
    bc: Number(result.bottomCentral.toFixed(6)),
    widthPct: Number((result.widthPct * 100).toFixed(4)),
    mode: result.mode,
    bias: result.bias,
  };
}
