/**
 * FROZEN PAIRS competition strategy — the BEST-SHARPE core.
 *
 * A dollar-neutral, low-variance spread BOOK built on the integrated 5-layer
 * `runPairsSystem` (Johansen+EG+Hurst select → Kalman dynamic hedge → OU
 * cost-calibrated z → OU-proportional sizing → 3-state cointegration monitor).
 *
 * Whereas `competitionStrategy.ts` is single-instrument TSMOM (per-symbol
 * `SignalFn`), pairs trading is two-leg / cross-instrument: a target is a long of
 * leg A vs a dollar-matched short of leg B (or vice-versa). That does NOT fit the
 * live trader's per-symbol `SignalFn` contract, so this module exposes a
 * pair-level surface instead:
 *
 *   selectPairs(barsBySymbol, opts)  → which pairs are tradeable RIGHT NOW + β.
 *   pairTargets(barsBySymbol, pairs, equity, opts) → the current dollar-neutral
 *                                                    per-leg notionals to hold.
 *
 * The book = many TINY dollar-neutral pair positions. Each pair has near-zero
 * directional beta, so the aggregate equity curve is SMOOTH by construction;
 * breadth across lowly-correlated pairs lifts the Sharpe (IR = IC·√breadth). That
 * smooth, low-DD shape is exactly what the competition's Drawdown (15%) + Sharpe
 * (10%) ranks + the §17 Best-Sharpe Award reward — NOT a claimed return edge.
 *
 * Pure compute: no I/O, no broker. A caller (live driver or rehearsal) supplies
 * aligned bars and equity, and turns the returned per-leg notionals into orders.
 */

import type { Mt5Bar } from "../../broker/mt5/bridgeClient.ts";
import { runPairsSystem, type PairsSystemConfig } from "../quant/pairsSystem.ts";

// ============================================================================
// Frozen config
// ============================================================================

/**
 * The pair candidate universe. Pairs are only viable WITHIN a cointegratable
 * cluster: the metals ratio (XAUUSD/XAGUSD) and the crypto majors among
 * themselves. We do NOT cross clusters (e.g. crypto vs gold) — the cointegration
 * gauntlet would reject them anyway, but enumerating only same-cluster pairs
 * keeps selection cheap and the book economically coherent.
 *
 * Structural rule, not a hardcoded edge: candidates are enumerated from these
 * clusters; the cointegration gauntlet decides which actually trade.
 */
export const PAIRS_CLUSTERS: readonly (readonly string[])[] = [
  ["XAUUSD", "XAGUSD"],
  ["BTCUSD", "ETHUSD", "SOLUSD", "XRPUSD", "BARUSD"],
];

export interface PairsCompetitionConfig {
  /** Max number of pairs held in the book at once (breadth cap). */
  maxPairs: number;
  /**
   * Capital fraction allocated to ONE pair at full conviction, as a fraction of
   * equity per LEG. Small + dollar-neutral: the book is many tiny positions.
   */
  perPairFraction: number;
  /** Desired entry z before the cost floor (passed to runPairsSystem). */
  desiredEntryZ: number;
  /** Round-trip cost in bps across both legs (floor for spread=0 data). */
  costBps: number;
  /**
   * Slow Kalman process-noise delta: stable structural β. A faster delta whitens
   * the spread and kills the tradeable half-life (see pairsSystem note).
   */
  kalmanDelta: number;
  /** Min aligned observations before a pair is evaluable. */
  minObs: number;
  /** Bar timeframe (informational; the comp universe is M15). */
  timeframe: string;
}

/** The FROZEN pairs config for the live week. */
export const PAIRS_COMPETITION_CONFIG: PairsCompetitionConfig = {
  maxPairs: 6,
  // 5% equity per leg at full conviction → a pair at full size is 5% long / 5%
  // short (≈ dollar-neutral, ~0 net directional). 6 pairs → ≤30% gross long /
  // ≤30% gross short, comfortably inside the leverage discipline tiers.
  perPairFraction: 0.05,
  desiredEntryZ: 2.0,
  costBps: 5,
  kalmanDelta: 1e-5,
  minObs: 200,
  timeframe: "M15",
};

