/**
 * Strategy registry for the systematic alpha-search harness.
 *
 * Wraps a BROAD representative slice of Gordon's signal library as parameterized
 * `SignalFn` factories so the search engine (`alpha-search.ts`) can sweep
 * (strategy × param grid × instrument) through the competition money-path
 * (`runCompetitionDryRun`). We REUSE Gordon's primitives verbatim — every factory
 * is a thin adapter that maps the primitive's output onto a per-bar directional
 * `DryRunSignal | null`. No alpha logic is re-implemented here.
 *
 * Each strategy declares its data needs (`inputs`):
 *   - "close"  → needs only the close series (built off `history` + `bar`)
 *   - "ohlc"   → needs OHLC candles (we reconstruct minimal Candles from bars)
 *   - "l2"     → needs the per-bar aggregated L2 imbalance (only some instruments)
 *
 * Stop/target convention: where a primitive doesn't supply one, the factory
 * derives a vol-scaled stop from the ATR-equivalent (recent-return stdev × price)
 * so every signal is sizeable by `sizeCompetitionTrade`. This is deliberately
 * uniform so cross-strategy comparison isn't contaminated by bespoke stop logic.
 *
 * SKIPPED primitives (do NOT yield a standalone per-symbol directional view —
 * they are context/filters/cross-sectional and would need a companion signal or
 * the full universe to be directional):
 *   - vcp-contraction, ma-proximity, volume-trend, volume-exhaustion  (context/filters)
 *   - cross-sectional-momentum, ibs-cross-sectional, cross-sectional-contrarian,
 *     smt-divergence, market-breadth-bias  (need the cross-section, not one symbol)
 *   - too-good-check, margin-of-error, trade-consistency, robustness-metrics  (diagnostics)
 */

import type { DryRunBar, DryRunSignal, SignalFn } from "../../src/backtest/competition-dry-run.ts";
import type { Candle } from "../../src/core/indicators/types.ts";

import { calculateRSI } from "../../src/core/indicators/rsi.ts";
import { calculateMACD } from "../../src/core/indicators/macd.ts";
import { calculateBollingerBands } from "../../src/core/indicators/bollinger.ts";
import { calculateDonchian } from "../../src/core/indicators/donchian.ts";
import { calculateSMA, calculateEMA } from "../../src/core/indicators/ema.ts";
import { calculateStochastic } from "../../src/core/indicators/stochastic.ts";
import { calculateWilliamsR } from "../../src/core/indicators/williams-r.ts";
import { calculateCCI } from "../../src/core/indicators/cci.ts";
import { calculateROC } from "../../src/core/indicators/momentum-roc.ts";
import { calculateSupertrend } from "../../src/core/indicators/supertrend.ts";
import { reversalSignal } from "../../src/core/alpha/reversal-strategy.ts";
import { regimeAdaptiveSignal } from "../../src/core/alpha/regime-adaptive-strategy.ts";
import { detectStreak } from "../../src/core/alpha/streak-detector.ts";

// ── Bar carrying optional per-bar L2 imbalance (set by the loader for L2 instruments). ──
export interface ResearchBar extends DryRunBar {
  open: number;
  high: number;
  low: number;
  /** Per-bar aggregated order-book imbalance ∈ [−1,+1], when L2 is present. */
  imbalance?: number;
}

export type StrategyInputKind = "close" | "ohlc" | "l2";

export interface StrategyFactory {
  /** Stable id (used as the multiple-testing codeHash seed). */
  id: string;
  /** Strategy family for multiple-testing scoping. */
  family: "mean-reversion" | "momentum" | "breakout" | "trend" | "adaptive" | "microstructure";
  inputs: StrategyInputKind;
  /** Human description of the signal. */
  description: string;
  /** Default param grid this factory is swept over (each entry → one config). */
  paramGrid: Record<string, unknown>[];
  /** Build a SignalFn for a concrete param set. */
  build: (params: Record<string, unknown>) => SignalFn;
}

