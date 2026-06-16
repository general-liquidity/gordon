/**
 * Integrated Cointegration Pairs-Trading System — the 5-layer framework.
 *
 * Ties together the primitives already in this directory into one pure function
 * that, given two price series, produces a per-bar dollar-neutral position:
 *
 *   1. SELECT      — Johansen (symmetric) + Engle-Granger both directions +
 *                    Hurst(spread) < 0.5 + OU half-life in a tradeable band.
 *   2. OU MODEL    — calibrate (θ, μ, σ, half-life, ouStd) on the Kalman spread.
 *   3. COST-Z      — cost-calibrated entry z = effectiveEntryZ(2.0, minEntryZ),
 *                    exit z = half of entry (recommendedExitZ).
 *   4. SIZING      — OU-proportional: allocation = maxFraction · min(|z|/entryZ, 1).
 *   5. DYNAMIC β + — Kalman-filtered hedge ratio gives a per-bar spread; a rolling
 *      MONITOR       cointegration monitor (ACTIVE/WARNING/HALTED) gates new entries.
 *
 * Regime gate semantics (from pairRegimeMonitor):
 *   ACTIVE  → may open new positions.
 *   WARNING → hold existing, open nothing new.
 *   HALTED  → flatten (the cointegration relationship has decayed).
 *
 * Spread convention: LOG prices in, so the per-bar spread change ΔS is the
 * dollar-neutral pair return (long 1 of p1, short β of p2). The caller passes raw
 * prices; this module logs them internally.
 *
 * Pure compute, no I/O, no RNG.
 */

import { johansenTest } from "./johansen.ts";
import { testCointegration } from "./cointegration.ts";
import { calibrateOU, minimumEntryZScore, effectiveEntryZ, recommendedExitZ } from "./ouCalibration.ts";
import { kalmanHedgeRatio } from "./kalmanHedgeRatio.ts";
import { pairRegimeMonitor, type PairRegimeStatus } from "./cointegrationMonitor.ts";

// ============================================================================
// Types
// ============================================================================

export type PositionState = "long" | "short" | "flat";

export interface PairsBar {
  /** Bar index. */
  index: number;
  /** Kalman hedge ratio β at this bar. */
  beta: number;
  /** Kalman intercept α at this bar. */
  alpha: number;
  /** Kalman spread S = ln(p1) − β·ln(p2) − α. */
  spread: number;
  /** Rolling z-score of the spread (NaN before the lookback fills). */
  z: number;
  /** Signal position BEFORE sizing: long (+1 spread), short (−1 spread), flat. */
  state: PositionState;
  /**
   * Signed dollar-neutral allocation in [−maxFraction, maxFraction]. +ve = long
   * spread (long p1 / short β·p2), −ve = short spread. OU-proportional magnitude.
   */
  allocation: number;
  /** Pair-health regime gating this bar's entries. */
  regime: PairRegimeStatus;
}

export interface PairsSelection {
  /** Passed ALL selection gates (tradeable). */
  selected: boolean;
  johansenCointegrated: boolean;
  egBothDirections: boolean;
  hurst: number;
  /** OU half-life of the spread (periods). */
  halfLife: number;
  /** Static Johansen hedge ratio (informational; the live β is Kalman). */
  staticHedgeRatio: number;
  /** Reason the pair was rejected, when !selected. */
  rejectReason: string | null;
}

export interface PairsSystemConfig {
  /** Desired entry z before the cost floor (default 2.0). */
  desiredEntryZ?: number;
  /** Max capital fraction per leg at full conviction (default 1.0). */
  maxFraction?: number;
  /** Round-trip cost in bps across both legs (one side). Floor for crypto spread=0. */
  costBps?: number;
  /** Rolling z-score lookback. Defaults to clamp(round(2.5·halfLife), 20, 250). */
  zLookback?: number;
  /** Rolling cointegration monitor window. Default min(252, floor(n/2)). */
  monitorWindow?: number;
  /** Half-life tradeable band min (periods). Default 3. */
  halfLifeMin?: number;
  /** Half-life tradeable band max (periods). Default floor(n/2). */
  halfLifeMax?: number;
  /** Kalman process-noise delta. Default 1e-4 (slow, stable β). */
  kalmanDelta?: number;
  /** Kalman observation variance. Default 1e-3. */
  kalmanObsVar?: number;
}

