/**
 * Ichimoku Signals (CryptoCred lesson — the FIVE strategies the base ichimoku.ts omits)
 * Complements (does NOT duplicate) ichimoku.ts, which already emits TK cross + price-vs-cloud.
 * Self-contained: computes Tenkan/Kijun/Senkou A/B internally (no import from ichimoku.ts).
 *   1. kijunCross    — close crossing the Kijun on the last bar (momentum trigger).
 *   2. kijunPosition — close vs Kijun as dynamic support/resistance.
 *   3. kijunBounce   — price tested the Kijun and resumed in the trend direction.
 *   4. kumoTwist     — FUTURE cloud color change (Senkou A crossing Senkou B).
 *   5. edgeToEdge    — flat-Kumo edge-to-edge target trade; price inside a flat cloud.
 *   + tkDisequilibrium — Tenkan-Kijun gap as an overextension/mean-reversion signal.
 */

import type { Candle } from "./types.ts";

export interface IchimokuSignalsResult {
  kijunCross: "bullish" | "bearish" | "none";
  kijunPosition: "above" | "below" | "at";
  kijunBounce: boolean;
  kumoTwist: "bullish" | "bearish" | "none";
  edgeToEdge: { active: boolean; flatKumo: boolean; target: number | null };
  tkDisequilibrium: {
    gap: number;
    stretchPct: number;
    state: "overextended_bull" | "overextended_bear" | "neutral";
  };
  currentClose: number | null;
  tenkan: number | null;
  kijun: number | null;
  interpretation: string;
}

function neutralResult(): IchimokuSignalsResult {
  return {
    kijunCross: "none",
    kijunPosition: "at",
    kijunBounce: false,
    kumoTwist: "none",
    edgeToEdge: { active: false, flatKumo: false, target: null },
    tkDisequilibrium: { gap: 0, stretchPct: 0, state: "neutral" },
    currentClose: null,
    tenkan: null,
    kijun: null,
    interpretation: "Insufficient data for Ichimoku signals",
  };
}

function rollingHigh(candles: Candle[], period: number, index: number): number | null {
  if (index < period - 1) return null;
  let max = -Infinity;
  for (let i = index - period + 1; i <= index; i++) {
    const h = candles[i]!.high;
    if (h > max) max = h;
  }
  return max;
}

function rollingLow(candles: Candle[], period: number, index: number): number | null {
  if (index < period - 1) return null;
  let min = Infinity;
  for (let i = index - period + 1; i <= index; i++) {
    const l = candles[i]!.low;
    if (l < min) min = l;
  }
  return min;
}

function midChannel(candles: Candle[], period: number, index: number): number | null {
  const hi = rollingHigh(candles, period, index);
  const lo = rollingLow(candles, period, index);
  if (hi == null || lo == null) return null;
  return (hi + lo) / 2;
}

function round(x: number, n: number): number {
  return parseFloat(x.toFixed(n));
}

/**
 * Calculate the five Ichimoku signals not covered by ichimoku.ts.
 *
 * @param candles - OHLCV candle array
 * @param opts - period overrides (tenkan 9 / kijun 26 / senkouB 52 / displacement 26)
 * @returns IchimokuSignalsResult — always well-formed; neutral on insufficient data
 */
