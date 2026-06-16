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
}

export const RV_REVERSION_CONFIG: RvReversionConfig = {
  clusters: PAIRS_CLUSTERS,
  lookback: 48,
  entryZ: 1.5,
  exitZ: 0.5,
  perPairFraction: 0.03, // 3% per leg → many tiny dollar-neutral positions
  maxPairs: 11,
  minObs: 60,
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
  z: number;
  alloc: number; // signed: + = long spread (long A / short B), − = short spread
}

/**
 * Current dollar-neutral targets for the RV-reversion book. For every within-cluster pair
 * with enough aligned history, compute the trailing-window z of the log ratio and the
 * continuous fade allocation; keep the `maxPairs` most-stretched, size each leg at
 * |alloc|·perPairFraction·equity (dollar-matched legs → ≈ zero net directional exposure).
 */
export function rvPairTargets(
  barsBySymbol: Record<string, Mt5Bar[]>,
  equity: number,
  config: RvReversionConfig = RV_REVERSION_CONFIG,
): PairTarget[] {
  const denom = config.entryZ - config.exitZ;
  const candidates: Candidate[] = [];

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

        const mag = denom > 0 ? Math.min(Math.max((Math.abs(z) - config.exitZ) / denom, 0), 1) : Math.abs(z) >= config.entryZ ? 1 : 0;
        if (mag <= 0) continue; // inside the exit band → flat
        const alloc = -Math.sign(z) * mag; // fade: z>0 (ratio rich) → short spread
        candidates.push({ symbolA, symbolB, z, alloc });
      }
    }
  }

  // Keep the most-stretched pairs (largest |z|) up to the breadth cap.
  candidates.sort((x, y) => Math.abs(y.z) - Math.abs(x.z));
  const kept = candidates.slice(0, config.maxPairs);

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
