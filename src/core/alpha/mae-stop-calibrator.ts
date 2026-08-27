/**
 * MAE Calibrator + Stop Optimizer — closes the loop on Gordon's existing
 * MAE/FTA stack.
 *
 * Premise (Kyna Kosling via Jaimin Marfatia, Feb 2026; Tom Dante "Stop
 * Moaning"; Sweeney 1990s): if your historical WINNERS never drew down
 * past X% before turning profitable, then a stop placed at X% is wasted
 * risk. Tighten it, lose less on losers without sacrificing winners,
 * improve R:R immediately. This primitive consumes a closed-trade ledger
 * and recommends an empirically-calibrated stop.
 *
 * Companion to:
 *   - `infra/trading/quant/faeFtaCut.ts` (TM1)        LIVE early-cut decision
 *                                                     given a pre-set FTA
 *                                                     threshold. This primitive
 *                                                     PRODUCES that threshold.
 *   - `core/backtesting/simulator.ts`                 already tracks
 *                                                     max_favorable / max_adverse
 *                                                     per trade — the raw data
 *                                                     this primitive consumes.
 *
 * Inputs: trade ledger with per-trade
 *   (entryPrice, exitPrice, side, maxAdverseExcursionPct, maxFavorableExcursionPct).
 * If excursions are not pre-computed, caller can pass
 *   (highWhileOpen, lowWhileOpen) and the primitive computes them.
 *
 * Outputs:
 *   - Winner / loser MAE distributions (mean, median, P75, P90, P95, P99)
 *   - Winner / loser MFE distributions
 *   - Recommended tight stop = `tightStopPercentile` of winner MAE (default P95)
 *   - Counterfactual (when `currentStopPct` supplied):
 *       * winnersPreservedAtNewStop / winnersLostAtNewStop
 *       * estimatedSavedDollarsOnLosers (sum of loser exits that would have
 *         been cut earlier at the proposed stop)
 *   - Verdict: tighten_stop_recommended / current_stop_is_appropriate /
 *              widen_stop_needed / insufficient_data
 *
 * Distinct from:
 *   - `conviction-filtered-expectancy.ts` (external conviction score filter)
 *   - `trade-consistency.ts`              (per-trade discipline grading)
 *   - `constraint-identifier.ts`          (EV decomposition, not excursion)
 *   - `stall-cut-tracker.ts` (LV29)       (live post-entry stall, not stop calibration)
 *
 * Pure function. No I/O. Pedigree: Sweeney 1990s MAE/MFE → Tom Dante /
 * Spicy / Kyna Kosling popularization.
 */

export type CalibratorSide = "LONG" | "SHORT";

export interface CalibratorTrade {
  /** Free-form id for diagnostic echo. */
  tradeId: string;
  side: CalibratorSide;
  entryPrice: number;
  exitPrice: number;
  /**
   * Maximum adverse excursion as a POSITIVE fraction (e.g. 0.025 = 2.5%
   * worst drawdown vs entry, in the position's adverse direction).
   * If absent, caller must supply highWhileOpen + lowWhileOpen.
   */
  maxAdverseExcursionPct?: number;
  /** Maximum favorable excursion as a POSITIVE fraction. */
  maxFavorableExcursionPct?: number;
  /** Highest price observed while the position was open. */
  highWhileOpen?: number;
  /** Lowest price observed while the position was open. */
  lowWhileOpen?: number;
  /**
   * Optional explicit outcome label. If absent, computed from
   * (exitPrice − entryPrice) sign relative to side.
   */
  outcome?: "winner" | "loser" | "breakeven";
}

export interface MaeStopCalibratorOptions {
  /**
   * Percentile of winner MAE used as the recommended tight stop.
   * Default 0.95 (preserve 95% of winners).
   */
  tightStopPercentile?: number;
  /**
   * Current stop as a POSITIVE fraction (e.g. 0.05 = 5%). If supplied,
   * unlocks the counterfactual comparison.
   */
  currentStopPct?: number;
  /** Minimum number of winners required for a recommendation. Default 10. */
  minWinners?: number;
  /**
   * Tolerance band for `current_stop_is_appropriate`. If recommended stop
   * is within this fraction of current stop, the verdict stays. Default 0.15.
   */
  appropriateToleranceFraction?: number;
  /**
   * Breakeven epsilon — exitPrice within this fraction of entryPrice is
   * classified breakeven (excluded from winner/loser bins). Default 0.0005.
   */
  breakevenEpsilon?: number;
}

