/**
 * Relative-value reversion CORE — the live Best-Sharpe vehicle (promoted from the
 * rv-reversion-rehearsal script to a live module).
 *
 * The strict cointegration gauntlet (`pairsCompetitionStrategy`) is trade-starved on the
 * thin comp universe (one qualifying pair → < the §17 30-trade floor). The validated
 * Best-Sharpe core instead trades the log-ratio z-score of EVERY within-cluster pair (the
 * 5 crypto → 10 pairs; XAU/XAG): dollar-neutral → smooth, breadth → clears the trade floor.
 * Rehearsal: per-bar std 9.7e-4, max DD 2.1%, 2083 trades — the low-variance curve the
 * Sharpe (10%) + Drawdown (15%) ranks reward.
 *
 * Live "what to hold now" sizing is CONTINUOUS + STATELESS (no entry/exit state machine to
 * carry across cycles): the target allocation ramps linearly from 0 at |z|=exitZ to full at
 * |z|=entryZ, sign opposite to z (fade the deviation). This is the OU-proportional shape —
 * largest when the deviation is largest, naturally de-risking toward the mean — and it suits
 * the target-portfolio reconciliation loop (the runner moves holdings to the target each
 * cycle; no hidden position state). Inside |z|<exitZ the pair is flat.
 *
 * Emits the SAME `PairTarget[]` shape as `pairsCompetitionStrategy.pairTargets`, so the
 * barbell + reconciliation layer consume it unchanged. Pure: bars + equity in, targets out.
 *
 * NOT a return-edge claim — ratio reversion didn't clear the deflated bar. Its value is the
 * SHAPE of the curve (smooth, neutral, many small trades).
 */

import type { Mt5Bar } from "../../broker/mt5/bridgeClient.ts";
import { PAIRS_CLUSTERS, type PairTarget } from "./pairsCompetitionStrategy.ts";

export interface RvReversionConfig {
  /** Within-cluster symbol groups (ratio reversion only makes sense inside a cluster). */
  clusters: readonly (readonly string[])[];
  /** Rolling window for the ratio z-score (M15 bars). */
  lookback: number;
  /** |z| at/above which the pair is at full target allocation. */
  entryZ: number;
  /** |z| at/below which the pair is flat. Between exit and entry the target ramps. */
  exitZ: number;
  /** Capital fraction per leg at full conviction (small + dollar-neutral). */
  perPairFraction: number;
  /** Max pairs held at once (breadth cap; the most-stretched win). */
  maxPairs: number;
  /** Min aligned observations before a pair is tradeable. */
  minObs: number;
  /**
   * Max quoted bid-ask spread (bps) for EITHER leg before a pair may be OPENED as taker. A pair
   * whose live leg spread exceeds this is net-negative to enter, so the entry gate skips it.
   * Applies to ENTRIES only — a pair already held can always HOLD/EXIT regardless of spread, and
   * the gate is inert unless the caller passes live `spreadBps` (maker mode earns the spread, so
   * it omits them and the gate stays off). Omit → no gate. Default = RV_NET_NEGATIVE_SPREAD_BPS.
   */
  maxEntrySpreadBps?: number;
}

/**
 * Quoted-spread bands (bps) for the RV book, from the best-sharpe-sweep break-even (~1bp/side
 * cost ≈ a ~2bps quoted spread). SHARED by the entry gate here AND the
 * `competition-spread-check` diagnostic so the live gate and the readiness verdict use the SAME
 * cutoffs:
 *   - `< RV_GOOD_SPREAD_BPS`        → half-spread <1bp → net-positive plausible
 *   - `GOOD .. NET_NEGATIVE`        → ≈break-even — STILL traded (adds breadth toward the §17 floor)
 *   - `>= RV_NET_NEGATIVE_SPREAD_BPS` → clearly net-negative as taker → the entry gate skips it
 */
export const RV_GOOD_SPREAD_BPS = 2;
export const RV_NET_NEGATIVE_SPREAD_BPS = 4;

// Defaults re-validated on the FULL 18-month extended crypto history (not just the 1-month comp
// window, which was regime-specific) via `scripts/competition/analysis/best-sharpe-sweep.ts`, scored on the
// exact §12.5 metric. Across 18 months the net Sharpe is ~0 for ALL configs (cost is the binding
// constraint), so these params are chosen for ROBUSTNESS + the §17 floor, not a Sharpe delta:
// the long lookback (144 ≈ 36h M15) + wide entry minimize the cost churn that dominates this book,
// while entryZ 2.0 keeps ~45 trades over the 5-day window (safe margin over the ≥30 award floor).
export const RV_REVERSION_CONFIG: RvReversionConfig = {
  clusters: PAIRS_CLUSTERS,
  lookback: 144,
  entryZ: 2.0,
  exitZ: 0.5,
  perPairFraction: 0.03, // 3% per leg → many tiny dollar-neutral positions
  maxPairs: 11,
  minObs: 60,
  maxEntrySpreadBps: RV_NET_NEGATIVE_SPREAD_BPS, // don't OPEN a pair whose leg is net-negative as taker
};

const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / (xs.length || 1);
function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / (xs.length - 1));
}

/** Aligned log-ratio spread for two symbols on their common timestamps (chronological). */
function logRatioSpread(barsA: Mt5Bar[], barsB: Mt5Bar[]): number[] {
  const byTimeB = new Map<number, number>();
  for (const b of barsB) if (b.close > 0) byTimeB.set(b.time, b.close);
  const spread: number[] = [];
  for (const a of barsA) {
    if (a.close <= 0) continue;
    const cb = byTimeB.get(a.time);
    if (cb !== undefined) spread.push(Math.log(a.close) - Math.log(cb));
  }
  return spread;
}

