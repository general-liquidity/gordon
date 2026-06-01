/**
 * Volume Signature Suite — Morales-Kacher / CAN SLIM / TAPLOT pocket-pivot
 * family.
 *
 * Classifies each bar's volume footprint against a moving average-volume
 * baseline and the prior-bar close. One cohesive module, one main function,
 * because every classifier shares the same SMA(volume, avgPeriod) baseline —
 * computing it once is the whole point.
 *
 * Per-bar tags (all aligned to the input series, null/false warmup before the
 * avg-volume window is available):
 *  - pocket pivot (PP10 / PP5): up day whose volume exceeds the MAXIMUM
 *    down-day volume over the prior N days. The Gil Morales / Chris Kacher
 *    signature of institutional accumulation inside a base.
 *  - volume dry-up (2 levels): bar volume far below average — the "VDU" /
 *    "voodoo" low-volume pullback that precedes a pocket pivot.
 *  - accumulation day: up day, close in the upper part of the range, on
 *    above-average volume. O'Neil's institutional-footprint signature.
 *  - distribution day: down day, weak close, on heavy volume. The trailing
 *    count over distCountWindow is the CAN SLIM market-health gauge
 *    (amber at 4, red at 6).
 *  - churn / stalling: up day on heavy volume that makes almost no net
 *    price progress vs ATR — supply absorbing demand near a top.
 *
 * Pure function. No I/O.
 */

import type { Candle } from "./types.ts";

export interface VolumeSignatureParams {
  /** SMA period for the average-volume baseline. Default 50. */
  avgPeriod?: number;
  /** Pocket-pivot long lookback (max down-volume window). Default 10. */
  ppLong?: number;
  /** Pocket-pivot short lookback. Default 5. */
  ppShort?: number;
  /** Dry-up level-1 fraction below average. Default 0.45 (vol < avg*0.55). */
  dryUp1Pct?: number;
  /** Dry-up level-2 fraction below average. Default 0.60 (vol < avg*0.40). */
  dryUp2Pct?: number;
  /** Close-position threshold for "upper part of range". Default 0.62.
   *  Accumulation needs closePosition >= this; distribution needs
   *  closePosition <= (1 - this). */
  closeUpperPct?: number;
  /** Accumulation volume multiple of average. Default 1.25. */
  accVolMult?: number;
  /** Distribution volume multiple of average. Default 1.0. */
  distVolMult?: number;
  /** Trailing window for the distribution-day count. Default 25. */
  distCountWindow?: number;
  /** Churn volume multiple of average. Default 1.25. */
  churnVolMult?: number;
  /** ATR period for the churn net-progress test. Default 14. */
  atrPeriod?: number;
  /** Max |close - priorClose| / ATR for a bar to count as churn. Default 0.25. */
  maxProgressVsAtr?: number;
}

export interface VolumeSignatureLatest {
  /** Index of the latest bar (n - 1), or null on empty input. */
  index: number | null;
  /** Tags that fired on the latest bar. */
  pp10: boolean;
  pp5: boolean;
  dryUp1: boolean;
  dryUp2: boolean;
  accumulation: boolean;
  distribution: boolean;
  churn: boolean;
  /** Latest bar's volume as a multiple of average volume, or null in warmup. */
  volumeMultiple: number | null;
  /** Latest bar's close position in its range (0 = at low, 1 = at high), or null. */
  closePosition: number | null;
}

export interface VolumeSignatureResult {
  /** Pocket pivot, long lookback (PP10). The stronger tag. */
  pp10: boolean[];
  /** Pocket pivot, short lookback (PP5). */
  pp5: boolean[];
  /** Volume dry-up level 1 (vol below avg by dryUp1Pct). */
  dryUp1: boolean[];
  /** Volume dry-up level 2 (deeper — vol below avg by dryUp2Pct). */
  dryUp2: boolean[];
  /** Accumulation day. */
  accumulation: boolean[];
  /** Distribution day. */
  distribution: boolean[];
  /** Churn / stalling day. */
  churn: boolean[];
  /** SMA(volume, avgPeriod), null until the window is available. */
  avgVolume: (number | null)[];
  /** ATR(atrPeriod), null until the window is available. */
  atr: (number | null)[];
  /** Trailing distribution-day count over the last distCountWindow bars. */
  distributionCount: number;
  /** Health verdict from the distribution count. */
  distributionVerdict: "healthy" | "amber" | "red";
  /** Summary of which tags fired on the latest bar. */
  latest: VolumeSignatureLatest;
  /** Human-readable summary. */
  interpretation: string;
}

const DEFAULTS = {
  avgPeriod: 50,
  ppLong: 10,
  ppShort: 5,
  dryUp1Pct: 0.45,
  dryUp2Pct: 0.6,
  closeUpperPct: 0.62,
  accVolMult: 1.25,
  distVolMult: 1.0,
  distCountWindow: 25,
  churnVolMult: 1.25,
  atrPeriod: 14,
  maxProgressVsAtr: 0.25,
};