export interface PairsSystemResult {
  selection: PairsSelection;
  /** Per-bar output (empty when !selected). */
  bars: PairsBar[];
  /** Effective (cost-floored) entry z used. */
  entryZ: number;
  /** Exit z (half of entry). */
  exitZ: number;
  /** Cost-implied minimum entry z. */
  minEntryZ: number;
  /** OU equilibrium dispersion of the spread. */
  ouStd: number;
}

// ============================================================================
// Helpers
// ============================================================================

function mean(xs: number[]): number {
  return xs.reduce((s, v) => s + v, 0) / (xs.length || 1);
}
function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / (xs.length - 1));
}

/** Hurst exponent via the lag-diff dispersion method. <0.5 = mean-reverting. */
function hurstOfSpread(series: number[], maxLag = 50): number {
  const logLag: number[] = [];
  const logTau: number[] = [];
  const top = Math.min(maxLag, Math.floor(series.length / 2));
  for (let lag = 2; lag < top; lag++) {
    const diffs: number[] = [];
    for (let i = lag; i < series.length; i++) diffs.push(series[i]! - series[i - lag]!);
    logLag.push(Math.log(lag));
    logTau.push(Math.log(Math.max(std(diffs), 1e-12)));
  }
  if (logLag.length < 3) return 0.5;
  const mx = mean(logLag);
  const my = mean(logTau);
  let num = 0;
  let den = 0;
  for (let i = 0; i < logLag.length; i++) {
    num += (logLag[i]! - mx) * (logTau[i]! - my);
    den += (logLag[i]! - mx) ** 2;
  }
  return den > 0 ? num / den : 0.5;
}

/** Rolling z-score with a fixed lookback; NaN until the window fills. */
function rollingZ(spread: number[], lookback: number): number[] {
  const z = new Array<number>(spread.length).fill(NaN);
  for (let i = lookback; i < spread.length; i++) {
    const w = spread.slice(i - lookback, i);
    const m = mean(w);
    const sd = std(w);
    z[i] = sd > 0 ? (spread[i]! - m) / sd : 0;
  }
  return z;
}

// ============================================================================
// Main: integrated system
// ============================================================================

/**
 * Run the integrated pairs system on two aligned RAW price series.
 *
 * @param pricesA Raw prices for asset A (the regressand p1).
 * @param pricesB Raw prices for asset B (the regressor p2).
 */
