/**
 * Genome Manager
 *
 * Main facade for the Strategy Genome system. Coordinates between
 * the playbook registry, mutator, fitness calculator, and genome store
 * to provide a high-level API for evolutionary playbook management.
 *
 * Singleton pattern -- use GenomeManager.getInstance().
 */

import { v4 as uuidv4 } from "uuid";
import { join } from "path";
import { writeFileSync, mkdirSync } from "fs";
import { createModuleLogger } from "../../infra/logger/index.ts";
import { playbookRegistry } from "../playbooks/registry.ts";
import { playbookToProtocol, protocolToMarkdown } from "../playbooks/converter.ts";
import { PlaybookMutator } from "./mutator.ts";
import { FitnessCalculator } from "./fitness.ts";
import {
  saveGenome,
  getGenome,
  getGenomesByPlaybook,
  getLineage as storeGetLineage,
  getBestGenome,
  saveExperiment,
  getExperiment,
  getActiveExperiments as storeGetActiveExperiments,
  updateExperiment,
  initGenomeTables,
} from "./store.ts";
import type { Genome, Experiment, Mutation } from "./types.ts";

const logger = createModuleLogger("genome-manager");

// ============================================================================
// Evolved Playbook Directory
// ============================================================================

/** Directory for evolved (mutated) playbooks */
const EVOLVED_DIR = join(import.meta.dirname ?? __dirname, "..", "playbooks", "evolved");

/**
 * Ensure the evolved playbooks directory exists.
 */
function ensureEvolvedDir(): void {
  try {
    mkdirSync(EVOLVED_DIR, { recursive: true });
  } catch {
    // Already exists or permissions issue; ignore
  }
}

// ============================================================================
// GenomeManager
// ============================================================================

export class GenomeManager {
  private static instance: GenomeManager;

  private mutator: PlaybookMutator;
  private fitness: FitnessCalculator;

  private constructor() {
    this.mutator = new PlaybookMutator();
    this.fitness = new FitnessCalculator();
    initGenomeTables();
    ensureEvolvedDir();
    logger.debug("GenomeManager initialized");
  }

  /**
   * Get the singleton instance.
   */
  static getInstance(): GenomeManager {
    if (!GenomeManager.instance) {
      GenomeManager.instance = new GenomeManager();
    }
    return GenomeManager.instance;
  }

  /**
   * Reset the singleton (for testing).
   */
  static resetInstance(): void {
    GenomeManager.instance = undefined as unknown as GenomeManager;
  }

  // ==========================================================================
  // Playbook Registration
  // ==========================================================================

  /**
   * Create a generation-0 genome from an existing playbook in the registry.
   * This registers the playbook as the "original" in the genome system.
   */
  registerPlaybook(playbookName: string): Genome {
    // Ensure playbook exists
    const playbook = playbookRegistry.get(playbookName);
    if (!playbook) {
      throw new Error(
        `Playbook "${playbookName}" not found in registry. Available: ${playbookRegistry.getIds().join(", ") || "none"}`
      );
    }

    // Check if already registered
    const existing = getGenomesByPlaybook(playbookName);
    const gen0 = existing.find((g) => g.generation === 0);
    if (gen0) {
      logger.debug("Playbook already registered as genome", {
        playbook: playbookName,
        genome_id: gen0.genome_id,
      });
      return gen0;
    }

    const genome: Genome = {
      genome_id: uuidv4(),
      playbook_name: playbookName,
      parent_genome_id: undefined,
      generation: 0,
      mutations_from_parent: [],
      status: "candidate",
      paper_trades: 0,
      paper_pnl: 0,
      live_trades: 0,
      live_pnl: 0,
      created_at: new Date().toISOString(),
    };

    saveGenome(genome);

    logger.info("Registered playbook as genome", {
      playbook: playbookName,
      genome_id: genome.genome_id,
    });

    return genome;
  }

  // ==========================================================================
  // Forking
  // ==========================================================================

