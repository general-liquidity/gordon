/**
 * Barbell strategy orchestrator — the competition's top-level decision function.
 *
 * The research converged on a barbell, not a single posture:
 *   • CORE (always on): a dollar-neutral relative-value pairs book — smooth, low-DD,
 *     ≥30 trades. This is the +EV-in-skill play: it wins the UNCONTESTED Best-Sharpe
 *     prize (10%) + the Drawdown rank (15%) + survives the Top-100 cut, because the
 *     rest of the field is gambling for the return rank and tanking their Sharpes.
 *   • SLEEVE (late, ring-fenced, conditional): ONE concentrated leveraged directional
 *     bet — a cheap call option on the #1 return prize (70%, a pure variance lottery
 *     with no edge). Deployed ONLY when tournament theory says to swing: post-cut AND
 *     lagging (the bang-bang `max_variance` stance), sized so its worst case cannot
 *     red-line the core or disqualify the Sharpe prize.
 *
 * This module is the PURE decision layer — it composes the five validated primitives
 * (selectPairs/pairTargets, rankTracker, ringFence, liquidationGuard, realizedVol) into
 * one call: given the current bars, equity, our standing, and contest phase, return the
 * core pair targets + an optional sleeve order. The caller turns these into MT5 orders.
 *
 * Why ring-fence + liquidation guard gate the sleeve: forced liquidation = elimination,
 * AND a red-line breach disqualifies the Best-Sharpe prize. So the sleeve is capped at
 * the carved reserve (ring-fence) and its leverage at the survival ceiling (liquidation
 * guard) — a losing sleeve leaves the core's smooth curve fully intact.
 */

import type { Mt5Bar } from "../../broker/mt5/bridgeClient.ts";
import {
  selectPairs,
  pairTargets,
  PAIRS_COMPETITION_CONFIG,
  type PairTarget,
  type PairsCompetitionConfig,
} from "./pairsCompetitionStrategy.ts";
import { rvPairTargets, RV_REVERSION_CONFIG, type RvReversionConfig, type RvHysteresisState } from "./rvReversionCore.ts";
import {
  assessStanding,
  DEFAULT_FIELD,
  type FieldModel,
  type StandingSignal,
} from "./rankTracker.ts";
import {
  createRingFence,
  canDeploySleeve,
  type RingFenceState,
} from "./ringFence.ts";
import { maxSafeLeverage } from "./liquidationGuard.ts";
import { realizedVol } from "./inverseVolSizer.ts";

/** Instruments eligible for the lottery sleeve — highest-vol crypto (most leaderboard leverage). */
export const SLEEVE_UNIVERSE: readonly string[] = ["SOLUSD", "XRPUSD", "BTCUSD", "ETHUSD", "BARUSD", "XAGUSD"];

export interface BarbellConfig {
  /** Fraction of total equity carved into the lottery-sleeve reserve. Default 0.08. */
  sleeveFraction: number;
  /** Red-line equity (forced-liquidation / DQ floor) as a fraction of starting equity. Default 0.5. */
  redLineFraction: number;
  /** Max acceptable probability the sleeve liquidates before the deadline. Default 0.10. */
  sleeveMaxBreachProb: number;
  /**
   * Core engine. "rv" (DEFAULT) = relaxed relative-value reversion over all within-cluster
   * ratio pairs — the validated ≥30-trade smooth Best-Sharpe vehicle. "strict" = the
   * cointegration gauntlet (`pairsCompetitionStrategy`) — fewer, higher-conviction pairs but
   * trade-starved on the thin comp universe.
   */
  core: "rv" | "strict";
  /** RV-reversion core config (used when core="rv"). */
  rvConfig: RvReversionConfig;
  /** Strict pairs-core config (used when core="strict"). */
  pairsConfig: PairsCompetitionConfig;
}

export const BARBELL_CONFIG: BarbellConfig = {
  sleeveFraction: 0.08,
  redLineFraction: 0.5,
  sleeveMaxBreachProb: 0.1,
  core: "rv",
  rvConfig: RV_REVERSION_CONFIG,
  pairsConfig: PAIRS_COMPETITION_CONFIG,
};

export interface SleeveOrder {
  symbol: string;
  side: "buy" | "sell";
  /** Notional exposure (USD) = margin · leverage. */
  notional: number;
  /** Leverage, capped at the liquidation-safe ceiling. */
  leverage: number;
  /** Margin committed from the sleeve reserve (= worst-case loss). */
  margin: number;
  reason: string;
}

export interface BarbellDecision {
  /** Always-on dollar-neutral pairs book (the Best-Sharpe core). */
  core: PairTarget[];
  /** The one lottery bet, or null when tournament gating says don't swing. */
  sleeve: SleeveOrder | null;
  /** Our estimated standing + bang-bang stance. */
  standing: StandingSignal;
  /** The ring-fence accounting (core vs sleeve reserve). */
  ringFence: RingFenceState;
  /** Top-level explanation of the decision. */
  reason: string;
}

export interface BarbellInput {
  /** Recent bars per symbol (the live lookback window). */
  barsBySymbol: Record<string, Mt5Bar[]>;
  /** Current account equity. */
  equity: number;
  /** Starting equity (for the red-line + return calc). */
  startingEquity: number;
  /** Our return so far (fraction), for standing estimation. */
  ourReturnPct: number;
  /** Bars remaining until the contest deadline (for liquidation horizon). */
  barsToDeadline: number;
  /** Contest phase — the cut gate. */
  phase: "pre_cut" | "post_cut";
  /** Field model for percentile estimation (or supply a live leaderboard upstream). */
  field?: FieldModel;
  config?: BarbellConfig;
  /**
   * Per-pair hysteresis state for the "rv" core. When supplied, the RV book uses DISCRETE
   * entry/exit hysteresis (hold through the reversion — validated as far cheaper than the
   * continuous fade, which churns and bleeds on cost). The caller (live runner) owns and
   * persists this Map across cycles; it is mutated in place. Omit → legacy continuous fade.
   */
  rvState?: RvHysteresisState;
}