// ============================================================================
// Types
// ============================================================================

export interface SelectedPair {
  symbolA: string;
  symbolB: string;
  /** Static Johansen hedge ratio (informational; live β is Kalman per-bar). */
  hedgeRatio: number;
  halfLife: number;
  hurst: number;
  entryZ: number;
  /** Count of aligned observations the selection was computed over. */
  nObs: number;
}

export interface SelectPairsOptions {
  config?: PairsCompetitionConfig;
  /** Restrict candidate symbols (intersected with the clusters). */
  universe?: readonly string[];
}

export interface PairTarget {
  symbolA: string;
  symbolB: string;
  /** Side of leg A. "flat" → close the pair. */
  sideA: "buy" | "sell" | "flat";
  /** Side of leg B (dollar-matched opposite of A; "flat" when sideA is flat). */
  sideB: "buy" | "sell" | "flat";
  /** Target notional on leg A (USD), ≥ 0. 0 when flat. */
  notionalA: number;
  /** Target notional on leg B (USD), ≥ 0, dollar-matched to leg A. 0 when flat. */
  notionalB: number;
  /** Signed allocation that produced this target (for diagnostics). */
  allocation: number;
  /** Current monitor regime gating the pair. */
  regime: string;
}

// ============================================================================
// Helpers
// ============================================================================

/** Inner-join two bar series on epoch time, returning aligned closes (chronological). */
function alignCloses(barsA: Mt5Bar[], barsB: Mt5Bar[]): { closesA: number[]; closesB: number[] } {
  const bByTime = new Map<number, number>();
  for (const b of barsB) {
    if (Number.isFinite(b.close) && b.close > 0) bByTime.set(b.time, b.close);
  }
  const closesA: number[] = [];
  const closesB: number[] = [];
  for (const a of barsA) {
    if (!Number.isFinite(a.close) || a.close <= 0) continue;
    const cb = bByTime.get(a.time);
    if (cb !== undefined) {
      closesA.push(a.close);
      closesB.push(cb);
    }
  }
  return { closesA, closesB };
}

/** Enumerate within-cluster candidate pairs, filtered to the available universe. */
function candidatePairs(
  available: Set<string>,
  universe?: readonly string[],
): Array<[string, string]> {
  const allow = universe ? new Set(universe) : null;
  const pairs: Array<[string, string]> = [];
  for (const cluster of PAIRS_CLUSTERS) {
    const members = cluster.filter((s) => available.has(s) && (!allow || allow.has(s)));
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        pairs.push([members[i]!, members[j]!]);
      }
    }
  }
  return pairs;
}

function pairsSystemConfig(cfg: PairsCompetitionConfig): PairsSystemConfig {
  return {
    desiredEntryZ: cfg.desiredEntryZ,
    costBps: cfg.costBps,
    kalmanDelta: cfg.kalmanDelta,
    maxFraction: 1.0, // sized down to perPairFraction in pairTargets, not here
  };
}

// ============================================================================
// selectPairs — run the cointegration gauntlet over the universe
// ============================================================================

/**
 * Over the candidate (within-cluster) pairs, run the full `runPairsSystem`
 * selection gauntlet (Johansen + Engle-Granger both directions + Hurst < 0.5 +
 * tradeable OU half-life) and return the qualifying pairs with their hedge
 * ratios. Pairs are ranked by half-life (faster mean reversion first, more
 * round-trips → more trades, which the §17 ≥30-trade floor needs) and capped at
 * `config.maxPairs`.
 *
 * Pure: bars in, selected pairs out.
 */