export function calculateIchimokuSignals(
  candles: Candle[],
  opts?: {
    tenkanPeriod?: number;
    kijunPeriod?: number;
    senkouBPeriod?: number;
    displacement?: number;
  }
): IchimokuSignalsResult {
  const tenkanPeriod = opts?.tenkanPeriod ?? 9;
  const kijunPeriod = opts?.kijunPeriod ?? 26;
  const senkouBPeriod = opts?.senkouBPeriod ?? 52;
  const displacement = opts?.displacement ?? 26;

  if (candles.length < senkouBPeriod + displacement + 2) {
    return neutralResult();
  }

  const lastIdx = candles.length - 1;
  const prevIdx = lastIdx - 1;
  const close = candles[lastIdx]!.close;
  const prevClose = candles[prevIdx]!.close;

  const tenkan = midChannel(candles, tenkanPeriod, lastIdx);
  const kijun = midChannel(candles, kijunPeriod, lastIdx);
  const prevKijun = midChannel(candles, kijunPeriod, prevIdx);

  // ---- 1. kijunCross: close crossing the Kijun on the last bar ----
  let kijunCross: "bullish" | "bearish" | "none" = "none";
  if (kijun != null && prevKijun != null) {
    if (prevClose <= prevKijun && close > kijun) kijunCross = "bullish";
    else if (prevClose >= prevKijun && close < kijun) kijunCross = "bearish";
  }

  // ---- 2. kijunPosition: close vs current Kijun ----
  let kijunPosition: "above" | "below" | "at" = "at";
  if (kijun != null) {
    if (close > kijun) kijunPosition = "above";
    else if (close < kijun) kijunPosition = "below";
  }

  // ---- 3. kijunBounce: price tested the Kijun within the last few bars and resumed in trend ----
  // Prevailing direction = current close vs current Kijun. A bounce requires a recent bar whose
  // low (uptrend) / high (downtrend) reached within a small band of the Kijun, with close back on
  // the trend side on the last bar.
  let kijunBounce = false;
  if (kijun != null && kijunPosition !== "at") {
    const band = Math.abs(kijun) * 0.005; // 0.5% band around the Kijun
    const lookback = 4;
    const start = Math.max(0, lastIdx - lookback);
    for (let i = start; i <= lastIdx; i++) {
      const k = midChannel(candles, kijunPeriod, i);
      if (k == null) continue;
      const c = candles[i]!;
      if (kijunPosition === "above") {
        // uptrend: a wick dipped to/below the Kijun (tested it) then recovered
        if (c.low <= k + band && c.low >= k - band * 3) {
          kijunBounce = true;
          break;
        }
      } else {
        // downtrend: a wick spiked to/above the Kijun then rejected
        if (c.high >= k - band && c.high <= k + band * 3) {
          kijunBounce = true;
          break;
        }
      }
    }
    // confirm price closed back on the trend side on the last bar
    if (kijunBounce) {
      if (kijunPosition === "above" && close <= kijun) kijunBounce = false;
      if (kijunPosition === "below" && close >= kijun) kijunBounce = false;
    }
  }

  // ---- 4. kumoTwist: future cloud color change (Senkou A crossing Senkou B) ----
  // Senkou A = (Tenkan + Kijun)/2, Senkou B = (senkouB-period high+low)/2; both computed at the
  // anchor bar and projected +displacement. Compare the most recent projected cloud value to the
  // prior one to detect the twist.
  const senkouAAt = (idx: number): number | null => {
    const t = midChannel(candles, tenkanPeriod, idx);
    const k = midChannel(candles, kijunPeriod, idx);
    if (t == null || k == null) return null;
    return (t + k) / 2;
  };
  const senkouBAt = (idx: number): number | null => midChannel(candles, senkouBPeriod, idx);

  const saNow = senkouAAt(lastIdx);
  const sbNow = senkouBAt(lastIdx);
  const saPrev = senkouAAt(prevIdx);
  const sbPrev = senkouBAt(prevIdx);

  let kumoTwist: "bullish" | "bearish" | "none" = "none";
  if (saNow != null && sbNow != null && saPrev != null && sbPrev != null) {
    if (saPrev <= sbPrev && saNow > sbNow) kumoTwist = "bullish";
    else if (saPrev >= sbPrev && saNow < sbNow) kumoTwist = "bearish";
  }

  // ---- 5. edgeToEdge: flat-Kumo edge-to-edge target ----
  // flatKumo = Senkou A ≈ Senkou B across the recent projected cloud (< 0.5% of price).
  // active = price currently inside the cloud (between A and B) on a flat cloud.
  // target = the far cloud edge from the current close.
  let flatKumo = false;
  let active = false;
  let target: number | null = null;
  if (saNow != null && sbNow != null) {
    const ref = Math.abs(close) > 0 ? Math.abs(close) : 1;
    const cloudTop = Math.max(saNow, sbNow);
    const cloudBottom = Math.min(saNow, sbNow);
    // flat across the recent window (last `displacement`-bounded lookback, capped at 5 bars)
    const flatLook = Math.min(5, lastIdx);
    let allFlat = true;
    for (let i = lastIdx - flatLook; i <= lastIdx; i++) {
      if (i < 0) continue;
      const a = senkouAAt(i);
      const b = senkouBAt(i);
      if (a == null || b == null) {
        allFlat = false;
        break;
      }
      if (Math.abs(a - b) / ref >= 0.005) {
        allFlat = false;
        break;
      }
    }
    flatKumo = allFlat;
    if (flatKumo && close <= cloudTop && close >= cloudBottom) {
      active = true;
      // far edge from current close
      const distTop = Math.abs(cloudTop - close);
      const distBottom = Math.abs(close - cloudBottom);
      target = distTop >= distBottom ? cloudTop : cloudBottom;
    }
  }

  // ---- 6. tkDisequilibrium: Tenkan-Kijun gap overextension ----
  let gap = 0;
  let stretchPct = 0;
  let state: "overextended_bull" | "overextended_bear" | "neutral" = "neutral";
  if (tenkan != null && kijun != null && close !== 0) {
    gap = tenkan - kijun;
    stretchPct = (gap / close) * 100;
    if (stretchPct > 1.5) state = "overextended_bull";
    else if (stretchPct < -1.5) state = "overextended_bear";
  }

  const interpretation = buildInterpretation(
    close,
    tenkan,
    kijun,
    kijunCross,
    kijunPosition,
    kijunBounce,
    kumoTwist,
    { active, flatKumo, target },
    { gap, stretchPct, state }
  );

  return {
    kijunCross,
    kijunPosition,
    kijunBounce,
    kumoTwist,
    edgeToEdge: {
      active,
      flatKumo,
      target: target != null ? round(target, 2) : null,
    },
    tkDisequilibrium: {
      gap: round(gap, 2),
      stretchPct: round(stretchPct, 2),
      state,
    },
    currentClose: round(close, 2),
    tenkan: tenkan != null ? round(tenkan, 2) : null,
    kijun: kijun != null ? round(kijun, 2) : null,
    interpretation,
  };
}