export interface ExcursionDistribution {
  count: number;
  mean: number;
  median: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
}

export interface PerTradeExcursion {
  tradeId: string;
  side: CalibratorSide;
  outcome: "winner" | "loser" | "breakeven";
  mae: number;
  mfe: number;
}

export type MaeCalibratorVerdict =
  | "tighten_stop_recommended"
  | "current_stop_is_appropriate"
  | "widen_stop_needed"
  | "insufficient_data";

export interface MaeStopCalibratorResult {
  totalTrades: number;
  winners: number;
  losers: number;
  breakevens: number;
  perTrade: PerTradeExcursion[];
  winnerMae: ExcursionDistribution | null;
  loserMae: ExcursionDistribution | null;
  winnerMfe: ExcursionDistribution | null;
  loserMfe: ExcursionDistribution | null;
  /** Recommended tight stop fraction (e.g. 0.025 = 2.5%). */
  recommendedTightStopPct: number | null;
  currentStopPct: number | null;
  counterfactual: {
    winnersPreservedAtNewStop: number;
    winnersLostAtNewStop: number;
    losersCutEarlierAtNewStop: number;
    /** Estimated saved dollars on losers, assuming entry price = 1 unit per trade. */
    estimatedSavedFractionOnLosers: number;
  } | null;
  verdict: MaeCalibratorVerdict;
  summary: string;
}

const DEFAULT_TIGHT_PERCENTILE = 0.95;
const DEFAULT_MIN_WINNERS = 10;
const DEFAULT_TOLERANCE = 0.15;
const DEFAULT_BREAKEVEN_EPSILON = 0.0005;

function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  const frac = idx - lo;
  return sorted[lo]! * (1 - frac) + sorted[hi]! * frac;
}

function distributionOf(values: number[]): ExcursionDistribution | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((s, v) => s + v, 0);
  const mean = sum / sorted.length;
  return {
    count: sorted.length,
    mean: parseFloat(mean.toFixed(6)),
    median: parseFloat(quantile(sorted, 0.5).toFixed(6)),
    p75: parseFloat(quantile(sorted, 0.75).toFixed(6)),
    p90: parseFloat(quantile(sorted, 0.9).toFixed(6)),
    p95: parseFloat(quantile(sorted, 0.95).toFixed(6)),
    p99: parseFloat(quantile(sorted, 0.99).toFixed(6)),
    min: parseFloat(sorted[0]!.toFixed(6)),
    max: parseFloat(sorted[sorted.length - 1]!.toFixed(6)),
  };
}

function computeExcursions(t: CalibratorTrade): { mae: number; mfe: number } {
  if (t.maxAdverseExcursionPct !== undefined && t.maxFavorableExcursionPct !== undefined) {
    return {
      mae: Math.max(0, t.maxAdverseExcursionPct),
      mfe: Math.max(0, t.maxFavorableExcursionPct),
    };
  }
  if (t.highWhileOpen !== undefined && t.lowWhileOpen !== undefined && t.entryPrice > 0) {
    let mae: number;
    let mfe: number;
    if (t.side === "LONG") {
      mae = (t.entryPrice - t.lowWhileOpen) / t.entryPrice;
      mfe = (t.highWhileOpen - t.entryPrice) / t.entryPrice;
    } else {
      mae = (t.highWhileOpen - t.entryPrice) / t.entryPrice;
      mfe = (t.entryPrice - t.lowWhileOpen) / t.entryPrice;
    }
    return { mae: Math.max(0, mae), mfe: Math.max(0, mfe) };
  }
  return { mae: 0, mfe: 0 };
}

function classifyOutcome(t: CalibratorTrade, epsilon: number): "winner" | "loser" | "breakeven" {
  if (t.outcome) return t.outcome;
  if (t.entryPrice <= 0) return "breakeven";
  const pnl =
    t.side === "LONG"
      ? (t.exitPrice - t.entryPrice) / t.entryPrice
      : (t.entryPrice - t.exitPrice) / t.entryPrice;
  if (Math.abs(pnl) <= epsilon) return "breakeven";
  return pnl > 0 ? "winner" : "loser";
}