/** Close position within the bar range: 0 = at the low, 1 = at the high.
 *  Doji / zero-range bars are treated as mid (0.5). */
function closePositionOf(c: Candle): number {
  const range = c.high - c.low;
  if (!(range > 0)) return 0.5;
  return (c.close - c.low) / range;
}

/** SMA of volume aligned to candle indices, null until `period` bars exist. */
function smaVolume(candles: Candle[], period: number): (number | null)[] {
  const n = candles.length;
  const out: (number | null)[] = new Array(n).fill(null);
  if (period < 1 || n < period) return out;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum = sum + (candles[i]!.volume ?? 0);
    if (i >= period) sum = sum - (candles[i - period]!.volume ?? 0);
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Wilder ATR aligned to candle indices, null until `period` TRs exist
 *  (i.e. null for indices 0..period). */
function atrAligned(candles: Candle[], period: number): (number | null)[] {
  const n = candles.length;
  const out: (number | null)[] = new Array(n).fill(null);
  if (period < 1 || n < period + 1) return out;
  const tr: number[] = [];
  for (let i = 1; i < n; i++) {
    const c = candles[i]!;
    const prev = candles[i - 1]!;
    const hl = c.high - c.low;
    const hc = Math.abs(c.high - prev.close);
    const lc = Math.abs(c.low - prev.close);
    tr.push(Math.max(hl, hc, lc));
  }
  // tr[k] corresponds to candle index k+1. First ATR at candle index `period`.
  let atr = 0;
  for (let k = 0; k < period; k++) atr = atr + tr[k]!;
  atr = atr / period;
  out[period] = atr;
  for (let k = period; k < tr.length; k++) {
    atr = (atr * (period - 1) + tr[k]!) / period;
    out[k + 1] = atr;
  }
  return out;
}

export function calculateVolumeSignature(
  candles: Candle[],
  params: VolumeSignatureParams = {},
): VolumeSignatureResult {
  const avgPeriod = params.avgPeriod ?? DEFAULTS.avgPeriod;
  const ppLong = params.ppLong ?? DEFAULTS.ppLong;
  const ppShort = params.ppShort ?? DEFAULTS.ppShort;
  const dryUp1Pct = params.dryUp1Pct ?? DEFAULTS.dryUp1Pct;
  const dryUp2Pct = params.dryUp2Pct ?? DEFAULTS.dryUp2Pct;
  const closeUpperPct = params.closeUpperPct ?? DEFAULTS.closeUpperPct;
  const accVolMult = params.accVolMult ?? DEFAULTS.accVolMult;
  const distVolMult = params.distVolMult ?? DEFAULTS.distVolMult;
  const distCountWindow = params.distCountWindow ?? DEFAULTS.distCountWindow;
  const churnVolMult = params.churnVolMult ?? DEFAULTS.churnVolMult;
  const atrPeriod = params.atrPeriod ?? DEFAULTS.atrPeriod;
  const maxProgressVsAtr = params.maxProgressVsAtr ?? DEFAULTS.maxProgressVsAtr;

  const n = candles.length;
  const pp10 = new Array<boolean>(n).fill(false);
  const pp5 = new Array<boolean>(n).fill(false);
  const dryUp1 = new Array<boolean>(n).fill(false);
  const dryUp2 = new Array<boolean>(n).fill(false);
  const accumulation = new Array<boolean>(n).fill(false);
  const distribution = new Array<boolean>(n).fill(false);
  const churn = new Array<boolean>(n).fill(false);

  const avgVolume = smaVolume(candles, avgPeriod);
  const atr = atrAligned(candles, atrPeriod);

  const emptyLatest: VolumeSignatureLatest = {
    index: null,
    pp10: false,
    pp5: false,
    dryUp1: false,
    dryUp2: false,
    accumulation: false,
    distribution: false,
    churn: false,
    volumeMultiple: null,
    closePosition: null,
  };

  if (n === 0) {
    return {
      pp10,
      pp5,
      dryUp1,
      dryUp2,
      accumulation,
      distribution,
      churn,
      avgVolume,
      atr,
      distributionCount: 0,
      distributionVerdict: "healthy",
      latest: emptyLatest,
      interpretation: "No candles — nothing to evaluate.",
    };
  }

  const dryUp1Mult = 1 - dryUp1Pct;
  const dryUp2Mult = 1 - dryUp2Pct;
  const distLowerThreshold = 1 - closeUpperPct;

  for (let i = 0; i < n; i++) {
    const c = candles[i]!;
    const vol = c.volume ?? 0;
    const avg = avgVolume[i];
    const isUp = i > 0 && c.close > candles[i - 1]!.close;
    const isDown = i > 0 && c.close < candles[i - 1]!.close;
    const cp = closePositionOf(c);

    // Dry-up needs only the avg baseline.
    if (avg != null && avg > 0) {
      if (vol < avg * dryUp1Mult) dryUp1[i] = true;
      if (vol < avg * dryUp2Mult) dryUp2[i] = true;

      // Accumulation: up day, upper-range close, above-average volume.
      if (isUp && cp >= closeUpperPct && vol >= avg * accVolMult) {
        accumulation[i] = true;
      }
      // Distribution: down day, weak close, heavy volume.
      if (isDown && cp <= distLowerThreshold && vol >= avg * distVolMult) {
        distribution[i] = true;
      }
      // Churn: up day, heavy volume, tiny net progress vs ATR.
      const a = atr[i];
      if (isUp && vol >= avg * churnVolMult && a != null && a > 0) {
        const progress = Math.abs(c.close - candles[i - 1]!.close) / a;
        if (progress < maxProgressVsAtr) churn[i] = true;
      }
    }

    // Pocket pivot: up day whose volume exceeds the MAX down-day volume over
    // the prior N days. Needs at least one prior bar to define up/down.
    if (isUp) {
      pp10[i] = exceedsPriorMaxDownVolume(candles, i, ppLong, vol);
      pp5[i] = exceedsPriorMaxDownVolume(candles, i, ppShort, vol);
    }
  }

  // Trailing distribution count over the last distCountWindow bars.
  const countStart = Math.max(0, n - distCountWindow);
  let distributionCount = 0;
  for (let i = countStart; i < n; i++) {
    if (distribution[i]) distributionCount = distributionCount + 1;
  }
  const distributionVerdict: "healthy" | "amber" | "red" =
    distributionCount >= 6 ? "red" : distributionCount >= 4 ? "amber" : "healthy";

  const lastIdx = n - 1;
  const lastAvg = avgVolume[lastIdx];
  const lastVol = candles[lastIdx]!.volume ?? 0;
  const latest: VolumeSignatureLatest = {
    index: lastIdx,
    pp10: pp10[lastIdx]!,
    pp5: pp5[lastIdx]!,
    dryUp1: dryUp1[lastIdx]!,
    dryUp2: dryUp2[lastIdx]!,
    accumulation: accumulation[lastIdx]!,
    distribution: distribution[lastIdx]!,
    churn: churn[lastIdx]!,
    volumeMultiple:
      lastAvg != null && lastAvg > 0 ? parseFloat((lastVol / lastAvg).toFixed(2)) : null,
    closePosition: parseFloat(closePositionOf(candles[lastIdx]!).toFixed(2)),
  };

  const interpretation = buildInterpretation(
    latest,
    distributionCount,
    distributionVerdict,
    distCountWindow,
    avgVolume[lastIdx] != null,
  );

  return {
    pp10,
    pp5,
    dryUp1,
    dryUp2,
    accumulation,
    distribution,
    churn,
    avgVolume,
    atr,
    distributionCount,
    distributionVerdict,
    latest,
    interpretation,
  };
}

/** True when bar `i` (an up day) has volume exceeding the maximum DOWN-day
 *  volume over the prior `lookback` bars (i-lookback .. i-1). If there were no
 *  down days in the window, any up-day volume qualifies (no down-volume wall
 *  to clear — the classic "first pocket pivot off the low" case). */
function exceedsPriorMaxDownVolume(
  candles: Candle[],
  i: number,
  lookback: number,
  upVolume: number,
): boolean {
  if (i < 1) return false;
  const start = Math.max(1, i - lookback);
  let maxDownVol = 0;
  let sawDownDay = false;
  for (let j = start; j < i; j++) {
    const cj = candles[j]!;
    if (cj.close < candles[j - 1]!.close) {
      sawDownDay = true;
      const v = cj.volume ?? 0;
      if (v > maxDownVol) maxDownVol = v;
    }
  }
  if (!sawDownDay) return upVolume > 0;
  return upVolume > maxDownVol;
}

function buildInterpretation(
  latest: VolumeSignatureLatest,
  distributionCount: number,
  verdict: "healthy" | "amber" | "red",
  window: number,
  hasBaseline: boolean,
): string {
  if (!hasBaseline) {
    return "Insufficient data — average-volume window not yet available.";
  }
  const tags: string[] = [];
  if (latest.pp10) tags.push("POCKET PIVOT (PP10 — strong)");
  else if (latest.pp5) tags.push("pocket pivot (PP5)");
  if (latest.accumulation) tags.push("accumulation");
  if (latest.distribution) tags.push("distribution");
  if (latest.churn) tags.push("churn/stalling");
  if (latest.dryUp2) tags.push("volume dry-up (deep)");
  else if (latest.dryUp1) tags.push("volume dry-up");

  const tagStr = tags.length > 0 ? tags.join(", ") : "no volume signature";
  const volStr =
    latest.volumeMultiple != null ? ` Volume ${latest.volumeMultiple.toFixed(2)}× avg.` : "";

  const verdictStr =
    verdict === "red"
      ? `RED: ${distributionCount} distribution days in the last ${window} — institutions selling, defensive posture.`
      : verdict === "amber"
        ? `AMBER: ${distributionCount} distribution days in the last ${window} — watch for further selling.`
        : `Healthy: ${distributionCount} distribution day(s) in the last ${window}.`;

  return `Latest bar: ${tagStr}.${volStr} ${verdictStr}`;
}
