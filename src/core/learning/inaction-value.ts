/**
 * Inaction-Value Estimator
 *
 * The trading translation of Cognition's "the signal lives outside the diff —
 * the most valuable work sometimes produces no code." For a capital agent, the
 * value that lives outside the trade ledger is CORRECT INACTION: the setup it
 * declined, the risk gate that vetoed, the plan it refused. A P&L ledger only
 * scores trades TAKEN; it is blind to the loss a veto avoided.
 *
 * This scores a DECLINED decision counterfactually — given where it would have
 * entered / stopped / targeted and the price path that followed, what would it
 * have done? A veto that dodged a loss created value; a veto that missed a gain
 * cost value. Sibling to CounterfactualAnalyzer (which does what-if on trades
 * TAKEN); this is the inverse — what-if on trades NOT taken.
 *
 * Pure: the caller supplies the declined decisions + forward candles (same shape
 * as CounterfactualAnalyzer). Recording declined decisions belongs on the
 * existing journal/audit path, not a parallel store.
 */

import type { Candle } from "../../types/index.ts";

export type DecisionSide = "long" | "short";

/** A trade the agent/operator declined. Fields are exactly what a counterfactual
 *  needs: where it would have entered, its bracket, and when the call was made. */
export interface DeclinedDecision {
  id: string;
  symbol: string;
  side: DecisionSide;
  /** Price the declined setup would have entered at. */
  entry: number;
  /** Stop and target. The risk unit is R = |entry − stop|. */
  stop: number;
  target: number;
  /** When the decline happened (ms epoch). The counterfactual runs forward from here. */
  decidedAt: number;
  /** Which gate declined it (e.g. "risk_gate", "verify_plan", "desk_review", "operator"). */
  gate?: string;
}

export type WouldHaveOutcome = "hit_stop" | "hit_target" | "open";

export interface InactionOutcome {
  decision: DeclinedDecision;
  /** What the declined trade WOULD have done within the horizon. */
  wouldHave: WouldHaveOutcome;
  /** R-multiple the declined trade would have returned (negative = would have lost). */
  wouldHaveR: number;
  /** Value of the veto, in R: positive = avoided a loss (correct veto),
   *  negative = missed a gain (wrong veto). Always = −wouldHaveR. */
  vetoValueR: number;
  /** True when the veto avoided a loss. */
  vetoCorrect: boolean;
  candlesToResolve: number;
}

export interface InactionValueReport {
  decisions: number;
  /** Decisions that had forward data + a valid bracket and could be scored. */
  scored: number;
  correctVetoes: number;
  wrongVetoes: number;
  /** correctVetoes / (correct + wrong) — the precision of "no". */
  vetoPrecision: number;
  /** Σ vetoValueR — net value created by declining, in R. */
  netInactionValueR: number;
  /** Σ positive vetoValueR — total loss avoided, in R. */
  avoidedLossR: number;
  /** Σ |negative vetoValueR| — total gain missed, in R. */
  missedGainR: number;
  valuePerDecisionR: number;
  summary: string;
}

/**
 * Score one declined decision by simulating its bracket forward. First-touch
 * wins; a candle that touches BOTH stop and target is resolved conservatively to
 * the STOP (the pessimistic intrabar convention a sound backtester uses — never
 * flatter a veto by assuming the target filled first). Returns null when the
 * bracket is degenerate or there is no forward data to judge against.
 */
export function scoreDeclinedDecision(
  decision: DeclinedDecision,
  forwardCandles: Candle[],
  horizon = 200,
): InactionOutcome | null {
  const r = Math.abs(decision.entry - decision.stop);
  if (r <= 0 || forwardCandles.length === 0) return null;

  const isLong = decision.side === "long";
  // Only candles at/after the decision moment can judge it.
  const start = forwardCandles.findIndex((c) => c.openTime >= decision.decidedAt);
  if (start < 0) return null;
  const limit = Math.min(forwardCandles.length, start + horizon);

  let wouldHave: WouldHaveOutcome = "open";
  let exit = forwardCandles[limit - 1]!.close;
  let candlesToResolve = limit - start;

  for (let i = start; i < limit; i++) {
    const c = forwardCandles[i]!;
    const stopHit = isLong ? c.low <= decision.stop : c.high >= decision.stop;
    const targetHit = isLong ? c.high >= decision.target : c.low <= decision.target;
    if (stopHit) {
      wouldHave = "hit_stop";
      exit = decision.stop;
      candlesToResolve = i - start + 1;
      break;
    }
    if (targetHit) {
      wouldHave = "hit_target";
      exit = decision.target;
      candlesToResolve = i - start + 1;
      break;
    }
  }

  const dir = isLong ? 1 : -1;
  const wouldHaveR = ((exit - decision.entry) / r) * dir;
  return {
    decision,
    wouldHave,
    wouldHaveR,
    vetoValueR: -wouldHaveR,
    vetoCorrect: wouldHaveR < 0,
    candlesToResolve,
  };
}

/** Aggregate scored declined decisions into the inaction-value report. */
export function aggregateInactionValue(
  decisions: number,
  outcomes: InactionOutcome[],
): InactionValueReport {
  const correct = outcomes.filter((o) => o.vetoValueR > 0);
  const wrong = outcomes.filter((o) => o.vetoValueR < 0);
  const avoidedLossR = correct.reduce((s, o) => s + o.vetoValueR, 0);
  const missedGainR = wrong.reduce((s, o) => s - o.vetoValueR, 0);
  const netInactionValueR = outcomes.reduce((s, o) => s + o.vetoValueR, 0);
  const decided = correct.length + wrong.length;

  const summary =
    outcomes.length === 0
      ? `${decisions} declined decisions, none scoreable yet`
      : `${decisions} declined, ${outcomes.length} scored: veto precision ${(decided ? (correct.length / decided) * 100 : 0).toFixed(0)}% ` +
        `(${avoidedLossR.toFixed(2)}R avoided / ${missedGainR.toFixed(2)}R missed); net ${netInactionValueR >= 0 ? "+" : ""}${netInactionValueR.toFixed(2)}R`;

  return {
    decisions,
    scored: outcomes.length,
    correctVetoes: correct.length,
    wrongVetoes: wrong.length,
    vetoPrecision: decided ? correct.length / decided : 0,
    netInactionValueR,
    avoidedLossR,
    missedGainR,
    valuePerDecisionR: outcomes.length ? netInactionValueR / outcomes.length : 0,
    summary,
  };
}
