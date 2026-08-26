/**
 * Strategy Genome Types
 *
 * Type definitions for the evolutionary playbook system.
 * Genomes track playbook variants, their mutations, lineage,
 * and performance through backtesting, paper trading, and live trading.
 *
 * Uses Zod schemas for runtime validation.
 */

import { z } from "zod";

// ============================================================================
// Mutation
// ============================================================================

/**
 * A mutation is a specific parameter change applied to a playbook.
 */
export const MutationSchema = z.object({
  /** Unique mutation identifier */
  mutation_id: z.string().uuid(),
  /** Dot-notation path into the protocol: "entry.indicators.0.params.period" */
  field_path: z.string(),
  /** Human-readable parameter name: "RSI period" */
  parameter_name: z.string(),
  /** Original value before mutation */
  from_value: z.unknown(),
  /** New value after mutation */
  to_value: z.unknown(),
  /** Category of mutation */
  mutation_type: z.enum([
    "nudge",   // small parameter change (+/-10-20%)
    "shift",   // larger parameter change (+/-30-50%)
    "swap",    // replace one indicator/method with another
    "add",     // add a new condition/filter
    "remove",  // remove a condition/filter
  ]),
  /** Why this mutation was suggested (agent-provided) */
  reason: z.string(),
  /** Which agent suggested it: "Analyst", "Backtester", "user" */
  suggested_by: z.string(),
  /** When this mutation was created */
  created_at: z.string().datetime(),
});
export type Mutation = z.infer<typeof MutationSchema>;

// ============================================================================
// Genome
// ============================================================================

/**
 * A genome is a playbook variant with evolutionary metadata.
 * Tracks lineage, status lifecycle, and performance metrics across
 * backtesting, paper trading, and live trading stages.
 */
export const GenomeSchema = z.object({
  /** Unique genome identifier */
  genome_id: z.string().uuid(),
  /** The playbook this genome represents (by name/ID) */
  playbook_name: z.string(),

  // ---- Lineage ----
  /** Parent genome ID (if forked from another genome) */
  parent_genome_id: z.string().uuid().optional(),
  /** Generation number (0 = original, 1 = first fork, etc.) */
  generation: z.number().default(0),
  /** Mutations applied from parent to create this genome */
  mutations_from_parent: z.array(MutationSchema),

  // ---- Status ----
  /** Lifecycle status of this genome */
  status: z.enum([
    "candidate",      // just created, not yet tested
    "backtesting",    // being backtested
    "paper_trading",  // running in paper mode
    "live",           // promoted to live trading
    "deprecated",     // superseded by a better variant
    "rejected",       // failed testing, will not be used
  ]),

  // ---- Backtest Performance ----
  /** Annualized Sharpe. `FitnessCalculator` scores it against a target of 2.0,
   *  which is an annualized number. */
  backtest_sharpe: z.number().optional(),
  /** Win rate as a PERCENT in [0, 100], matching `paper_win_rate` and
   *  `live_win_rate`. Bounded because the three feed one clamped fitness term:
   *  a fraction written here (0.55 for 55%) scores 0.55 out of 100 and the
   *  genome is under-weighted 100x with nothing raising an error. */
  backtest_win_rate: z.number().min(0).max(100).optional(),
  backtest_profit_factor: z.number().optional(),
  /** Max drawdown as a PERCENT in [0, 100]. `FitnessCalculator` divides it by
   *  a DRAWDOWN_MAX of 50, which is a percent. */
  backtest_max_drawdown: z.number().min(0).max(100).optional(),

  // ---- Paper Trading Performance ----
  paper_trades: z.number().default(0),
  paper_pnl: z.number().default(0),
  /** Win rate as a PERCENT in [0, 100]. See `backtest_win_rate`. */
  paper_win_rate: z.number().min(0).max(100).optional(),

  // ---- Live Trading Performance ----
  live_trades: z.number().default(0),
  live_pnl: z.number().default(0),
  /** Win rate as a PERCENT in [0, 100]. See `backtest_win_rate`. */
  live_win_rate: z.number().min(0).max(100).optional(),

  // ---- Composite Fitness ----
  /** Fitness score 0-100, computed from weighted performance metrics */
  fitness_score: z.number().optional(),

  // ---- Timestamps ----
  created_at: z.string().datetime(),
  promoted_at: z.string().datetime().optional(),
  deprecated_at: z.string().datetime().optional(),
});
export type Genome = z.infer<typeof GenomeSchema>;

// ============================================================================
// Experiment
// ============================================================================

/**
 * An A/B experiment compares two genomes head-to-head
 * on the same symbol under the same conditions.
 */
export const ExperimentSchema = z.object({
  /** Unique experiment identifier */
  experiment_id: z.string().uuid(),
  /** Human-readable experiment name */
  name: z.string(),

  /** The original genome (control group) */
  control_genome_id: z.string().uuid(),
  /** The mutant genome (variant group) */
  variant_genome_id: z.string().uuid(),

  /** Current status */
  status: z.enum(["running", "completed", "cancelled"]),

  // ---- Conditions ----
  /** Trading symbol for the experiment */
  symbol: z.string(),
  /** Minimum trades before a winner can be declared */
  min_trades: z.number().default(10),
  /** Maximum duration in days before auto-completion */
  max_duration_days: z.number().default(30),

  // ---- Results ----
  control_trades: z.number().default(0),
  control_pnl: z.number().default(0),
  variant_trades: z.number().default(0),
  variant_pnl: z.number().default(0),

  /** Winner determination */
  winner: z.enum(["control", "variant", "undecided"]).default("undecided"),
  /** Reason for the winner determination */
  winner_reason: z.string().optional(),

  // ---- Timestamps ----
  started_at: z.string().datetime(),
  ended_at: z.string().datetime().optional(),
});
export type Experiment = z.infer<typeof ExperimentSchema>;

// ============================================================================
// Mutation Suggestion
// ============================================================================

/**
 * A batch of mutation suggestions from an agent, awaiting human approval.
 */
export const MutationSuggestionSchema = z.object({
  /** Unique suggestion identifier */
  suggestion_id: z.string().uuid(),
  /** The genome these mutations would be applied to */
  genome_id: z.string().uuid(),
  /** Which agent suggested this */
  suggested_by: z.string(),
  /** Rationale for the suggestion */
  reason: z.string(),
  /** The proposed mutations */
  mutations: z.array(MutationSchema),
  /** Agent's confidence in this suggestion (0-1) */
  confidence: z.number().min(0).max(1),
  /** Approval status */
  status: z.enum(["pending", "approved", "rejected", "applied"]),
  /** When this suggestion was created */
  created_at: z.string().datetime(),
});
export type MutationSuggestion = z.infer<typeof MutationSuggestionSchema>;
