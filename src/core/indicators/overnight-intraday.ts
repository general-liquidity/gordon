/**
 * Overnight / intraday return decomposition.
 *
 * Splits a price series into its two legs and cumulates each separately:
 *   - overnight return for bar t:  open_t / close_{t-1} − 1   (the gap)
 *   - intraday return for bar t:    close_t / open_t   − 1     (the session)
 *
 * Two uses in one primitive: (1) the well-documented *overnight premium*
 * anomaly (historically most of the drift is overnight, not intraday); (2) the
 * Knuteson "Strikingly Suspicious Overnight and Intraday Returns" forensic
 * signature — a strongly POSITIVE cumulative overnight leg paired with a
 * strongly NEGATIVE cumulative intraday leg is the mechanical "buy-high-at-open,
 * sell-low-at-close" tell. Distinct from intraday-momentum (Gao-Han-Li-Zhou
 * close-from-open prediction) and from asymmetric up/down beta. Pure.
 */

import { mean as statsMean, populationStd } from "../stats/index.ts";

/** Minimal candle shape — only the open/close legs are needed. */
export type OHLCBar = { open: number; close: number };

export interface OvernightIntradayResult {
  cumulativeOvernightReturnPct: number;
  cumulativeIntradayReturnPct: number;
  cumulativeTotalReturnPct: number;
  meanOvernightReturnPct: number;
  meanIntradayReturnPct: number;
  overnightVolPct: number;
  intradayVolPct: number;
  /** Which leg carries the cumulative drift. */
  divergence: "overnight_premium" | "intraday_premium" | "balanced";
  /** Knuteson buy-high-sell-low signature: overnight strongly + AND intraday strongly −. */
  suspiciousSignature: boolean;
  bars: number;
  interpretation: string;
}

export interface OvernightIntradayInput {
  /** |cumulative leg| beyond which a divergence counts as "strong" (default 10%). */
  suspiciousThresholdPct?: number;
}

const round = (x: number, p = 4): number => parseFloat(x.toFixed(p));

function meanStd(xs: number[]): { mean: number; std: number } {
  return { mean: statsMean(xs), std: populationStd(xs) };
}

export function calculateOvernightIntraday(
  candles: ReadonlyArray<OHLCBar>,
  input: OvernightIntradayInput = {},
): OvernightIntradayResult {
  const threshold = input.suspiciousThresholdPct ?? 10;
  const empty: OvernightIntradayResult = {
    cumulativeOvernightReturnPct: 0,
    cumulativeIntradayReturnPct: 0,
    cumulativeTotalReturnPct: 0,
    meanOvernightReturnPct: 0,
    meanIntradayReturnPct: 0,
    overnightVolPct: 0,
    intradayVolPct: 0,
    divergence: "balanced",
    suspiciousSignature: false,
    bars: 0,
    interpretation: "insufficient data — need ≥ 2 candles with open/close",
  };
  if (candles.length < 2) return empty;

  const overnight: number[] = [];
  const intraday: number[] = [];
  let cumOn = 1;
  let cumId = 1;
  for (let i = 1; i < candles.length; i++) {
    const prevClose = candles[i - 1]!.close;
    const open = candles[i]!.open;
    const close = candles[i]!.close;
    if (!(prevClose > 0) || !(open > 0)) continue;
    const onR = open / prevClose - 1;
    const idR = close / open - 1;
    overnight.push(onR);
    intraday.push(idR);
    cumOn *= 1 + onR;
    cumId *= 1 + idR;
  }
  if (overnight.length === 0) return empty;

  const cumOnPct = (cumOn - 1) * 100;
  const cumIdPct = (cumId - 1) * 100;
  const cumTotalPct = (cumOn * cumId - 1) * 100;
  const on = meanStd(overnight);
  const id = meanStd(intraday);

  const divergence: OvernightIntradayResult["divergence"] =
    cumOnPct > 0 && cumIdPct < 0
      ? "overnight_premium"
      : cumIdPct > 0 && cumOnPct < 0
        ? "intraday_premium"
        : "balanced";
  const suspiciousSignature = cumOnPct >= threshold && cumIdPct <= -threshold;

  const interpretation = suspiciousSignature
    ? `SUSPICIOUS: cumulative overnight +${round(cumOnPct, 1)}% vs intraday ${round(cumIdPct, 1)}% — the buy-high-at-open/sell-low-at-close signature (Knuteson)`
    : divergence === "overnight_premium"
      ? `overnight premium: drift is overnight (+${round(cumOnPct, 1)}%) not intraday (${round(cumIdPct, 1)}%)`
      : divergence === "intraday_premium"
        ? `intraday premium: drift is intraday (+${round(cumIdPct, 1)}%) not overnight (${round(cumOnPct, 1)}%)`
        : `balanced: overnight ${round(cumOnPct, 1)}% / intraday ${round(cumIdPct, 1)}%`;

  return {
    cumulativeOvernightReturnPct: round(cumOnPct, 3),
    cumulativeIntradayReturnPct: round(cumIdPct, 3),
    cumulativeTotalReturnPct: round(cumTotalPct, 3),
    meanOvernightReturnPct: round(on.mean * 100, 4),
    meanIntradayReturnPct: round(id.mean * 100, 4),
    overnightVolPct: round(on.std * 100, 4),
    intradayVolPct: round(id.std * 100, 4),
    divergence,
    suspiciousSignature,
    bars: overnight.length,
    interpretation,
  };
}