/**
 * The top-level barbell decision. Pure: bars + state in, targets + optional sleeve out.
 *
 * Core runs every cycle (it IS the strategy). The sleeve is gated by THREE independent
 * conditions, ALL required:
 *   1. tournament stance is `max_variance` (post-cut AND lagging — per the bang-bang rule;
 *      if leading or pre-cut, swinging is dominated → no sleeve),
 *   2. the ring-fence has undeployed reserve, and
 *   3. a liquidation-safe leverage exists for the chosen instrument before the deadline.
 * The sleeve is then sized at the FULL reserve as margin (worst case = the reserve, which
 * the ring-fence guarantees cannot breach the red-line), levered up to the safe ceiling.
 */
export function barbellDecision(input: BarbellInput): BarbellDecision {
  const cfg = input.config ?? BARBELL_CONFIG;
  const field = input.field ?? DEFAULT_FIELD;
  const redLineEquity = cfg.redLineFraction * input.startingEquity;

  const ringFence = createRingFence({
    totalEquity: input.equity,
    sleeveFraction: cfg.sleeveFraction,
    redLineEquity,
  });

  // ── CORE: dollar-neutral book, sized off the core equity (not the sleeve). ──
  // "rv" = relaxed ratio-reversion (the validated ≥30-trade smooth vehicle); "strict" =
  // cointegration gauntlet (higher conviction, trade-starved on the thin comp universe).
  const core =
    cfg.core === "strict"
      ? pairTargets(input.barsBySymbol, selectPairs(input.barsBySymbol, { config: cfg.pairsConfig }), ringFence.coreEquity, { config: cfg.pairsConfig })
      : rvPairTargets(input.barsBySymbol, ringFence.coreEquity, cfg.rvConfig, input.rvState);

  // ── STANDING: bang-bang stance. ──
  const standing = assessStanding({ ourReturn: input.ourReturnPct, field, phase: input.phase });

  // ── SLEEVE: only when the stance says swing AND we're past the cut. ──
  // The one-shot lottery is a POST-cut instrument: pre-cut, even when lagging
  // (max_variance), we recover via the core and protect the cut — we do NOT burn the
  // single leveraged bet early (no time-pressure yet, and a blow-up forfeits the cut).
  let sleeve: SleeveOrder | null = null;
  let sleeveReason = "";
  if (input.phase !== "post_cut") {
    sleeveReason = `no sleeve — pre-cut (clear the Top-100 cut on the core first; sleeve is a final-days instrument)`;
  } else if (standing.stance !== "max_variance") {
    sleeveReason = `no sleeve — stance ${standing.stance} (leading/safe → lock in; swinging is dominated)`;
  } else {
    // Pick the highest-vol sleeve instrument with usable bars (most leaderboard leverage).
    let best: { symbol: string; vol: number; closes: number[] } | null = null;
    for (const sym of SLEEVE_UNIVERSE) {
      const bars = input.barsBySymbol[sym];
      if (!bars || bars.length < 30) continue;
      const closes = bars.map((b) => b.close);
      const vol = realizedVol(closes);
      if (vol > 0 && (best === null || vol > best.vol)) best = { symbol: sym, vol, closes };
    }
    if (!best) {
      sleeveReason = "no sleeve — no eligible high-vol instrument with usable bars";
    } else {
      // Per-bar vol from the annualized realizedVol (de-annualize: ÷ √(bars/year, 15m)).
      const perBarVol = best.vol / Math.sqrt(96 * 365);
      const safeLev = maxSafeLeverage({
        perBarVol,
        barsToDeadline: input.barsToDeadline,
        maxBreachProb: cfg.sleeveMaxBreachProb,
      });
      const leverage = Math.max(1, Math.min(safeLev, 30)); // cap at the venue's 30×
      const margin = ringFence.sleeveReserve; // commit the full carved reserve as worst-case
      const notional = margin * leverage;
      const deploy = canDeploySleeve(ringFence, notional, leverage);
      if (!deploy.allowed) {
        sleeveReason = `no sleeve — ${deploy.reason}`;
      } else {
        // No edge → direction is a coin flip; ride the recent move (momentum sign) as the tiebreak.
        const last = best.closes[best.closes.length - 1]!;
        const prior = best.closes[Math.max(0, best.closes.length - 12)]!;
        const side: "buy" | "sell" = last >= prior ? "buy" : "sell";
        sleeve = {
          symbol: best.symbol,
          side,
          notional,
          leverage,
          margin,
          reason: `lagging post-cut swing: ${best.symbol} ${side} ${leverage.toFixed(1)}× (safe-lev ${Number.isFinite(safeLev) ? safeLev.toFixed(1) : "∞"}, worst-case ${margin.toFixed(0)} ≤ reserve)`,
        };
        sleeveReason = sleeve.reason;
      }
    }
  }

  const reason =
    `core: ${core.filter((p) => p.sideA !== "flat").length}/${core.length} pairs active (${ringFence.coreEquity.toFixed(0)} equity); ` +
    `standing: rank≈${standing.estimatedRank}/${field.n} (${(standing.percentile * 100).toFixed(0)}pct, ${standing.stance}); ` +
    `sleeve: ${sleeve ? "DEPLOYED" : "none"} — ${sleeveReason}`;

  return { core, sleeve, standing, ringFence, reason };
}
