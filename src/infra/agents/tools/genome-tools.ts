/**
 * Genome Tools (Mastra Format)
 *
 * Agent tools for the Strategy Genome evolutionary playbook system.
 * Allows agents to fork playbooks, suggest mutations, run A/B experiments,
 * and promote winners.
 *
 * All operations are wrapped in try/catch — genome failures
 * should never crash agent execution.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { GenomeManager } from "../../../core/genome/index.ts";
import { playbookRegistry } from "../../../core/playbooks/registry.ts";
import { playbookToProtocol } from "../../../core/playbooks/converter.ts";
import {
  getGenomesByPlaybook,
  getGenome,
} from "../../../core/genome/store.ts";
import {
  listPlaybookBacktestResults,
  loadPlaybookBacktestResult,
} from "../../../core/backtesting/store.ts";
import { createModuleLogger } from "../../logger/index.ts";

const logger = createModuleLogger("genome-tools");

// ============================================================================
// Fork Playbook Tool
// ============================================================================

export const forkPlaybookTool = createTool({
  id: "fork_playbook",
  description:
    "Fork a playbook to create a mutated variant. If no mutations are provided, " +
    "auto-generates random nudge mutations (small parameter perturbations). " +
    "The new variant is saved as an evolved playbook and tracked in the genome system. " +
    "Use when the user wants to experiment with a playbook variation.",
  inputSchema: z.object({
    playbook_name: z
      .string()
      .describe("Playbook ID (kebab-case, e.g., 'momentum-breakout') to fork"),
    mutations: z
      .array(
        z.object({
          field_path: z.string().describe("Dot-notation path into the protocol, e.g. 'exit.stop_loss.value'"),
          parameter_name: z.string().describe("Human-readable name, e.g. 'Stop loss percentage'"),
          to_value: z.unknown().describe("New value to set"),
          reason: z.string().describe("Why this mutation is being made"),
        })
      )
      .optional()
      .describe("Specific mutations to apply. If omitted, auto-generates nudge mutations."),
  }),
  outputSchema: z.object({
    genome_id: z.string().optional(),
    playbook_name: z.string().optional(),
    parent_genome_id: z.string().optional(),
    generation: z.number().optional(),
    mutations_applied: z.number().optional(),
    mutation_details: z
      .array(
        z.object({
          parameter: z.string(),
          from: z.string(),
          to: z.string(),
          type: z.string(),
          reason: z.string(),
        })
      )
      .optional(),
    playbook_preview: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ playbook_name, mutations: userMutations }) => {
    try {
      const manager = GenomeManager.getInstance();

      // Register the playbook if not already tracked
      const parentGenome = manager.registerPlaybook(playbook_name);

      let result;
      if (userMutations && userMutations.length > 0) {
        // Build full mutation objects from user input
        const playbook = playbookRegistry.getOrThrow(playbook_name);
        const protocol = playbookToProtocol(playbook);
        const mutator = manager.getMutator();

        const fullMutations = userMutations.map((m) => {
          const protoAsRecord = protocol as unknown as Record<string, unknown>;
          const currentValue = getNestedValue(protoAsRecord, m.field_path);
          return {
            mutation_id: crypto.randomUUID(),
            field_path: m.field_path,
            parameter_name: m.parameter_name,
            from_value: currentValue,
            to_value: m.to_value,
            mutation_type: "nudge" as const,
            reason: m.reason,
            suggested_by: "user",
            created_at: new Date().toISOString(),
          };
        });

        result = manager.forkWithMutations(parentGenome.genome_id, fullMutations);
      } else {
        // Auto-generate nudge mutations
        const quickResult = manager.quickFork(parentGenome.genome_id);
        result = { genome: quickResult.genome, playbookMarkdown: quickResult.playbookMarkdown };
      }

      return {
        genome_id: result.genome.genome_id,
        playbook_name: result.genome.playbook_name,
        parent_genome_id: result.genome.parent_genome_id,
        generation: result.genome.generation,
        mutations_applied: result.genome.mutations_from_parent.length,
        mutation_details: result.genome.mutations_from_parent.map((m) => ({
          parameter: m.parameter_name,
          from: String(m.from_value),
          to: String(m.to_value),
          type: m.mutation_type,
          reason: m.reason,
        })),
        playbook_preview: result.playbookMarkdown.slice(0, 500) + "...",
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("fork_playbook failed", { error: message, playbook: playbook_name });
      return { error: message };
    }
  },
});

// ============================================================================
// Suggest Mutations Tool
// ============================================================================

export const suggestMutationsTool = createTool({
  id: "suggest_mutations",
  description:
    "Get mutation suggestions for a playbook based on its backtest results. " +
    "Analyzes performance weaknesses and proposes targeted parameter adjustments. " +
    "Use when the user wants to know how to improve a playbook.",
  inputSchema: z.object({
    playbook_name: z
      .string()
      .describe("Playbook ID (kebab-case) to analyze for mutation suggestions"),
  }),
  outputSchema: z.object({
    playbook_name: z.string().optional(),
    suggestions: z
      .array(
        z.object({
          parameter: z.string(),
          from: z.string(),
          to: z.string(),
          type: z.string(),
          reason: z.string(),
        })
      )
      .optional(),
    backtest_used: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ playbook_name }) => {
    try {
      const manager = GenomeManager.getInstance();
      const mutator = manager.getMutator();

      // Get the playbook protocol
      const playbook = playbookRegistry.getOrThrow(playbook_name);
      const protocol = playbookToProtocol(playbook);

      // Find the latest backtest result
      const backtests = listPlaybookBacktestResults({ playbook_name, limit: 1 });
      if (backtests.length === 0) {
        // No backtest data -- generate generic nudge suggestions
        const mutations = mutator.generateNudgeMutations(protocol, 3);
        return {
          playbook_name,
          suggestions: mutations.map((m) => ({
            parameter: m.parameter_name,
            from: String(m.from_value),
            to: String(m.to_value),
            type: m.mutation_type,
            reason: m.reason + " (no backtest data available, using random nudges)",
          })),
          backtest_used: "none",
        };
      }

      // Load full backtest result and generate targeted suggestions
      const backtestResult = loadPlaybookBacktestResult(backtests[0]!.id);
      if (!backtestResult) {
        throw new Error("Failed to load backtest result");
      }

      const mutations = mutator.suggestMutationsFromBacktest(protocol, backtestResult);

      // If no targeted mutations, add some nudges
      if (mutations.length === 0) {
        const nudges = mutator.generateNudgeMutations(protocol, 2);
        mutations.push(...nudges);
      }

      return {
        playbook_name,
        suggestions: mutations.map((m) => ({
          parameter: m.parameter_name,
          from: String(m.from_value),
          to: String(m.to_value),
          type: m.mutation_type,
          reason: m.reason,
        })),
        backtest_used: backtests[0]!.id,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("suggest_mutations failed", { error: message, playbook: playbook_name });
      return { error: message };
    }
  },
});

// ============================================================================
// Start A/B Experiment Tool
// ============================================================================

export const startAbExperimentTool = createTool({
  id: "start_ab_experiment",
  description:
    "Start an A/B experiment between two playbook variants. " +
    "Both variants will run in paper trading mode on the specified symbol. " +
    "Use when the user wants to compare two strategy versions head-to-head.",
  inputSchema: z.object({
    control_playbook: z
      .string()
      .describe("Playbook ID of the control (original) strategy"),
    variant_playbook: z
      .string()
      .describe("Playbook ID of the variant (mutated) strategy"),
    symbol: z.string().describe("Trading symbol for the experiment, e.g. 'BTCUSDT'"),
    min_trades: z
      .number()
      .min(1)
      .default(10)
      .describe("Minimum trades before judging the winner"),
    max_duration_days: z
      .number()
      .min(1)
      .default(30)
      .describe("Maximum experiment duration in days"),
  }),
  outputSchema: z.object({
    experiment_id: z.string().optional(),
    name: z.string().optional(),
    control_genome_id: z.string().optional(),
    variant_genome_id: z.string().optional(),
    symbol: z.string().optional(),
    min_trades: z.number().optional(),
    max_duration_days: z.number().optional(),
    status: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ control_playbook, variant_playbook, symbol, min_trades, max_duration_days }) => {
    try {
      const manager = GenomeManager.getInstance();

      // Register both playbooks as genomes if not already
      const controlGenome = manager.registerPlaybook(control_playbook);
      const variantGenome = manager.registerPlaybook(variant_playbook);

      const experiment = manager.startExperiment(
        controlGenome.genome_id,
        variantGenome.genome_id,
        symbol,
        { min_trades, max_duration_days },
      );

      return {
        experiment_id: experiment.experiment_id,
        name: experiment.name,
        control_genome_id: experiment.control_genome_id,
        variant_genome_id: experiment.variant_genome_id,
        symbol: experiment.symbol,
        min_trades: experiment.min_trades,
        max_duration_days: experiment.max_duration_days,
        status: experiment.status,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("start_ab_experiment failed", { error: message });
      return { error: message };
    }
  },
});

// ============================================================================
// Check Experiment Tool
// ============================================================================

export const checkExperimentTool = createTool({
  id: "check_experiment",
  description:
    "Check the status of an A/B experiment. " +
    "Shows trade counts, PnL, and winner determination for both control and variant. " +
    "Use when the user asks about experiment progress.",
  inputSchema: z.object({
    experiment_id: z
      .string()
      .describe("Experiment ID to check"),
  }),
  outputSchema: z.object({
    experiment_id: z.string().optional(),
    name: z.string().optional(),
    status: z.string().optional(),
    symbol: z.string().optional(),
    control_trades: z.number().optional(),
    control_pnl: z.number().optional(),
    variant_trades: z.number().optional(),
    variant_pnl: z.number().optional(),
    winner: z.string().optional(),
    winner_reason: z.string().optional(),
    started_at: z.string().optional(),
    ended_at: z.string().optional(),
    formatted_status: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ experiment_id }) => {
    try {
      const manager = GenomeManager.getInstance();

      // Try to evaluate (check for winner)
      const experiment = manager.evaluateExperiment(experiment_id);

      return {
        experiment_id: experiment.experiment_id,
        name: experiment.name,
        status: experiment.status,
        symbol: experiment.symbol,
        control_trades: experiment.control_trades,
        control_pnl: experiment.control_pnl,
        variant_trades: experiment.variant_trades,
        variant_pnl: experiment.variant_pnl,
        winner: experiment.winner,
        winner_reason: experiment.winner_reason,
        started_at: experiment.started_at,
        ended_at: experiment.ended_at,
        formatted_status: manager.formatExperimentStatus(experiment_id),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("check_experiment failed", { error: message, experiment_id });
      return { error: message };
    }
  },
});

// ============================================================================
// Promote Winner Tool
// ============================================================================

export const promoteWinnerTool = createTool({
  id: "promote_winner",
  description:
    "Promote the winning variant from a completed A/B experiment. " +
    "The winner is marked as 'live' and the loser as 'deprecated'. " +
    "Use when an experiment has completed and the user wants to adopt the winner.",
  inputSchema: z.object({
    experiment_id: z
      .string()
      .describe("Experiment ID whose winner to promote"),
  }),
  outputSchema: z.object({
    promoted_genome_id: z.string().optional(),
    playbook_name: z.string().optional(),
    fitness_score: z.number().optional(),
    status: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ experiment_id }) => {
    try {
      const manager = GenomeManager.getInstance();
      const winner = manager.promoteWinner(experiment_id);

      return {
        promoted_genome_id: winner.genome_id,
        playbook_name: winner.playbook_name,
        fitness_score: winner.fitness_score,
        status: winner.status,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("promote_winner failed", { error: message, experiment_id });
      return { error: message };
    }
  },
});

// ============================================================================
// Get Playbook Lineage Tool
// ============================================================================

export const getPlaybookLineageTool = createTool({
  id: "get_playbook_lineage",
  description:
    "View the evolutionary history of a playbook. " +
    "Shows the lineage tree from the original to all forked variants with their mutations. " +
    "Use when the user wants to see how a playbook has evolved over time.",
  inputSchema: z.object({
    playbook_name: z
      .string()
      .describe("Playbook ID (kebab-case) to get lineage for"),
  }),
  outputSchema: z.object({
    playbook_name: z.string().optional(),
    genomes: z
      .array(
        z.object({
          genome_id: z.string(),
          playbook_name: z.string(),
          generation: z.number(),
          status: z.string(),
          fitness_score: z.number().optional(),
          mutations_count: z.number(),
          parent_genome_id: z.string().optional(),
        })
      )
      .optional(),
    lineage_tree: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ playbook_name }) => {
    try {
      const manager = GenomeManager.getInstance();

      // Get all genomes for this playbook family
      const genomes = getGenomesByPlaybook(playbook_name);

      if (genomes.length === 0) {
        // Try registering first
        manager.registerPlaybook(playbook_name);
        const freshGenomes = getGenomesByPlaybook(playbook_name);
        if (freshGenomes.length === 0) {
          return {
            playbook_name,
            genomes: [],
            lineage_tree: "No genome history found for this playbook.",
          };
        }
      }

      // Also find genomes that were forked FROM this playbook (children)
      const allGenomes = genomes;

      // Build tree for the latest genome
      const latestGenome = allGenomes[allGenomes.length - 1];
      const lineageTree = latestGenome
        ? manager.formatLineageTree(latestGenome.genome_id)
        : "No lineage found.";

      return {
        playbook_name,
        genomes: allGenomes.map((g) => ({
          genome_id: g.genome_id,
          playbook_name: g.playbook_name,
          generation: g.generation,
          status: g.status,
          fitness_score: g.fitness_score,
          mutations_count: g.mutations_from_parent.length,
          parent_genome_id: g.parent_genome_id,
        })),
        lineage_tree: lineageTree,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("get_playbook_lineage failed", { error: message, playbook: playbook_name });
      return { error: message };
    }
  },
});

// ============================================================================
// Rank Playbook Variants Tool
// ============================================================================

export const rankPlaybookVariantsTool = createTool({
  id: "rank_playbook_variants",
  description:
    "Rank all variants of a playbook by fitness score. " +
    "Shows a sorted list of all genome variants with their performance metrics. " +
    "Use when the user wants to compare all versions of a strategy.",
  inputSchema: z.object({
    playbook_name: z
      .string()
      .describe("Playbook ID (kebab-case) to rank variants for"),
  }),
  outputSchema: z.object({
    playbook_name: z.string().optional(),
    ranked_variants: z
      .array(
        z.object({
          rank: z.number(),
          genome_id: z.string(),
          playbook_name: z.string(),
          generation: z.number(),
          status: z.string(),
          fitness_score: z.number().optional(),
          backtest_sharpe: z.number().optional(),
          backtest_win_rate: z.number().optional(),
          backtest_profit_factor: z.number().optional(),
          backtest_max_drawdown: z.number().optional(),
          paper_trades: z.number(),
          paper_pnl: z.number(),
        })
      )
      .optional(),
    total_variants: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ playbook_name }) => {
    try {
      const manager = GenomeManager.getInstance();
      const fitnessCalc = manager.getFitnessCalculator();

      // Get all genomes for this playbook
      const genomes = getGenomesByPlaybook(playbook_name);

      if (genomes.length === 0) {
        return {
          playbook_name,
          ranked_variants: [],
          total_variants: 0,
        };
      }

      // Calculate fitness for those missing it
      for (const g of genomes) {
        if (g.fitness_score === undefined) {
          g.fitness_score = fitnessCalc.calculateFitness(g);
        }
      }

      // Rank by fitness
      const ranked = fitnessCalc.rankGenomes(genomes);

      return {
        playbook_name,
        ranked_variants: ranked.map((g, i) => ({
          rank: i + 1,
          genome_id: g.genome_id,
          playbook_name: g.playbook_name,
          generation: g.generation,
          status: g.status,
          fitness_score: g.fitness_score,
          backtest_sharpe: g.backtest_sharpe,
          backtest_win_rate: g.backtest_win_rate,
          backtest_profit_factor: g.backtest_profit_factor,
          backtest_max_drawdown: g.backtest_max_drawdown,
          paper_trades: g.paper_trades,
          paper_pnl: g.paper_pnl,
        })),
        total_variants: ranked.length,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("rank_playbook_variants failed", { error: message, playbook: playbook_name });
      return { error: message };
    }
  },
});

// ============================================================================
// Helper
// ============================================================================

/**
 * Get a nested value from an object using dot-notation path.
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    const idx = Number(part);
    if (Array.isArray(current) && !Number.isNaN(idx)) {
      current = current[idx];
    } else {
      current = (current as Record<string, unknown>)[part];
    }
  }
  return current;
}

// ============================================================================
// Export as Object (Mastra format)
// ============================================================================

/**
 * Genome tools exported as an object for Mastra Agent.
 * This is the format expected by Mastra's Agent class.
 */
export const genomeTools = {
  fork_playbook: forkPlaybookTool,
  suggest_mutations: suggestMutationsTool,
  start_ab_experiment: startAbExperimentTool,
  check_experiment: checkExperimentTool,
  promote_winner: promoteWinnerTool,
  get_playbook_lineage: getPlaybookLineageTool,
  rank_playbook_variants: rankPlaybookVariantsTool,
};