interface Candidate {
  symbolA: string;
  symbolB: string;
  key: string;
  z: number;
  alloc: number; // signed: + = long spread (long A / short B), − = short spread
}

/** Per-pair discrete position state for hysteresis: pairKey → −1 | 0 | +1 (spread side held). */
export type RvHysteresisState = Map<string, number>;

const pairKey = (a: string, b: string): string => `${a}/${b}`;

/**
 * Current dollar-neutral targets for the RV-reversion book. For every within-cluster pair
 * with enough aligned history, compute the trailing-window z of the log ratio; keep the
 * `maxPairs` most-stretched, size each leg at |alloc|·perPairFraction·equity (dollar-matched
 * legs → ≈ zero net directional exposure).
 *
 * Two allocation modes:
 *   - CONTINUOUS (no `state`): the OU-proportional fade ramp (legacy, stateless). Re-allocates
 *     every bar — which, validated against the §12.5 metric, CHURNS and bleeds on the spread
 *     cost (the per-bar reconciliation pays the spread on every small target change).
 *   - DISCRETE HYSTERESIS (`state` passed): enter ±1 only at |z|≥entryZ, HOLD through the
 *     reversion, exit only at |z|≤exitZ. This is what the best-Sharpe sweep validated as far
 *     cheaper (it doesn't trade every bar) and the curve-shape we actually want. `state` is the
 *     per-pair held side, mutated in place across cycles by the caller (the live runner owns it;
 *     a capped-out or reverted pair is set back to 0 so the state never diverges from intent).
 */
export function rvPairTargets(
  barsBySymbol: Record<string, Mt5Bar[]>,
  equity: number,
  config: RvReversionConfig = RV_REVERSION_CONFIG,
  state?: RvHysteresisState,
  spreadBps?: Record<string, number>,
): PairTarget[] {
  const denom = config.entryZ - config.exitZ;
  // Entry gate: a leg is "too wide to open" when its live quoted spread exceeds the threshold.
  // Inert unless BOTH a threshold and live spreads are supplied (maker mode omits spreads → off).
  // A missing per-symbol spread defers to the upstream data-availability guard (treated as not-wide).
  const legTooWide = (sym: string): boolean =>
    config.maxEntrySpreadBps != null &&
    spreadBps != null &&
    (spreadBps[sym] ?? 0) > config.maxEntrySpreadBps;
  const candidates: Candidate[] = [];
  const evaluated: string[] = []; // keys seen this cycle (for post-cap state cleanup)

  for (const cluster of config.clusters) {
    const present = cluster.filter((s) => (barsBySymbol[s]?.length ?? 0) > 0);
    for (let i = 0; i < present.length; i++) {
      for (let j = i + 1; j < present.length; j++) {
        const symbolA = present[i]!;
        const symbolB = present[j]!;
        const spread = logRatioSpread(barsBySymbol[symbolA]!, barsBySymbol[symbolB]!);
        if (spread.length < Math.max(config.minObs, config.lookback + 1)) continue;

        const w = spread.slice(-config.lookback);
        const sd = stdev(w);
        if (!(sd > 0)) continue;
        const z = (spread[spread.length - 1]! - mean(w)) / sd;
        const key = pairKey(symbolA, symbolB);
        evaluated.push(key);

        // A pair may only OPEN when neither leg is too wide; a HELD pair is never gated (it can
        // always hold/exit even if a leg's spread blows out — we want OUT, not stuck).
        const entryBlocked = legTooWide(symbolA) || legTooWide(symbolB);

        let alloc: number;
        if (state) {
          // Discrete hysteresis: enter at entryZ, hold until |z|≤exitZ.
          const cur = state.get(key) ?? 0;
          let pos = cur;
          if (cur === 0) {
            if (Math.abs(z) >= config.entryZ && !entryBlocked) pos = -Math.sign(z); // fade: z>0 (rich) → short spread
          } else if (Math.abs(z) <= config.exitZ) {
            pos = 0; // reverted → exit
          }
          alloc = pos;
        } else {
          const mag = denom > 0 ? Math.min(Math.max((Math.abs(z) - config.exitZ) / denom, 0), 1) : Math.abs(z) >= config.entryZ ? 1 : 0;
          // Continuous mode has no held-state, so gating to 0 = never carry a net-negative pair.
          alloc = entryBlocked ? 0 : -Math.sign(z) * mag;
        }
        if (alloc === 0) continue; // flat (inside the exit band / not yet entered)
        candidates.push({ symbolA, symbolB, key, z, alloc });
      }
    }
  }

  // Keep the most-stretched pairs (largest |z|) up to the breadth cap.
  candidates.sort((x, y) => Math.abs(y.z) - Math.abs(x.z));
  const kept = candidates.slice(0, config.maxPairs);

  if (state) {
    // Sync state to what we actually hold: kept → their side; everything else evaluated
    // (flat, or capped out of the breadth limit) → 0, so state never diverges from intent.
    const keptKeys = new Set(kept.map((c) => c.key));
    for (const key of evaluated) state.set(key, keptKeys.has(key) ? Math.sign(candidates.find((c) => c.key === key)!.alloc) : 0);
  }

  const out: PairTarget[] = [];
  for (const c of kept) {
    const legNotional = Math.abs(c.alloc) * config.perPairFraction * equity;
    const longA = c.alloc > 0; // long spread = long A / short B
    out.push({
      symbolA: c.symbolA,
      symbolB: c.symbolB,
      sideA: longA ? "buy" : "sell",
      sideB: longA ? "sell" : "buy",
      notionalA: legNotional,
      notionalB: legNotional, // dollar-matched legs
      allocation: c.alloc,
      regime: "ACTIVE",
    });
  }
  return out;
}
