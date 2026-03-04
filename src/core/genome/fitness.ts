/**
 * Strategy Genome Fitness Calculator
 *
 * Computes composite fitness scores for genomes based on
 * their performance metrics. Used to rank variants and
 * determine A/B experiment winners.
 *
 * Fitness formula (weighted 0-100):
 *   - Sharpe ratio:    30% (normalized: Sharpe 2.0 = 100)
 *   - Win rate:        20% (direct percentage)
 *   - Profit factor:   20% (normalized: PF 3.0 = 100)
 *   - Max drawdown:    15% (inverted: lower DD = higher score)
 *   - Trade count:     15% (penalty for too few trades)
 */

import { createModuleLogger } from "../../infra/logger/index.ts";
import type { Genome } from "./types.ts";

const logger = createModuleLogger("genome-fitness");

// ============================================================================
// Constants
// ============================================================================

/** Minimum trades required before fitness is considered reliable */
const MIN_TRADES_THRESHOLD = 10;

/** Weight configuration for the fitness formula */
const WEIGHTS = {
  sharpe: 0.30,
  win_rate: 0.20,
  profit_factor: 0.20,
  max_drawdown: 0.15,
  trade_count: 0.15,
} as const;

/** Normalization targets */
const SHARPE_MAX = 2.0;       // Sharpe 2.0 maps to 100
const PROFIT_FACTOR_MAX = 3.0; // PF 3.0 maps to 100
const DRAWDOWN_MAX = 50;       // 50% drawdown maps to 0
const TRADE_COUNT_IDEAL = 50;  // 50+ trades = full score

// ============================================================================
// FitnessCalculator
// ============================================================================

export class FitnessCalculator {
  /**
   * Calculate a composite fitness score (0-100) for a genome.
   * Uses whichever performance data is available (backtest, paper, live).
   *
   * Returns undefined if insufficient data to calculate.
   */
  calculateFitness(genome: Genome): number | undefined {
    // Determine which performance data to use (prefer live > paper > backtest)
    const sharpe = genome.backtest_sharpe;
    const winRate = genome.live_win_rate ?? genome.paper_win_rate ?? genome.backtest_win_rate;
    const profitFactor = genome.backtest_profit_factor;
    const maxDrawdown = genome.backtest_max_drawdown;
    const totalTrades = genome.live_trades + genome.paper_trades +
      (genome.backtest_win_rate !== undefined ? (genome.backtest_profit_factor !== undefined ? MIN_TRADES_THRESHOLD : 0) : 0);

    // Need at least sharpe or win rate to compute anything meaningful
    if (sharpe === undefined && winRate === undefined) {
      return undefined;
    }

    let score = 0;

    // Sharpe component (30%)
    if (sharpe !== undefined) {
      const normalized = Math.min(100, Math.max(0, (sharpe / SHARPE_MAX) * 100));
      score += normalized * WEIGHTS.sharpe;
    }

    // Win rate component (20%)
    if (winRate !== undefined) {
      const normalized = Math.min(100, Math.max(0, winRate));
      score += normalized * WEIGHTS.win_rate;
    }

    // Profit factor component (20%)
    if (profitFactor !== undefined) {
      const normalized = Math.min(100, Math.max(0, (profitFactor / PROFIT_FACTOR_MAX) * 100));
      score += normalized * WEIGHTS.profit_factor;
    }

    // Max drawdown component (15%) — inverted: lower DD = higher score
    if (maxDrawdown !== undefined) {
      const normalized = Math.min(100, Math.max(0, (1 - maxDrawdown / DRAWDOWN_MAX) * 100));
      score += normalized * WEIGHTS.max_drawdown;
    }

    // Trade count component (15%) — penalize too few trades as unreliable
    if (totalTrades > 0) {
      const normalized = Math.min(100, (totalTrades / TRADE_COUNT_IDEAL) * 100);
      score += normalized * WEIGHTS.trade_count;
    }

    // Clamp to 0-100
    const finalScore = Math.round(Math.min(100, Math.max(0, score)) * 100) / 100;

    logger.debug("Calculated fitness", {
      genome_id: genome.genome_id,
      fitness: String(finalScore),
      sharpe: String(sharpe ?? "N/A"),
      win_rate: String(winRate ?? "N/A"),
    });

    return finalScore;
  }

  /**
   * Compare two genomes and determine which is the winner.
   * Requires minimum trade count to make a decision.
   */
  compareGenomes(
    control: Genome,
    variant: Genome
  ): {
    winner: "control" | "variant" | "undecided";
    reason: string;
    confidence: number;
  } {
    const controlFitness = this.calculateFitness(control) ?? 0;
    const variantFitness = this.calculateFitness(variant) ?? 0;

    // Check minimum trade counts
    const controlTrades = control.live_trades + control.paper_trades;
    const variantTrades = variant.live_trades + variant.paper_trades;

    if (controlTrades < MIN_TRADES_THRESHOLD && variantTrades < MIN_TRADES_THRESHOLD) {
      return {
        winner: "undecided",
        reason: `Both genomes have too few trades (control: ${controlTrades}, variant: ${variantTrades}). Need at least ${MIN_TRADES_THRESHOLD} each.`,
        confidence: 0,
      };
    }

    if (controlTrades < MIN_TRADES_THRESHOLD) {
      return {
        winner: "undecided",
        reason: `Control has too few trades (${controlTrades}). Need at least ${MIN_TRADES_THRESHOLD}.`,
        confidence: 0,
      };
    }

    if (variantTrades < MIN_TRADES_THRESHOLD) {
      return {
        winner: "undecided",
        reason: `Variant has too few trades (${variantTrades}). Need at least ${MIN_TRADES_THRESHOLD}.`,
        confidence: 0,
      };
    }

    // Compare fitness scores
    const fitnessDiff = variantFitness - controlFitness;
    const absDiff = Math.abs(fitnessDiff);

    // Need at least a 5-point difference to declare a clear winner
    if (absDiff < 5) {
      return {
        winner: "undecided",
        reason: `Fitness scores too close: control=${controlFitness.toFixed(1)}, variant=${variantFitness.toFixed(1)} (diff=${absDiff.toFixed(1)})`,
        confidence: absDiff / 100,
      };
    }

    // Confidence based on how large the gap is (5pt gap = 0.3, 20pt gap = 0.8, 50pt gap = 1.0)
    const confidence = Math.min(1, 0.3 + (absDiff - 5) * 0.016);

    if (fitnessDiff > 0) {
      return {
        winner: "variant",
        reason: `Variant wins with fitness ${variantFitness.toFixed(1)} vs control ${controlFitness.toFixed(1)} (+${absDiff.toFixed(1)})`,
        confidence,
      };
    } else {
      return {
        winner: "control",
        reason: `Control wins with fitness ${controlFitness.toFixed(1)} vs variant ${variantFitness.toFixed(1)} (+${absDiff.toFixed(1)})`,
        confidence,
      };
    }
  }

  /**
   * Rank genomes by fitness score (highest first).
   * Genomes without fitness scores are placed at the end.
   */
  rankGenomes(genomes: Genome[]): Genome[] {
    // Compute fitness for any genome that does not have one yet
    const scored = genomes.map((g) => ({
      genome: g,
      fitness: g.fitness_score ?? this.calculateFitness(g) ?? -1,
    }));

    scored.sort((a, b) => b.fitness - a.fitness);
    return scored.map((s) => s.genome);
  }
}