// ── Shared helpers ──────────────────────────────────────────────────────────

/**
 * Trailing-history cap for indicator inputs. Every indicator used here is either
 * window-based (depends only on the last `period` bars → capping ≥ period is
 * exact) or a forward-smoothing recursion (RSI/EMA/MACD/Supertrend) whose seed
 * influence decays geometrically: for the slowest period in the grids (26), the
 * residual after CAP bars is (25/27)^768 ≈ 1e-58, far below float64 epsilon
 * (2^-53 ≈ 1.1e-16). So feeding only the last CAP bars is BIT-IDENTICAL to the
 * full history while turning the per-bar O(N) indicator recompute (→ O(N²) over a
 * run) into O(CAP) (→ O(N·CAP)). Verified by M15 verdict + marginal-list parity.
 */
export const HISTORY_CAP = 768;

function closesOf(history: ResearchBar[], bar: ResearchBar): number[] {
  const start = Math.max(0, history.length - HISTORY_CAP);
  const n = history.length - start;
  const out = new Array<number>(n + 1);
  for (let i = 0; i < n; i++) out[i] = history[start + i]!.close;
  out[n] = bar.close;
  return out;
}

function candlesOf(history: ResearchBar[], bar: ResearchBar): Candle[] {
  const start = Math.max(0, history.length - HISTORY_CAP);
  const out: Candle[] = [];
  for (let i = start; i < history.length; i++) {
    const b = history[i]!;
    out.push({ open: b.open, high: b.high, low: b.low, close: b.close, volume: 0 });
  }
  out.push({ open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: 0 });
  return out;
}

/** Population stdev of consecutive-close returns over the last `n` closes. */
function returnStd(closes: number[], n: number): number {
  const start = Math.max(1, closes.length - n);
  const rets: number[] = [];
  for (let i = start; i < closes.length; i++) {
    const prev = closes[i - 1]!;
    if (prev > 0) rets.push(closes[i]! / prev - 1);
  }
  if (rets.length < 2) return 0;
  const m = rets.reduce((a, b) => a + b, 0) / rets.length;
  let acc = 0;
  for (const r of rets) acc += (r - m) ** 2;
  return Math.sqrt(acc / rets.length);
}

/** Vol-scaled stop/target (fraction-of-price × price), with a hard floor. */
function volStop(closes: number[], lookback: number, stopMult: number, targetMult: number): {
  stopDistance: number;
  targetDistance: number;
} {
  const price = closes[closes.length - 1]!;
  const sigma = price * Math.max(returnStd(closes, lookback), 1e-6);
  return { stopDistance: sigma * stopMult, targetDistance: sigma * targetMult };
}

const num = (p: Record<string, unknown>, k: string, d: number): number =>
  typeof p[k] === "number" ? (p[k] as number) : d;

// ── Factories ───────────────────────────────────────────────────────────────