  /**
   * Fork a playbook with specific mutations.
   * Creates a new genome, applies mutations to the protocol,
   * generates a markdown file, and registers it in the playbook registry.
   */
  forkWithMutations(
    parentGenomeId: string,
    mutations: Mutation[],
  ): {
    genome: Genome;
    playbookMarkdown: string;
  } {
    const parent = getGenome(parentGenomeId);
    if (!parent) {
      throw new Error(`Parent genome ${parentGenomeId} not found`);
    }

    // Get the playbook and convert to protocol
    const playbook = playbookRegistry.get(parent.playbook_name);
    if (!playbook) {
      throw new Error(`Playbook "${parent.playbook_name}" not found in registry`);
    }

    const protocol = playbookToProtocol(playbook);

    // Apply mutations
    const mutatedProtocol = this.mutator.applyMutations(protocol, mutations);

    // Generate markdown
    const markdown = protocolToMarkdown(mutatedProtocol);

    // Create new genome
    const genome: Genome = {
      genome_id: uuidv4(),
      playbook_name: mutatedProtocol.slug,
      parent_genome_id: parentGenomeId,
      generation: parent.generation + 1,
      mutations_from_parent: mutations,
      status: "candidate",
      paper_trades: 0,
      paper_pnl: 0,
      live_trades: 0,
      live_pnl: 0,
      created_at: new Date().toISOString(),
    };

    // Write evolved playbook file
    ensureEvolvedDir();
    const filePath = join(EVOLVED_DIR, `${mutatedProtocol.slug}.md`);
    writeFileSync(filePath, markdown, "utf-8");

    // Save genome to database
    saveGenome(genome);

    logger.info("Forked playbook with mutations", {
      parent_genome_id: parentGenomeId,
      new_genome_id: genome.genome_id,
      mutations: String(mutations.length),
      file: filePath,
    });

    return { genome, playbookMarkdown: markdown };
  }

  /**
   * Quick fork with auto-generated nudge mutations.
   * Convenience method that generates random perturbations.
   */
  quickFork(parentGenomeId: string): {
    genome: Genome;
    playbookMarkdown: string;
    mutations: Mutation[];
  } {
    const parent = getGenome(parentGenomeId);
    if (!parent) {
      throw new Error(`Parent genome ${parentGenomeId} not found`);
    }

    const playbook = playbookRegistry.get(parent.playbook_name);
    if (!playbook) {
      throw new Error(`Playbook "${parent.playbook_name}" not found in registry`);
    }

    const protocol = playbookToProtocol(playbook);
    const mutations = this.mutator.generateNudgeMutations(protocol, 2);

    if (mutations.length === 0) {
      throw new Error("Could not generate any nudge mutations for this playbook");
    }

    const result = this.forkWithMutations(parentGenomeId, mutations);
    return { ...result, mutations };
  }

  // ==========================================================================
  // A/B Experiments
  // ==========================================================================

  /**
   * Start an A/B experiment between two genomes.
   */
  startExperiment(
    controlGenomeId: string,
    variantGenomeId: string,
    symbol: string,
    options?: {
      min_trades?: number;
      max_duration_days?: number;
      name?: string;
    },
  ): Experiment {
    const control = getGenome(controlGenomeId);
    if (!control) throw new Error(`Control genome ${controlGenomeId} not found`);

    const variant = getGenome(variantGenomeId);
    if (!variant) throw new Error(`Variant genome ${variantGenomeId} not found`);

    const experiment: Experiment = {
      experiment_id: uuidv4(),
      name: options?.name ?? `${control.playbook_name} vs ${variant.playbook_name}`,
      control_genome_id: controlGenomeId,
      variant_genome_id: variantGenomeId,
      status: "running",
      symbol,
      min_trades: options?.min_trades ?? 10,
      max_duration_days: options?.max_duration_days ?? 30,
      control_trades: 0,
      control_pnl: 0,
      variant_trades: 0,
      variant_pnl: 0,
      winner: "undecided",
      started_at: new Date().toISOString(),
    };

    saveExperiment(experiment);

    // Update genome statuses to paper_trading
    control.status = "paper_trading";
    saveGenome(control);
    variant.status = "paper_trading";
    saveGenome(variant);

    logger.info("Started A/B experiment", {
      experiment_id: experiment.experiment_id,
      control: control.playbook_name,
      variant: variant.playbook_name,
      symbol,
    });

    return experiment;
  }