export function runPairsSystem(
  pricesA: number[],
  pricesB: number[],
  config: PairsSystemConfig = {},
): PairsSystemResult {
  const n = Math.min(pricesA.length, pricesB.length);
  const a = pricesA.slice(-n);
  const b = pricesB.slice(-n);

  const empty = (sel: PairsSelection): PairsSystemResult => ({
    selection: sel,
    bars: [],
    entryZ: NaN,
    exitZ: NaN,
    minEntryZ: NaN,
    ouStd: NaN,
  });

  if (n < 60) {
    return empty({
      selected: false,
      johansenCointegrated: false,
      egBothDirections: false,
      hurst: NaN,
      halfLife: NaN,
      staticHedgeRatio: NaN,
      rejectReason: "insufficient_observations",
    });
  }

  const lp1 = a.map(Math.log);
  const lp2 = b.map(Math.log);

  // ── Layer 1: selection ──
  const joh = johansenTest(lp1, lp2);
  const egAB = testCointegration(lp1, lp2);
  const egBA = testCointegration(lp2, lp1);
  const egBoth = egAB.cointegrated && egBA.cointegrated;

  // Dynamic spread from the Kalman hedge ratio (the per-bar β).
  const kalman = kalmanHedgeRatio(lp1, lp2, {
    delta: config.kalmanDelta ?? 1e-4,
    observationVar: config.kalmanObsVar ?? 1e-3,
  });
  const spread = kalman.spread;

  const halfLifeMin = config.halfLifeMin ?? 3;
  const halfLifeMax = config.halfLifeMax ?? Math.floor(n / 2);
  const ou = calibrateOU(spread, 1, { minHalfLife: halfLifeMin, maxHalfLife: halfLifeMax });
  const hurst = hurstOfSpread(spread);
  const halfLife = ou.halfLife;

  const tradeableHL = Number.isFinite(halfLife) && halfLife >= halfLifeMin && halfLife <= halfLifeMax;
  const hurstOk = hurst < 0.5;

  let rejectReason: string | null = null;
  if (!joh.cointegrated) rejectReason = "johansen_not_cointegrated";
  else if (!egBoth) rejectReason = "eg_not_both_directions";
  else if (!hurstOk) rejectReason = "hurst_not_mean_reverting";
  else if (!tradeableHL) rejectReason = "half_life_out_of_band";

  const selection: PairsSelection = {
    selected: rejectReason === null,
    johansenCointegrated: joh.cointegrated,
    egBothDirections: egBoth,
    hurst,
    halfLife,
    staticHedgeRatio: joh.hedgeRatio,
    rejectReason,
  };

  if (!selection.selected) return empty(selection);

  // ── Layer 3: cost-calibrated z thresholds ──
  const desiredEntryZ = config.desiredEntryZ ?? 2.0;
  const costBps = config.costBps ?? 0;
  const minEntryZ = minimumEntryZScore(ou.ouStd, costBps);
  const entryZ = effectiveEntryZ(desiredEntryZ, minEntryZ);
  const exitZ = recommendedExitZ(entryZ);

  // ── Layer 4: rolling z + state machine + OU-proportional sizing ──
  const lookback =
    config.zLookback ?? Math.min(250, Math.max(20, Math.round(2.5 * halfLife)));
  const z = rollingZ(spread, lookback);
  const maxFraction = config.maxFraction ?? 1.0;

  // ── Layer 5: rolling cointegration monitor (computed per-bar on trailing window) ──
  const monitorWindow = config.monitorWindow ?? Math.min(252, Math.floor(n / 2));

  const bars: PairsBar[] = new Array(n);
  let state: PositionState = "flat";

  for (let i = 0; i < n; i++) {
    const zi = z[i]!;
    const step = kalman.steps[i]!;

    // Regime gate from the trailing window ending at i (needs full window of history).
    let regime: PairRegimeStatus = "HALTED";
    if (i + 1 >= monitorWindow) {
      const wx = lp1.slice(i + 1 - monitorWindow, i + 1);
      const wy = lp2.slice(i + 1 - monitorWindow, i + 1);
      regime = pairRegimeMonitor(wx, wy, {
        window: monitorWindow,
        halfLifeMin,
        halfLifeMax,
      }).status;
    }

    // State machine. Entries only when ACTIVE; HALTED forces flat; WARNING holds.
    if (regime === "HALTED") {
      state = "flat";
    } else if (!Number.isNaN(zi)) {
      if (state === "flat") {
        if (regime === "ACTIVE") {
          if (zi > entryZ) state = "short"; // spread rich → short the spread
          else if (zi < -entryZ) state = "long"; // spread cheap → long the spread
        }
        // WARNING + flat → stay flat (open nothing new).
      } else if (state === "short" && zi < exitZ) {
        state = "flat";
      } else if (state === "long" && zi > -exitZ) {
        state = "flat";
      }
    }

    // OU-proportional sizing: scale by |z|/entryZ, capped at 1.
    const conviction = entryZ > 0 ? Math.min(Math.abs(zi) / entryZ, 1) : 0;
    const sized = Number.isNaN(zi) ? 0 : maxFraction * conviction;
    const allocation = state === "long" ? sized : state === "short" ? -sized : 0;

    bars[i] = {
      index: i,
      beta: step.beta,
      alpha: step.alpha,
      spread: step.spread,
      z: zi,
      state,
      allocation,
      regime,
    };
  }

  return { selection, bars, entryZ, exitZ, minEntryZ, ouStd: ou.ouStd };
}