export const STRATEGY_REGISTRY: StrategyFactory[] = [
  // 1. RSI mean-reversion — oversold → long, overbought → short.
  {
    id: "rsi_meanrev",
    family: "mean-reversion",
    inputs: "close",
    description: "RSI oversold (<lower) buys, overbought (>upper) shorts; vol-scaled stop.",
    paramGrid: [
      { period: 14, lower: 30, upper: 70 },
      { period: 14, lower: 25, upper: 75 },
      { period: 7, lower: 30, upper: 70 },
    ],
    build: (p) => (bar, hist) => {
      const closes = closesOf(hist as ResearchBar[], bar as ResearchBar);
      const r = calculateRSI(closes, num(p, "period", 14));
      if (r.current === null) return null;
      const lower = num(p, "lower", 30), upper = num(p, "upper", 70);
      const lb = num(p, "period", 14);
      if (r.current < lower) return { side: "long", ...volStop(closes, lb, 2, 1.5) };
      if (r.current > upper) return { side: "short", ...volStop(closes, lb, 2, 1.5) };
      return null;
    },
  },

  // 2. RSI momentum — cross of the midline (>50 long-bias, <50 short-bias).
  {
    id: "rsi_momentum",
    family: "momentum",
    inputs: "close",
    description: "RSI above midline+band → long (momentum), below → short.",
    paramGrid: [
      { period: 14, band: 10 },
      { period: 14, band: 5 },
    ],
    build: (p) => (bar, hist) => {
      const closes = closesOf(hist as ResearchBar[], bar as ResearchBar);
      const lb = num(p, "period", 14);
      const r = calculateRSI(closes, lb);
      if (r.current === null) return null;
      const band = num(p, "band", 10);
      if (r.current > 50 + band) return { side: "long", ...volStop(closes, lb, 2, 3) };
      if (r.current < 50 - band) return { side: "short", ...volStop(closes, lb, 2, 3) };
      return null;
    },
  },

  // 3. MACD crossover — bullish/bearish histogram cross.
  {
    id: "macd_cross",
    family: "momentum",
    inputs: "close",
    description: "MACD bullish_cross → long, bearish_cross → short.",
    paramGrid: [
      { fast: 12, slow: 26, signal: 9 },
      { fast: 8, slow: 21, signal: 5 },
    ],
    build: (p) => (bar, hist) => {
      const closes = closesOf(hist as ResearchBar[], bar as ResearchBar);
      const m = calculateMACD(closes, num(p, "fast", 12), num(p, "slow", 26), num(p, "signal", 9));
      if (m.crossover === "bullish_cross") return { side: "long", ...volStop(closes, num(p, "slow", 26), 2, 3) };
      if (m.crossover === "bearish_cross") return { side: "short", ...volStop(closes, num(p, "slow", 26), 2, 3) };
      return null;
    },
  },

  // 4. Bollinger reversion — close beyond a band reverts to the mean.
  {
    id: "bollinger_reversion",
    family: "mean-reversion",
    inputs: "close",
    description: "Close below lower band → long, above upper band → short (mean-revert).",
    paramGrid: [
      { period: 20, mult: 2 },
      { period: 20, mult: 2.5 },
      { period: 10, mult: 2 },
    ],
    build: (p) => (bar, hist) => {
      const closes = closesOf(hist as ResearchBar[], bar as ResearchBar);
      const period = num(p, "period", 20);
      const b = calculateBollingerBands(closes, period, num(p, "mult", 2), bar.close);
      if (b.position === "below_lower") return { side: "long", ...volStop(closes, period, 2, 1.5) };
      if (b.position === "above_upper") return { side: "short", ...volStop(closes, period, 2, 1.5) };
      return null;
    },
  },

  // 5. Bollinger breakout — close beyond a band continues (momentum, opposite of #4).
  {
    id: "bollinger_breakout",
    family: "breakout",
    inputs: "close",
    description: "Close above upper band → long, below lower band → short (breakout).",
    paramGrid: [
      { period: 20, mult: 2 },
      { period: 20, mult: 1.5 },
    ],
    build: (p) => (bar, hist) => {
      const closes = closesOf(hist as ResearchBar[], bar as ResearchBar);
      const period = num(p, "period", 20);
      const b = calculateBollingerBands(closes, period, num(p, "mult", 2), bar.close);
      if (b.position === "above_upper") return { side: "long", ...volStop(closes, period, 2, 3) };
      if (b.position === "below_lower") return { side: "short", ...volStop(closes, period, 2, 3) };
      return null;
    },
  },

  // 6. Donchian breakout — close tagging the rolling high/low (Turtle).
  {
    id: "donchian_breakout",
    family: "breakout",
    inputs: "ohlc",
    description: "Close ≥ Donchian upper → long, ≤ lower → short (N-bar breakout).",
    paramGrid: [
      { period: 20 },
      { period: 10 },
      { period: 40 },
    ],
    build: (p) => (bar, hist) => {
      const closes = closesOf(hist as ResearchBar[], bar as ResearchBar);
      const period = num(p, "period", 20);
      const d = calculateDonchian(candlesOf(hist as ResearchBar[], bar as ResearchBar), period);
      if (!d.current) return null;
      if (bar.close >= d.current.upper) return { side: "long", ...volStop(closes, period, 2, 3) };
      if (bar.close <= d.current.lower) return { side: "short", ...volStop(closes, period, 2, 3) };
      return null;
    },
  },

  // 7. SMA cross — fast SMA over slow SMA.
  {
    id: "sma_cross",
    family: "trend",
    inputs: "close",
    description: "Fast SMA crossing above slow SMA → long, below → short.",
    paramGrid: [
      { fast: 10, slow: 30 },
      { fast: 5, slow: 20 },
      { fast: 20, slow: 50 },
    ],
    build: (p) => (bar, hist) => {
      const closes = closesOf(hist as ResearchBar[], bar as ResearchBar);
      const fastP = num(p, "fast", 10), slowP = num(p, "slow", 30);
      const fast = calculateSMA(closes, fastP);
      const slow = calculateSMA(closes, slowP);
      const fNow = fast[fast.length - 1], fPrev = fast[fast.length - 2];
      const sNow = slow[slow.length - 1], sPrev = slow[slow.length - 2];
      if (fNow == null || sNow == null || fPrev == null || sPrev == null) return null;
      if (fPrev <= sPrev && fNow > sNow) return { side: "long", ...volStop(closes, slowP, 2, 3) };
      if (fPrev >= sPrev && fNow < sNow) return { side: "short", ...volStop(closes, slowP, 2, 3) };
      return null;
    },
  },

  // 8. EMA cross — fast EMA over slow EMA.
  {
    id: "ema_cross",
    family: "trend",
    inputs: "close",
    description: "Fast EMA crossing above slow EMA → long, below → short.",
    paramGrid: [
      { fast: 9, slow: 21 },
      { fast: 12, slow: 26 },
    ],
    build: (p) => (bar, hist) => {
      const closes = closesOf(hist as ResearchBar[], bar as ResearchBar);
      const fastP = num(p, "fast", 9), slowP = num(p, "slow", 21);
      const fast = calculateEMA(closes, fastP).values;
      const slow = calculateEMA(closes, slowP).values;
      const fNow = fast[fast.length - 1], fPrev = fast[fast.length - 2];
      const sNow = slow[slow.length - 1], sPrev = slow[slow.length - 2];
      if (fNow == null || sNow == null || fPrev == null || sPrev == null) return null;
      if (fPrev <= sPrev && fNow > sNow) return { side: "long", ...volStop(closes, slowP, 2, 3) };
      if (fPrev >= sPrev && fNow < sNow) return { side: "short", ...volStop(closes, slowP, 2, 3) };
      return null;
    },
  },

  // 9. Stochastic reversion — %K in oversold/overbought zone.
  {
    id: "stochastic_reversion",
    family: "mean-reversion",
    inputs: "ohlc",
    description: "Stochastic %K oversold → long, overbought → short.",
    paramGrid: [
      { kPeriod: 14, lower: 20, upper: 80 },
      { kPeriod: 14, lower: 15, upper: 85 },
    ],
    build: (p) => (bar, hist) => {
      const closes = closesOf(hist as ResearchBar[], bar as ResearchBar);
      const kPeriod = num(p, "kPeriod", 14);
      const s = calculateStochastic(candlesOf(hist as ResearchBar[], bar as ResearchBar), { kPeriod });
      if (s.current.k === null) return null;
      const lower = num(p, "lower", 20), upper = num(p, "upper", 80);
      if (s.current.k < lower) return { side: "long", ...volStop(closes, kPeriod, 2, 1.5) };
      if (s.current.k > upper) return { side: "short", ...volStop(closes, kPeriod, 2, 1.5) };
      return null;
    },
  },

  // 10. Williams %R reversion.
  {
    id: "williams_reversion",
    family: "mean-reversion",
    inputs: "ohlc",
    description: "Williams %R oversold (< -80) → long, overbought (> -20) → short.",
    paramGrid: [
      { period: 14 },
      { period: 7 },
    ],
    build: (p) => (bar, hist) => {
      const closes = closesOf(hist as ResearchBar[], bar as ResearchBar);
      const period = num(p, "period", 14);
      const w = calculateWilliamsR(candlesOf(hist as ResearchBar[], bar as ResearchBar), period);
      if (w.current === null) return null;
      if (w.current < -80) return { side: "long", ...volStop(closes, period, 2, 1.5) };
      if (w.current > -20) return { side: "short", ...volStop(closes, period, 2, 1.5) };
      return null;
    },
  },

  // 11. CCI reversion — extreme CCI reverts.
  {
    id: "cci_reversion",
    family: "mean-reversion",
    inputs: "ohlc",
    description: "CCI < -100 → long, > +100 → short (mean reversion from extremes).",
    paramGrid: [
      { period: 20, threshold: 100 },
      { period: 14, threshold: 150 },
    ],
    build: (p) => (bar, hist) => {
      const closes = closesOf(hist as ResearchBar[], bar as ResearchBar);
      const period = num(p, "period", 20);
      const c = calculateCCI(candlesOf(hist as ResearchBar[], bar as ResearchBar), period);
      if (c.current === null) return null;
      const th = num(p, "threshold", 100);
      if (c.current < -th) return { side: "long", ...volStop(closes, period, 2, 1.5) };
      if (c.current > th) return { side: "short", ...volStop(closes, period, 2, 1.5) };
      return null;
    },
  },

  // 12. ROC momentum — positive rate-of-change → long.
  {
    id: "roc_momentum",
    family: "momentum",
    inputs: "close",
    description: "Rate-of-change above band → long, below → short (momentum).",
    paramGrid: [
      { period: 10, band: 0.2 },
      { period: 20, band: 0.3 },
    ],
    build: (p) => (bar, hist) => {
      const closes = closesOf(hist as ResearchBar[], bar as ResearchBar);
      const period = num(p, "period", 10);
      const roc = calculateROC(closes, period);
      const cur = roc[roc.length - 1];
      if (cur == null) return null;
      const band = num(p, "band", 0.2);
      if (cur > band) return { side: "long", ...volStop(closes, period, 2, 3) };
      if (cur < -band) return { side: "short", ...volStop(closes, period, 2, 3) };
      return null;
    },
  },

  // 13. Supertrend follow — ATR trailing-band trend direction.
  {
    id: "supertrend_follow",
    family: "trend",
    inputs: "ohlc",
    description: "Supertrend buy/sell signal (ATR trailing band, no repaint).",
    paramGrid: [
      { atrPeriod: 10, mult: 2 },
      { atrPeriod: 14, mult: 3 },
    ],
    build: (p) => (bar, hist) => {
      const closes = closesOf(hist as ResearchBar[], bar as ResearchBar);
      const atrPeriod = num(p, "atrPeriod", 10);
      const s = calculateSupertrend(candlesOf(hist as ResearchBar[], bar as ResearchBar), atrPeriod, num(p, "mult", 2));
      if (s.signal === "buy") return { side: "long", ...volStop(closes, atrPeriod, 2.5, 4) };
      if (s.signal === "sell") return { side: "short", ...volStop(closes, atrPeriod, 2.5, 4) };
      return null;
    },
  },

  // 14. Reversal-strategy alpha primitive (normalized z-score, vol-scaled exits).
  {
    id: "alpha_reversal",
    family: "mean-reversion",
    inputs: "close",
    description: "core/alpha reversalSignal — negated z-score of close vs short mean.",
    paramGrid: [
      { lookback: 14, zThreshold: 1.0 },
      { lookback: 7, zThreshold: 1.0 },
      { lookback: 20, zThreshold: 1.5 },
    ],
    build: (p) => (bar, hist) => {
      const closes = closesOf(hist as ResearchBar[], bar as ResearchBar);
      const sig = reversalSignal(closes, {
        lookback: num(p, "lookback", 14),
        zThreshold: num(p, "zThreshold", 1.0),
      });
      if (!sig) return null;
      return { side: sig.side, stopDistance: sig.stopDistance, targetDistance: sig.targetDistance };
    },
  },

  // 15. Regime-adaptive alpha primitive (mean-revert in chop, momentum in trend).
  {
    id: "alpha_regime_adaptive",
    family: "adaptive",
    inputs: "close",
    description: "core/alpha regimeAdaptiveSignal — efficiency-ratio gated reversal/momentum.",
    paramGrid: [
      { lookback: 20, erThreshold: 0.4 },
      { lookback: 14, erThreshold: 0.35 },
    ],
    build: (p) => (bar, hist) => {
      const closes = closesOf(hist as ResearchBar[], bar as ResearchBar);
      return regimeAdaptiveSignal(closes, {
        lookback: num(p, "lookback", 20),
        erThreshold: num(p, "erThreshold", 0.4),
      });
    },
  },

  // 16. Streak-detector fade — fade an exhausted same-direction run.
  {
    id: "alpha_streak_fade",
    family: "mean-reversion",
    inputs: "close",
    description: "core/alpha detectStreak — fade an exhausted up/down close streak.",
    paramGrid: [
      { lookback: 60, minStreak: 3 },
      { lookback: 40, minStreak: 4 },
    ],
    build: (p) => (bar, hist) => {
      const closes = closesOf(hist as ResearchBar[], bar as ResearchBar);
      const bars = closes.map((c) => ({ close: c }));
      const r = detectStreak(bars, {
        lookback: num(p, "lookback", 60),
        minStreakLength: num(p, "minStreak", 3),
      });
      if (!r.recommendedFadeDirection) return null;
      return { side: r.recommendedFadeDirection, ...volStop(closes, num(p, "lookback", 60), 2, 1.5) };
    },
  },

  // 17. Price momentum — close vs close N bars ago (raw time-series momentum).
  {
    id: "price_momentum",
    family: "momentum",
    inputs: "close",
    description: "Close above close N bars ago → long, below → short (TS momentum).",
    paramGrid: [
      { lookback: 12 },
      { lookback: 24 },
      { lookback: 48 },
    ],
    build: (p) => (bar, hist) => {
      const closes = closesOf(hist as ResearchBar[], bar as ResearchBar);
      const lb = num(p, "lookback", 12);
      if (closes.length <= lb) return null;
      const past = closes[closes.length - 1 - lb]!;
      const now = closes[closes.length - 1]!;
      if (!(past > 0)) return null;
      const r = now / past - 1;
      if (r > 0) return { side: "long", ...volStop(closes, lb, 2, 3) };
      if (r < 0) return { side: "short", ...volStop(closes, lb, 2, 3) };
      return null;
    },
  },

  // 18. Microstructure imbalance — per-bar aggregated order-book imbalance (L2 only).
  {
    id: "micro_imbalance",
    family: "microstructure",
    inputs: "l2",
    description: "Per-bar L2 imbalance beyond a band → trade with the book lean (L2 instruments only).",
    paramGrid: [
      { threshold: 0.1 },
      { threshold: 0.2 },
    ],
    build: (p) => (bar, hist) => {
      const b = bar as ResearchBar;
      if (typeof b.imbalance !== "number") return null;
      const closes = closesOf(hist as ResearchBar[], b);
      const th = num(p, "threshold", 0.1);
      if (b.imbalance > th) return { side: "long", ...volStop(closes, 20, 2, 1.5) };
      if (b.imbalance < -th) return { side: "short", ...volStop(closes, 20, 2, 1.5) };
      return null;
    },
  },
];

/** Total (strategy × config) count across the registry. */
export function totalConfigCount(): number {
  return STRATEGY_REGISTRY.reduce((acc, s) => acc + s.paramGrid.length, 0);
}