export function calibrateMaeStop(
  trades: ReadonlyArray<CalibratorTrade>,
  options: MaeStopCalibratorOptions = {},
): MaeStopCalibratorResult {
  const tightP = options.tightStopPercentile ?? DEFAULT_TIGHT_PERCENTILE;
  const minWinners = options.minWinners ?? DEFAULT_MIN_WINNERS;
  const tolerance = options.appropriateToleranceFraction ?? DEFAULT_TOLERANCE;
  const epsilon = options.breakevenEpsilon ?? DEFAULT_BREAKEVEN_EPSILON;
  const currentStop = options.currentStopPct ?? null;

  const perTrade: PerTradeExcursion[] = [];
  const winnerMaeValues: number[] = [];
  const loserMaeValues: number[] = [];
  const winnerMfeValues: number[] = [];
  const loserMfeValues: number[] = [];
  let winners = 0;
  let losers = 0;
  let breakevens = 0;

  for (const t of trades) {
    const outcome = classifyOutcome(t, epsilon);
    const { mae, mfe } = computeExcursions(t);
    perTrade.push({
      tradeId: t.tradeId,
      side: t.side,
      outcome,
      mae: parseFloat(mae.toFixed(6)),
      mfe: parseFloat(mfe.toFixed(6)),
    });
    if (outcome === "winner") {
      winners++;
      winnerMaeValues.push(mae);
      winnerMfeValues.push(mfe);
    } else if (outcome === "loser") {
      losers++;
      loserMaeValues.push(mae);
      loserMfeValues.push(mfe);
    } else {
      breakevens++;
    }
  }

  if (winners < minWinners) {
    return {
      totalTrades: trades.length,
      winners,
      losers,
      breakevens,
      perTrade,
      winnerMae: distributionOf(winnerMaeValues),
      loserMae: distributionOf(loserMaeValues),
      winnerMfe: distributionOf(winnerMfeValues),
      loserMfe: distributionOf(loserMfeValues),
      recommendedTightStopPct: null,
      currentStopPct: currentStop,
      counterfactual: null,
      verdict: "insufficient_data",
      summary: `Need ≥${minWinners} winners for calibration (have ${winners}).`,
    };
  }

  const winnerMaeSorted = [...winnerMaeValues].sort((a, b) => a - b);
  const recommendedStop = quantile(winnerMaeSorted, tightP);

  let counterfactual: MaeStopCalibratorResult["counterfactual"] = null;
  if (currentStop !== null) {
    const winnersPreserved = winnerMaeValues.filter((m) => m <= recommendedStop).length;
    const winnersLost = winners - winnersPreserved;
    // Losers that would have hit the new tighter stop earlier: those whose
    // MAE under current stop ≥ recommendedStop (i.e. drew down enough to
    // trigger the proposed stop). Saved fraction: per loser, the current
    // realized loss minus the proposed stop (capped at zero — if their loss
    // was smaller than the proposed stop, no savings).
    let losersCutEarlier = 0;
    let savedFraction = 0;
    for (let i = 0; i < perTrade.length; i++) {
      const p = perTrade[i]!;
      if (p.outcome !== "loser") continue;
      const t = trades[i]!;
      const realizedLoss =
        t.side === "LONG"
          ? Math.max(0, (t.entryPrice - t.exitPrice) / t.entryPrice)
          : Math.max(0, (t.exitPrice - t.entryPrice) / t.entryPrice);
      if (p.mae >= recommendedStop && realizedLoss > recommendedStop) {
        losersCutEarlier++;
        savedFraction += realizedLoss - recommendedStop;
      }
    }
    counterfactual = {
      winnersPreservedAtNewStop: winnersPreserved,
      winnersLostAtNewStop: winnersLost,
      losersCutEarlierAtNewStop: losersCutEarlier,
      estimatedSavedFractionOnLosers: parseFloat(savedFraction.toFixed(6)),
    };
  }

  let verdict: MaeCalibratorVerdict;
  if (currentStop === null) {
    verdict = "tighten_stop_recommended";
  } else {
    const ratio = recommendedStop / currentStop;
    if (Math.abs(1 - ratio) <= tolerance) verdict = "current_stop_is_appropriate";
    else if (recommendedStop < currentStop) verdict = "tighten_stop_recommended";
    else verdict = "widen_stop_needed";
  }

  let summary: string;
  if (verdict === "tighten_stop_recommended") {
    summary =
      `TIGHTEN STOP — winners' P${(tightP * 100).toFixed(0)} MAE is ` +
      `${(recommendedStop * 100).toFixed(2)}%` +
      (currentStop !== null ? ` vs current stop ${(currentStop * 100).toFixed(2)}%` : "") +
      `. ${counterfactual ? `Counterfactual: ${counterfactual.winnersPreservedAtNewStop}/${winners} winners preserved, ` + `${counterfactual.losersCutEarlierAtNewStop} losers cut earlier, ` + `≈${(counterfactual.estimatedSavedFractionOnLosers * 100).toFixed(2)}% of capital saved.` : ""}`;
  } else if (verdict === "current_stop_is_appropriate") {
    summary =
      `Current stop ${(currentStop! * 100).toFixed(2)}% is within ` +
      `${(tolerance * 100).toFixed(0)}% of empirical P${(tightP * 100).toFixed(0)} ` +
      `winner MAE (${(recommendedStop * 100).toFixed(2)}%). No change.`;
  } else if (verdict === "widen_stop_needed") {
    summary =
      `WIDEN STOP — empirical P${(tightP * 100).toFixed(0)} winner MAE is ` +
      `${(recommendedStop * 100).toFixed(2)}%, exceeds current stop ` +
      `${(currentStop! * 100).toFixed(2)}%. Current stop is cutting winners.`;
  } else {
    summary = `Insufficient data (${winners} winners).`;
  }

  return {
    totalTrades: trades.length,
    winners,
    losers,
    breakevens,
    perTrade,
    winnerMae: distributionOf(winnerMaeValues),
    loserMae: distributionOf(loserMaeValues),
    winnerMfe: distributionOf(winnerMfeValues),
    loserMfe: distributionOf(loserMfeValues),
    recommendedTightStopPct: parseFloat(recommendedStop.toFixed(6)),
    currentStopPct: currentStop,
    counterfactual,
    verdict,
    summary,
  };
}