function buildInterpretation(
  close: number,
  tenkan: number | null,
  kijun: number | null,
  kijunCross: string,
  kijunPosition: string,
  kijunBounce: boolean,
  kumoTwist: string,
  edge: { active: boolean; flatKumo: boolean; target: number | null },
  tk: { gap: number; stretchPct: number; state: string }
): string {
  const parts: string[] = [];

  if (kijun != null) {
    parts.push(`Close ${kijunPosition} Kijun (${kijun.toFixed(2)})`);
  }

  if (kijunCross === "bullish") parts.push("BULLISH Kijun cross (close crossed above base line)");
  else if (kijunCross === "bearish") parts.push("BEARISH Kijun cross (close crossed below base line)");

  if (kijunBounce) {
    parts.push(
      kijunPosition === "above"
        ? "Kijun bounce — price tested base line as support and held"
        : "Kijun rejection — price tested base line as resistance and held"
    );
  }

  if (kumoTwist === "bullish") parts.push("Future Kumo twist BULLISH (Senkou A crossed above B)");
  else if (kumoTwist === "bearish") parts.push("Future Kumo twist BEARISH (Senkou A crossed below B)");

  if (edge.flatKumo) {
    if (edge.active && edge.target != null) {
      parts.push(`Flat Kumo edge-to-edge active — target far edge ${edge.target.toFixed(2)}`);
    } else {
      parts.push("Flat Kumo present (price not inside cloud)");
    }
  }

  if (tk.state === "overextended_bull") {
    parts.push(`TK disequilibrium overextended bull (+${tk.stretchPct.toFixed(2)}%) — revert risk`);
  } else if (tk.state === "overextended_bear") {
    parts.push(`TK disequilibrium overextended bear (${tk.stretchPct.toFixed(2)}%) — revert risk`);
  }

  if (parts.length === 0) return "No notable Ichimoku signals on the current bar.";
  return parts.join(". ") + ".";
}