  /**
   * Record a trade result for an experiment.
   */
  recordExperimentTrade(
    experimentId: string,
    isVariant: boolean,
    pnl: number,
  ): void {
    const experiment = getExperiment(experimentId);
    if (!experiment) throw new Error(`Experiment ${experimentId} not found`);
    if (experiment.status !== "running") {
      throw new Error(`Experiment ${experimentId} is not running (status: ${experiment.status})`);
    }

    if (isVariant) {
      updateExperiment(experimentId, {
        variant_trades: experiment.variant_trades + 1,
        variant_pnl: experiment.variant_pnl + pnl,
      });
    } else {
      updateExperiment(experimentId, {
        control_trades: experiment.control_trades + 1,
        control_pnl: experiment.control_pnl + pnl,
      });
    }

    // Also update the genome's paper trading stats
    const genomeId = isVariant
      ? experiment.variant_genome_id
      : experiment.control_genome_id;
    const genome = getGenome(genomeId);
    if (genome) {
      genome.paper_trades += 1;
      genome.paper_pnl += pnl;
      if (genome.paper_trades > 0) {
        // Simple win rate tracking
        const wins = pnl > 0 ? 1 : 0;
        const prevWins = (genome.paper_win_rate ?? 0) / 100 * (genome.paper_trades - 1);
        genome.paper_win_rate = ((prevWins + wins) / genome.paper_trades) * 100;
      }
      genome.fitness_score = this.fitness.calculateFitness(genome);
      saveGenome(genome);
    }

    logger.debug("Recorded experiment trade", {
      experiment_id: experimentId,
      side: isVariant ? "variant" : "control",
      pnl: String(pnl),
    });
  }

  /**
   * Evaluate an experiment to check if we have a winner.
   */
  evaluateExperiment(experimentId: string): Experiment {
    const experiment = getExperiment(experimentId);
    if (!experiment) throw new Error(`Experiment ${experimentId} not found`);

    if (experiment.status !== "running") {
      return experiment;
    }

    // Check duration
    const daysElapsed = (Date.now() - new Date(experiment.started_at).getTime()) / (1000 * 60 * 60 * 24);
    const durationExceeded = daysElapsed >= experiment.max_duration_days;

    // Check if both sides have enough trades
    const bothHaveMinTrades =
      experiment.control_trades >= experiment.min_trades &&
      experiment.variant_trades >= experiment.min_trades;

    if (!bothHaveMinTrades && !durationExceeded) {
      return experiment; // Not ready to evaluate yet
    }

    // Load genomes and compare
    const control = getGenome(experiment.control_genome_id);
    const variant = getGenome(experiment.variant_genome_id);

    if (control && variant) {
      const comparison = this.fitness.compareGenomes(control, variant);

      updateExperiment(experimentId, {
        winner: comparison.winner,
        winner_reason: comparison.reason,
        status: comparison.winner !== "undecided" || durationExceeded ? "completed" : "running",
        ended_at: comparison.winner !== "undecided" || durationExceeded ? new Date().toISOString() : undefined,
      });
    } else if (durationExceeded) {
      // Duration exceeded without enough data
      updateExperiment(experimentId, {
        winner: "undecided",
        winner_reason: `Duration exceeded (${experiment.max_duration_days} days) without sufficient data`,
        status: "completed",
        ended_at: new Date().toISOString(),
      });
    }

    return getExperiment(experimentId)!;
  }

  /**
   * Promote the winning variant from an experiment.
   * Updates genome statuses accordingly.
   */
  promoteWinner(experimentId: string): Genome {
    const experiment = getExperiment(experimentId);
    if (!experiment) throw new Error(`Experiment ${experimentId} not found`);

    if (experiment.status !== "completed") {
      throw new Error(`Experiment ${experimentId} is not completed (status: ${experiment.status})`);
    }

    if (experiment.winner === "undecided") {
      throw new Error(`Experiment ${experimentId} has no clear winner`);
    }

    const winnerGenomeId = experiment.winner === "variant"
      ? experiment.variant_genome_id
      : experiment.control_genome_id;
    const loserGenomeId = experiment.winner === "variant"
      ? experiment.control_genome_id
      : experiment.variant_genome_id;

    // Promote winner
    const winner = getGenome(winnerGenomeId);
    if (!winner) throw new Error(`Winner genome ${winnerGenomeId} not found`);

    winner.status = "live";
    winner.promoted_at = new Date().toISOString();
    winner.fitness_score = this.fitness.calculateFitness(winner);
    saveGenome(winner);

    // Deprecate loser
    const loser = getGenome(loserGenomeId);
    if (loser) {
      loser.status = "deprecated";
      loser.deprecated_at = new Date().toISOString();
      saveGenome(loser);
    }

    logger.info("Promoted experiment winner", {
      experiment_id: experimentId,
      winner_genome_id: winnerGenomeId,
      winner_side: experiment.winner,
    });

    return winner;
  }