export function formatMaeStopCalibrator(result: MaeStopCalibratorResult): string {
  const fmtPct = (v: number | null | undefined): string =>
    v === null || v === undefined ? "n/a" : `${(v * 100).toFixed(2)}%`;
  const fmtDist = (d: ExcursionDistribution | null): string =>
    d === null
      ? "  (none)"
      : `  n=${d.count}  mean=${fmtPct(d.mean)}  median=${fmtPct(d.median)}  ` +
        `P75=${fmtPct(d.p75)}  P90=${fmtPct(d.p90)}  P95=${fmtPct(d.p95)}  P99=${fmtPct(d.p99)}`;
  const lines = [
    `MAE Stop Calibrator — ${result.verdict.toUpperCase()}`,
    "",
    `  Total trades:        ${result.totalTrades}`,
    `  Winners / losers:    ${result.winners} / ${result.losers}  (${result.breakevens} BE)`,
    `  Current stop:        ${fmtPct(result.currentStopPct)}`,
    `  Recommended stop:    ${fmtPct(result.recommendedTightStopPct)}`,
    "",
    `  Winner MAE distribution:`,
    fmtDist(result.winnerMae),
    `  Loser MAE distribution:`,
    fmtDist(result.loserMae),
    `  Winner MFE distribution:`,
    fmtDist(result.winnerMfe),
    `  Loser MFE distribution:`,
    fmtDist(result.loserMfe),
  ];
  if (result.counterfactual) {
    lines.push("");
    lines.push(`  Counterfactual at recommended stop:`);
    lines.push(
      `    Winners preserved: ${result.counterfactual.winnersPreservedAtNewStop} / ${result.winners}`,
    );
    lines.push(`    Winners lost:      ${result.counterfactual.winnersLostAtNewStop}`);
    lines.push(`    Losers cut early:  ${result.counterfactual.losersCutEarlierAtNewStop}`);
    lines.push(
      `    Saved fraction:    ${fmtPct(result.counterfactual.estimatedSavedFractionOnLosers)}`,
    );
  }
  lines.push("");
  lines.push(`Summary: ${result.summary.trim()}`);
  return lines.join("\n");
}