export function selectPairs(
  barsBySymbol: Record<string, Mt5Bar[]>,
  opts: SelectPairsOptions = {},
): SelectedPair[] {
  const cfg = opts.config ?? PAIRS_COMPETITION_CONFIG;
  const available = new Set(Object.keys(barsBySymbol));
  const candidates = candidatePairs(available, opts.universe);
  const sysCfg = pairsSystemConfig(cfg);

  const selected: SelectedPair[] = [];
  for (const [symbolA, symbolB] of candidates) {
    const { closesA, closesB } = alignCloses(barsBySymbol[symbolA]!, barsBySymbol[symbolB]!);
    if (closesA.length < cfg.minObs) continue;

    const sys = runPairsSystem(closesA, closesB, sysCfg);
    if (!sys.selection.selected) continue;

    selected.push({
      symbolA,
      symbolB,
      hedgeRatio: sys.selection.staticHedgeRatio,
      halfLife: sys.selection.halfLife,
      hurst: sys.selection.hurst,
      entryZ: sys.entryZ,
      nObs: closesA.length,
    });
  }

  selected.sort((x, y) => x.halfLife - y.halfLife);
  return selected.slice(0, cfg.maxPairs);
}

// ============================================================================
// pairTargets — current dollar-neutral per-leg notionals for each active pair
// ============================================================================

export interface PairTargetsOptions {
  config?: PairsCompetitionConfig;
}

/**
 * For each selected pair, run `runPairsSystem` over the CURRENT aligned history
 * and read the LAST bar's signed OU-proportional allocation (the system's
 * causal "what to hold now" decision, already monitor-gated: HALTED → flat,
 * WARNING → hold-nothing-new, ACTIVE → may be in a position). Convert that into
 * a dollar-neutral per-leg target sized at `perPairFraction · |allocation|` of
 * equity per leg.
 *
 * Sign convention (matches pairsSystem): allocation > 0 = LONG the spread =
 * long leg A / short leg B; allocation < 0 = short the spread = short A / long B.
 * Leg B notional is dollar-matched to leg A (equal USD per leg → ≈ zero net
 * directional dollar exposure; this is "dollar-neutral", the competition's
 * low-variance lever, not unit-β-neutral).
 *
 * Pure: bars + equity in, per-leg notionals out. Returns ALL pairs (flat ones
 * included with zero notional) so a caller can close positions that went flat.
 */
export function pairTargets(
  barsBySymbol: Record<string, Mt5Bar[]>,
  selectedPairs: SelectedPair[],
  equity: number,
  opts: PairTargetsOptions = {},
): PairTarget[] {
  const cfg = opts.config ?? PAIRS_COMPETITION_CONFIG;
  const sysCfg = pairsSystemConfig(cfg);
  const out: PairTarget[] = [];

  for (const pair of selectedPairs) {
    const a = barsBySymbol[pair.symbolA];
    const b = barsBySymbol[pair.symbolB];
    const flat: PairTarget = {
      symbolA: pair.symbolA,
      symbolB: pair.symbolB,
      sideA: "flat",
      sideB: "flat",
      notionalA: 0,
      notionalB: 0,
      allocation: 0,
      regime: "HALTED",
    };
    if (!a || !b) {
      out.push(flat);
      continue;
    }

    const { closesA, closesB } = alignCloses(a, b);
    if (closesA.length < cfg.minObs) {
      out.push(flat);
      continue;
    }

    const sys = runPairsSystem(closesA, closesB, sysCfg);
    if (!sys.selection.selected || sys.bars.length === 0) {
      out.push(flat);
      continue;
    }

    const last = sys.bars[sys.bars.length - 1]!;
    const alloc = last.allocation; // signed, in [−1, 1] (maxFraction=1)
    const magnitude = Math.min(Math.abs(alloc), 1);

    if (magnitude < 1e-9) {
      out.push({ ...flat, regime: last.regime });
      continue;
    }

    // Dollar-neutral per-leg notional: equal USD on each leg.
    const legNotional = equity * cfg.perPairFraction * magnitude;
    const longSpread = alloc > 0; // long A / short B
    out.push({
      symbolA: pair.symbolA,
      symbolB: pair.symbolB,
      sideA: longSpread ? "buy" : "sell",
      sideB: longSpread ? "sell" : "buy",
      notionalA: legNotional,
      notionalB: legNotional,
      allocation: alloc,
      regime: last.regime,
    });
  }

  return out;
}
