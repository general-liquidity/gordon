/**
 * Leledc Exhaustion Bars → support/resistance levels.
 *
 * Canonical price-action exhaustion detector (Glaz / InSilico "Leledc levels").
 * Two directional counters track momentum (close vs close[4]); when momentum has
 * run long enough AND a reversal candle prints AT a range extreme, that bar is an
 * exhaustion bar and its extreme becomes a support/resistance level:
 *
 *   bindex += 1 when close > close[4];  sindex += 1 when close < close[4]
 *   bearish exhaustion (resistance): bindex > qual AND close < open AND high = highest(high, len)
 *   bullish exhaustion (support):    sindex > qual AND close > open AND low  = lowest(low,  len)
 *
 * Major (qual 6 / len 30) and minor (qual 5 / len 5) tiers run on independent
 * counters. Distinct from Gordon's volume/orderflow/streak exhaustion detectors —
 * this is pure price-action bar-counting. Pure; never throws.
 */

export interface LeledcCandle {
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface LeledcInput {
  candles: LeledcCandle[];
  majQual?: number;
  majLen?: number;
  minQual?: number;
  minLen?: number;
}

export interface LeledcSignal {
  index: number;
  tier: "major" | "minor";
  side: "top" | "bottom";
  /** The S/R level (bar high for a top / resistance, bar low for a bottom / support). */
  level: number;
}

export interface LeledcResult {
  signals: LeledcSignal[];
  majorResistance: number | null;
  majorSupport: number | null;
  minorResistance: number | null;
  minorSupport: number | null;
  latestIsExhaustion: boolean;
  latestSignal: LeledcSignal | null;
  bindexMajor: number;
  sindexMajor: number;
  interpretation: string;
}

export function computeLeledcExhaustion(input: LeledcInput): LeledcResult {
  const c = input.candles;
  const majQual = Math.max(1, Math.floor(input.majQual ?? 6));
  const majLen = Math.max(2, Math.floor(input.majLen ?? 30));
  const minQual = Math.max(1, Math.floor(input.minQual ?? 5));
  const minLen = Math.max(2, Math.floor(input.minLen ?? 5));
  const n = c.length;

  const neutral: LeledcResult = {
    signals: [],
    majorResistance: null,
    majorSupport: null,
    minorResistance: null,
    minorSupport: null,
    latestIsExhaustion: false,
    latestSignal: null,
    bindexMajor: 0,
    sindexMajor: 0,
    interpretation: "insufficient data for Leledc exhaustion",
  };
  if (n < 5) return neutral;

  const highestHigh = (i: number, len: number): number => {
    let h = -Infinity;
    for (let k = Math.max(0, i - len + 1); k <= i; k++) if (c[k]!.high > h) h = c[k]!.high;
    return h;
  };
  const lowestLow = (i: number, len: number): number => {
    let l = Infinity;
    for (let k = Math.max(0, i - len + 1); k <= i; k++) if (c[k]!.low < l) l = c[k]!.low;
    return l;
  };

  let bMaj = 0;
  let sMaj = 0;
  let bMin = 0;
  let sMin = 0;
  const signals: LeledcSignal[] = [];

  for (let i = 0; i < n; i++) {
    if (i >= 4) {
      if (c[i]!.close > c[i - 4]!.close) {
        bMaj += 1;
        bMin += 1;
      }
      if (c[i]!.close < c[i - 4]!.close) {
        sMaj += 1;
        sMin += 1;
      }
    }
    const bear = c[i]!.close < c[i]!.open;
    const bull = c[i]!.close > c[i]!.open;

    // Major tier.
    if (i >= majLen - 1) {
      if (bMaj > majQual && bear && c[i]!.high >= highestHigh(i, majLen)) {
        bMaj = 0;
        signals.push({ index: i, tier: "major", side: "top", level: c[i]!.high });
      }
      if (sMaj > majQual && bull && c[i]!.low <= lowestLow(i, majLen)) {
        sMaj = 0;
        signals.push({ index: i, tier: "major", side: "bottom", level: c[i]!.low });
      }
    }
    // Minor tier.
    if (i >= minLen - 1) {
      if (bMin > minQual && bear && c[i]!.high >= highestHigh(i, minLen)) {
        bMin = 0;
        signals.push({ index: i, tier: "minor", side: "top", level: c[i]!.high });
      }
      if (sMin > minQual && bull && c[i]!.low <= lowestLow(i, minLen)) {
        sMin = 0;
        signals.push({ index: i, tier: "minor", side: "bottom", level: c[i]!.low });
      }
    }
  }

  const lastOf = (tier: "major" | "minor", side: "top" | "bottom"): number | null => {
    for (let k = signals.length - 1; k >= 0; k--) {
      if (signals[k]!.tier === tier && signals[k]!.side === side) return signals[k]!.level;
    }
    return null;
  };

  const latestSignal = signals.length > 0 ? signals[signals.length - 1]! : null;
  const latestIsExhaustion = latestSignal !== null && latestSignal.index === n - 1;

  const majorResistance = lastOf("major", "top");
  const majorSupport = lastOf("major", "bottom");

  const interpretation =
    signals.length === 0
      ? `no exhaustion bars (bindex ${bMaj}, sindex ${sMaj})`
      : `${signals.length} exhaustion bar(s); latest ${latestSignal!.tier} ${latestSignal!.side} @ ${latestSignal!.level}` +
        (latestIsExhaustion ? " (THIS bar)" : "") +
        (majorResistance !== null ? `; major resistance ${majorResistance}` : "") +
        (majorSupport !== null ? `; major support ${majorSupport}` : "");

  return {
    signals,
    majorResistance,
    majorSupport,
    minorResistance: lastOf("minor", "top"),
    minorSupport: lastOf("minor", "bottom"),
    latestIsExhaustion,
    latestSignal,
    bindexMajor: bMaj,
    sindexMajor: sMaj,
    interpretation,
  };
}
