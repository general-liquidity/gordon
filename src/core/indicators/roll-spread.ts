import type { Candle } from "./types.ts";

export interface RollSpreadResult {
  rollSpread: number; // absolute price units
  rollSpreadPct: number; // as % of mean close
  corwinSchultzSpread: number; // fractional spread, e.g. 0.012 = 1.2%
  window: number;
  interpretation: string;
}

const NEUTRAL = (window: number, note: string): RollSpreadResult => ({
  rollSpread: 0,
  rollSpreadPct: 0,
  corwinSchultzSpread: 0,
  window,
  interpretation: note,
});

const r6 = (n: number): number => Number(n.toFixed(6));

/**
 * Effective bid-ask spread estimators from OHLC (no quote data).
 *  - Roll (1984): 2·sqrt(−cov(Δp_t, Δp_{t-1})); undefined (→0) when cov ≥ 0.
 *  - Corwin-Schultz (2012): high-low spread from consecutive 2-day H/L.
 */
export function calculateRollSpread(
  candles: Candle[],
  opts?: { window?: number },
): RollSpreadResult {
  if (candles == null || candles.length < 3) {
    return NEUTRAL(0, "Insufficient data: need at least 3 candles");
  }

  const requested = opts?.window;
  const window =
    requested == null || requested >= candles.length
      ? candles.length
      : Math.max(3, requested);
  const slice = candles.slice(candles.length - window);

  // --- Roll (1984) ---
  const closes = slice.map((c) => c.close);
  const meanClose =
    closes.reduce((sum, c) => sum + c, 0) / closes.length;

  const deltas: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    deltas.push(closes[i]! - closes[i - 1]!);
  }

  let rollSpread = 0;
  let rollNote = "Roll: positive serial covariance — estimator undefined";
  if (deltas.length >= 2) {
    // cov(Δp_t, Δp_{t-1}) over adjacent delta pairs
    const x: number[] = [];
    const y: number[] = [];
    for (let i = 1; i < deltas.length; i++) {
      x.push(deltas[i]!);
      y.push(deltas[i - 1]!);
    }
    const meanX = x.reduce((s, v) => s + v, 0) / x.length;
    const meanY = y.reduce((s, v) => s + v, 0) / y.length;
    let cov = 0;
    for (let i = 0; i < x.length; i++) {
      cov += (x[i]! - meanX) * (y[i]! - meanY);
    }
    cov /= x.length;

    if (cov < 0) {
      rollSpread = 2 * Math.sqrt(-cov);
      rollNote = "Roll: negative serial covariance — effective spread estimated";
    }
  }

  const rollSpreadPct = meanClose > 0 ? (rollSpread / meanClose) * 100 : 0;

  // --- Corwin-Schultz (2012) ---
  const k = 3 - 2 * Math.sqrt(2);
  const csSpreads: number[] = [];
  for (let t = 1; t < slice.length; t++) {
    const cur = slice[t]!;
    const prev = slice[t - 1]!;
    if (cur.high <= 0 || cur.low <= 0 || prev.high <= 0 || prev.low <= 0) {
      continue;
    }
    const beta =
      Math.log(cur.high / cur.low) ** 2 +
      Math.log(prev.high / prev.low) ** 2;
    const hiMax = Math.max(cur.high, prev.high);
    const loMin = Math.min(cur.low, prev.low);
    const gamma = Math.log(hiMax / loMin) ** 2;

    const alpha =
      (Math.sqrt(2 * beta) - Math.sqrt(beta)) / k - Math.sqrt(gamma / k);
    const eAlpha = Math.exp(alpha);
    const s = (2 * (eAlpha - 1)) / (1 + eAlpha);
    csSpreads.push(s < 0 ? 0 : s);
  }

  const corwinSchultzSpread =
    csSpreads.length > 0
      ? csSpreads.reduce((sum, v) => sum + v, 0) / csSpreads.length
      : 0;

  const interpretation = `${rollNote}. Corwin-Schultz mean spread ${(corwinSchultzSpread * 100).toFixed(2)}% over ${window} bars`;

  return {
    rollSpread: r6(rollSpread),
    rollSpreadPct: r6(rollSpreadPct),
    corwinSchultzSpread: r6(corwinSchultzSpread),
    window,
    interpretation,
  };
}