  // ==========================================================================
  // Queries
  // ==========================================================================

  /**
   * Get the full lineage tree for a genome.
   */
  getLineage(genomeId: string): Genome[] {
    return storeGetLineage(genomeId);
  }

  /**
   * Get all genomes for a playbook.
   */
  getGenomes(playbookName: string): Genome[] {
    return getGenomesByPlaybook(playbookName);
  }

  /**
   * Get the best genome for a playbook by fitness score.
   */
  getBestGenome(playbookName: string): Genome | null {
    return getBestGenome(playbookName);
  }

  /**
   * Get all active experiments.
   */
  getActiveExperiments(): Experiment[] {
    return storeGetActiveExperiments();
  }

  /**
   * Get a single genome by ID.
   */
  getGenome(genomeId: string): Genome | null {
    return getGenome(genomeId);
  }

  /**
   * Get the mutator for direct access (used by tools).
   */
  getMutator(): PlaybookMutator {
    return this.mutator;
  }

  /**
   * Get the fitness calculator for direct access.
   */
  getFitnessCalculator(): FitnessCalculator {
    return this.fitness;
  }

  // ==========================================================================
  // Display Formatting
  // ==========================================================================

  /**
   * Format a lineage tree as a readable string.
   */
  formatLineageTree(genomeId: string): string {
    const chain = this.getLineage(genomeId);
    if (chain.length === 0) return "No lineage found.";

    const lines: string[] = [];
    lines.push("=== Playbook Lineage ===");
    lines.push("");

    for (let i = 0; i < chain.length; i++) {
      const g = chain[i]!;
      const prefix = i === 0 ? "" : "  ".repeat(i) + "|--> ";
      const fitness = g.fitness_score !== undefined ? ` [fitness: ${g.fitness_score.toFixed(1)}]` : "";
      const status = ` (${g.status})`;
      lines.push(`${prefix}Gen ${g.generation}: ${g.playbook_name}${status}${fitness}`);

      if (g.mutations_from_parent.length > 0) {
        for (const m of g.mutations_from_parent) {
          const mPrefix = "  ".repeat(i + 1) + "  ";
          lines.push(`${mPrefix}[${m.mutation_type}] ${m.parameter_name}: ${String(m.from_value)} -> ${String(m.to_value)}`);
          lines.push(`${mPrefix}  Reason: ${m.reason}`);
        }
      }
    }

    return lines.join("\n");
  }

  /**
   * Format experiment status as a readable string.
   */
  formatExperimentStatus(experimentId: string): string {
    const exp = getExperiment(experimentId);
    if (!exp) return `Experiment ${experimentId} not found.`;

    const lines: string[] = [];
    lines.push(`=== Experiment: ${exp.name} ===`);
    lines.push(`ID:       ${exp.experiment_id}`);
    lines.push(`Status:   ${exp.status.toUpperCase()}`);
    lines.push(`Symbol:   ${exp.symbol}`);
    lines.push(`Started:  ${exp.started_at}`);
    if (exp.ended_at) lines.push(`Ended:    ${exp.ended_at}`);
    lines.push("");
    lines.push("--- Control ---");
    lines.push(`  Trades: ${exp.control_trades}`);
    lines.push(`  PnL:    $${exp.control_pnl.toFixed(2)}`);
    lines.push("");
    lines.push("--- Variant ---");
    lines.push(`  Trades: ${exp.variant_trades}`);
    lines.push(`  PnL:    $${exp.variant_pnl.toFixed(2)}`);
    lines.push("");
    lines.push(`Winner:   ${exp.winner.toUpperCase()}`);
    if (exp.winner_reason) lines.push(`Reason:   ${exp.winner_reason}`);

    return lines.join("\n");
  }
}
