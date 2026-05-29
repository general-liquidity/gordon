/**
 * Evolution Loop
 *
 * Genetic algorithm daemon that drives playbook evolution:
 * 1. Evaluate active experiments → promote winners
 * 2. Record pending trade results for running experiments
 * 3. Fork new variants from insights + regime mutations
 * 4. Occasional crossover between high-fitness genomes
 *
 * Runs periodically via the daemon scheduler (@every 1h).
 */

import { createModuleLogger } from "../../infra/logger/index.ts";
import { logEvent } from "../../infra/storage/entities/events.ts";
import { listTrades } from "../../infra/storage/entities/trades.ts";
import type { Exchange } from "../../infra/exchange/types.ts";
import { GenomeManager } from "./manager.ts";
import { PlaybookMutator } from "./mutator.ts";
import { getGenomesByStatus } from "./store.ts";
import { StrategyRuntime } from "../runtime/engine.ts";
import { getRuntimeStore } from "../runtime/store.ts";
import { RegimeDetector } from "../regime/detector.ts";
import { getRecurringInsights } from "../learning/insight-store.ts";
import { playbookRegistry } from "../playbooks/registry.ts";
import { playbookToProtocol } from "../playbooks/converter.ts";
import type { Mutation } from "./types.ts";
import {
  deriveRejectedMutations,
  filterRejectedMutations,
  DEFAULT_MIN_FITNESS_DROP,
} from "./mutationRejection.ts";
import { v4 as uuidv4 } from "uuid";

const logger = createModuleLogger("evolution-loop");

/** Failed-mutation suppression is on unless explicitly disabled. */
function isGenomeRejectionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.GORDON_GENOME_REJECTION;
  return raw !== "0" && raw !== "false";
}

/** Net composite-fitness-drop threshold for treating a mutation as failed. */
function genomeRejectionMinDrop(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.GORDON_GENOME_REJECTION_MIN_DROP;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MIN_FITNESS_DROP;
}

// ============================================================================
// Types
// ============================================================================

export interface EvolutionTickResult {
  experimentsEvaluated: number;
  experimentsCompleted: number;
  winnersPromoted: number;
  variantsForked: number;
  crossoversCreated: number;
  errors: string[];
}

// ============================================================================
// Evolution Loop
// ============================================================================

export class EvolutionLoop {
  private static instance: EvolutionLoop;
  private tickCount: number = 0;

  private constructor() {
    logger.debug("EvolutionLoop initialized");
  }

  static getInstance(): EvolutionLoop {
    if (!EvolutionLoop.instance) {
      EvolutionLoop.instance = new EvolutionLoop();
    }
    return EvolutionLoop.instance;
  }

  /**
   * Main periodic method — called by the daemon scheduler.
   *
   * Phase 1: Evaluate active experiments
   * Phase 2: Fork new variants (if no active experiment for a slot)
   * Phase 3: Crossover (every 4th tick)
   */
  async tick(exchange: Exchange, force: boolean = false): Promise<EvolutionTickResult> {
    this.tickCount++;

    const result: EvolutionTickResult = {
      experimentsEvaluated: 0,
      experimentsCompleted: 0,
      winnersPromoted: 0,
      variantsForked: 0,
      crossoversCreated: 0,
      errors: [],
    };

    logger.info("Evolution tick starting", { tick: this.tickCount, force });

    try {
      // Phase 1: Evaluate active experiments
      await this.evaluateExperiments(result);

      // Phase 1.5: Record pending trade results for running experiments
      this.recordExperimentTrades();

      // Phase 2: Fork new variants for eligible slots
      await this.forkVariants(exchange, result);

      // Phase 3: Crossover (every 4th tick ≈ every 4 hours)
      if (this.tickCount % 4 === 0 || force) {
        this.tryCrossover(result);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      result.errors.push(`Evolution tick failed: ${msg}`);
      logger.error("Evolution tick failed", error as Error);
    }

    logger.info("Evolution tick complete", {
      tick: this.tickCount,
      evaluated: result.experimentsEvaluated,
      completed: result.experimentsCompleted,
      promoted: result.winnersPromoted,
      forked: result.variantsForked,
      crossovers: result.crossoversCreated,
      errors: result.errors.length,
    });

    logEvent({
      type: "SYSTEM",
      data: {
        action: "EVOLUTION_TICK_COMPLETE",
        tick: this.tickCount,
        ...result,
      },
    });

    return result;
  }

  // ==========================================================================
  // Phase 1: Evaluate Active Experiments
  // ==========================================================================

  private async evaluateExperiments(result: EvolutionTickResult): Promise<void> {
    const manager = GenomeManager.getInstance();
    const activeExperiments = manager.getActiveExperiments();

    for (const experiment of activeExperiments) {
      try {
        const evaluated = manager.evaluateExperiment(experiment.experiment_id);
        result.experimentsEvaluated++;

        if (evaluated.status === "completed") {
          result.experimentsCompleted++;

          // Auto-promote winner if there is one
          if (evaluated.winner !== "undecided") {
            try {
              const winner = manager.promoteWinner(experiment.experiment_id);
              result.winnersPromoted++;

              // Update the StrategySlot's genome_id to the winner
              this.updateSlotGenome(winner.playbook_name, winner.genome_id);

              logger.info("Experiment winner promoted", {
                experiment: experiment.experiment_id,
                winner: evaluated.winner,
                genome: winner.genome_id,
                playbook: winner.playbook_name,
              });
            } catch (promoteErr) {
              const msg = promoteErr instanceof Error ? promoteErr.message : String(promoteErr);
              result.errors.push(`Promote failed for ${experiment.experiment_id}: ${msg}`);
              logger.warn("Failed to promote winner", {
                experiment: experiment.experiment_id,
                error: msg,
              });
            }
          }
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        result.errors.push(`Experiment eval failed (${experiment.experiment_id}): ${msg}`);
        logger.warn("Failed to evaluate experiment", {
          experiment: experiment.experiment_id,
          error: msg,
        });
      }
    }
  }

  // ==========================================================================
  // Phase 1.5: Record Experiment Trade Results
  // ==========================================================================

  /**
   * Match closed trades to active experiments and record their results.
   * Links trades to experiments via slot → genome_id → experiment lookup.
   */
  private recordExperimentTrades(): void {
    const manager = GenomeManager.getInstance();
    const activeExperiments = manager.getActiveExperiments();

    if (activeExperiments.length === 0) return;

    // Build lookup: genome_id → experiment + isVariant
    const genomeToExperiment = new Map<string, { experimentId: string; isVariant: boolean }>();
    for (const exp of activeExperiments) {
      genomeToExperiment.set(exp.control_genome_id, { experimentId: exp.experiment_id, isVariant: false });
      genomeToExperiment.set(exp.variant_genome_id, { experimentId: exp.experiment_id, isVariant: true });
    }

    // Get recent closed trades
    const closedTrades = listTrades({ status: "CLOSED" });
    const runtime = StrategyRuntime.getInstance();
    const slots = runtime.getActiveSlots();

    // Build slot_id → genome_id lookup
    const slotToGenome = new Map<string, string>();
    for (const slot of slots) {
      if (slot.genome_id) {
        slotToGenome.set(slot.slot_id, slot.genome_id);
      }
    }

    let recorded = 0;
    for (const trade of closedTrades) {
      // Try to find the genome for this trade's slot
      // Trade.planId often encodes the slot reference
      for (const [slotId, genomeId] of slotToGenome) {
        const expInfo = genomeToExperiment.get(genomeId);
        if (!expInfo) continue;

        // Match trade to slot by checking if trade's symbol matches experiment
        const exp = activeExperiments.find((e) => e.experiment_id === expInfo.experimentId);
        if (!exp || exp.symbol !== trade.symbol) continue;

        // Simple heuristic: if trade happened after experiment started
        const tradeTime = trade.exits[0]?.filledAt
          ? new Date(trade.exits[0].filledAt).getTime()
          : 0;
        const expStartTime = new Date(exp.started_at).getTime();
        if (tradeTime <= expStartTime) continue;

        try {
          const pnl = trade.realizedPnl ?? 0;
          manager.recordExperimentTrade(expInfo.experimentId, expInfo.isVariant, pnl);
          recorded++;
        } catch {
          // Already recorded or experiment not found — skip
        }
      }
    }

    if (recorded > 0) {
      logger.debug("Recorded experiment trades", { count: recorded });
    }
  }

  // ==========================================================================
  // Phase 2: Fork Variants
  // ==========================================================================

  private async forkVariants(
    exchange: Exchange,
    result: EvolutionTickResult,
  ): Promise<void> {
    const runtime = StrategyRuntime.getInstance();
    const manager = GenomeManager.getInstance();
    const mutator = manager.getMutator();
    const activeSlots = runtime.getActiveSlots();
    const activeExperiments = manager.getActiveExperiments();

    // Build a set of playbook names already in active experiments
    const experimenting = new Set<string>();
    for (const exp of activeExperiments) {
      const control = manager.getGenome(exp.control_genome_id);
      if (control) experimenting.add(control.playbook_name);
    }

    for (const slot of activeSlots) {
      try {
        // Skip if already in an experiment
        if (experimenting.has(slot.playbook_name)) continue;

        // Need enough trades to justify forking
        if (slot.total_trades < 10) continue;

        // Need a registered genome
        let genome = slot.genome_id ? manager.getGenome(slot.genome_id) : null;
        if (!genome) {
          // Auto-register if not already tracked
          try {
            genome = manager.registerPlaybook(slot.playbook_name);
          } catch {
            continue; // Playbook not in registry
          }
        }

        // Get the playbook protocol for mutation
        const playbook = playbookRegistry.get(slot.playbook_name);
        if (!playbook) continue;

        const protocol = playbookToProtocol(playbook);
        const mutations: Mutation[] = [];

        // Collect insight-driven mutations
        const insights = getRecurringInsights(`plan_${slot.playbook_name.slice(0, 8)}`, 3);
        for (const insight of insights.slice(0, 2)) {
          if (insight.category === "stop_loss" && insight.direction === "decrease") {
            const currentSL = protocol.exit.stop_loss.value;
            const suggested = currentSL * 0.85;
            mutations.push({
              mutation_id: uuidv4(),
              field_path: "exit.stop_loss.value",
              parameter_name: "Stop loss percentage",
              from_value: currentSL,
              to_value: Math.round(suggested * 100) / 100,
              mutation_type: "nudge",
              reason: `Recurring insight: tighter stop loss (${insight.occurrences}x pattern)`,
              suggested_by: "FeedbackLoop",
              created_at: new Date().toISOString(),
            });
          } else if (insight.category === "take_profit" && insight.direction === "increase") {
            if (protocol.exit.take_profit.length > 0) {
              const currentTP = protocol.exit.take_profit[0]!.level;
              const suggested = currentTP * 1.15;
              mutations.push({
                mutation_id: uuidv4(),
                field_path: "exit.take_profit.0.level",
                parameter_name: "Take profit level",
                from_value: currentTP,
                to_value: Math.round(suggested * 100) / 100,
                mutation_type: "nudge",
                reason: `Recurring insight: wider TP target (${insight.occurrences}x pattern)`,
                suggested_by: "FeedbackLoop",
                created_at: new Date().toISOString(),
              });
            }
          }
        }

        // Collect regime-driven mutations
        // Use the most-traded symbol to detect the current regime
        const recentSymbol = listTrades({ status: "OPEN" })[0]?.symbol ?? "BTCUSDT";
        const currentRegime = RegimeDetector.getInstance().getCurrentRegime(recentSymbol, "1h");
        if (currentRegime) {
          const regimeMutations = mutator.suggestMutationsForRegime(
            protocol,
            currentRegime.regime,
          );
          // Only take 1-2 regime mutations to avoid over-mutating
          mutations.push(...regimeMutations.slice(0, 2));
        }

        // If no targeted mutations, fall back to random nudges
        if (mutations.length === 0) {
          const nudges = mutator.generateNudgeMutations(protocol, 2);
          mutations.push(...nudges);
        }

        if (mutations.length === 0) continue;

        // Don't repeat failed approaches (SIA). Suppress candidate mutations
        // this lineage has already learned are net-regressive. Default-on;
        // disable with GORDON_GENOME_REJECTION=0, tune via *_MIN_DROP.
        if (isGenomeRejectionEnabled()) {
          const rejections = deriveRejectedMutations(manager.getGenomes(slot.playbook_name), {
            minFitnessDrop: genomeRejectionMinDrop(),
          });
          if (rejections.length > 0) {
            const { kept, suppressed } = filterRejectedMutations(mutations, rejections);
            if (suppressed.length > 0) {
              logger.info("Suppressed known-regressive mutations", {
                playbook: slot.playbook_name,
                suppressed: suppressed.map((s) => `${s.mutation.field_path}:${s.rejection.direction}`),
              });
            }
            mutations.length = 0;
            mutations.push(...kept);
          }
        }

        // If every candidate was a known-bad mutation, skip this fork tick —
        // the loop will retry next tick with fresh regime/insight signals.
        if (mutations.length === 0) {
          logger.info("All candidate mutations suppressed by rejection memory — skipping fork", {
            playbook: slot.playbook_name,
          });
          continue;
        }

        // Fork the variant
        const { genome: variant } = manager.forkWithMutations(
          genome.genome_id,
          mutations,
        );

        // Determine a symbol for the experiment (use the slot's most-traded symbol)
        const recentTrades = listTrades({ status: "CLOSED" });
        const symbol = recentTrades.length > 0
          ? recentTrades[recentTrades.length - 1]!.symbol
          : "BTCUSDT";

        // Start A/B experiment
        manager.startExperiment(
          genome.genome_id,
          variant.genome_id,
          symbol,
          {
            min_trades: 10,
            max_duration_days: 14,
            name: `${slot.playbook_name}: gen${genome.generation} vs gen${variant.generation}`,
          },
        );

        result.variantsForked++;

        logger.info("Forked new variant and started experiment", {
          slot: slot.slot_id,
          playbook: slot.playbook_name,
          parent: genome.genome_id,
          variant: variant.genome_id,
          mutations: mutations.length,
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        result.errors.push(`Fork failed for slot ${slot.slot_id}: ${msg}`);
        logger.warn("Failed to fork variant", {
          slot: slot.slot_id,
          error: msg,
        });
      }
    }
  }

  // ==========================================================================
  // Phase 3: Crossover
  // ==========================================================================

  private tryCrossover(result: EvolutionTickResult): void {
    try {
      const manager = GenomeManager.getInstance();
      const mutator = manager.getMutator();

      // Get high-fitness live/candidate genomes
      const liveGenomes = getGenomesByStatus("live");
      const candidates = getGenomesByStatus("candidate");
      const pool = [...liveGenomes, ...candidates]
        .filter((g) => g.fitness_score !== undefined && g.fitness_score > 30)
        .sort((a, b) => (b.fitness_score ?? 0) - (a.fitness_score ?? 0))
        .slice(0, 10); // Top 10 by fitness

      if (pool.length < 2) return;

      // Pick two random parents from the pool
      const idx1 = Math.floor(Math.random() * pool.length);
      let idx2 = Math.floor(Math.random() * (pool.length - 1));
      if (idx2 >= idx1) idx2++;

      const parent1 = pool[idx1]!;
      const parent2 = pool[idx2]!;

      const pb1 = playbookRegistry.get(parent1.playbook_name);
      const pb2 = playbookRegistry.get(parent2.playbook_name);
      if (!pb1 || !pb2) return;

      const proto1 = playbookToProtocol(pb1);
      const proto2 = playbookToProtocol(pb2);

      const { mutations } = mutator.crossover(proto1, proto2);
      if (mutations.length === 0) return;

      // Fork the crossover child from parent1
      const { genome: child } = manager.forkWithMutations(
        parent1.genome_id,
        mutations,
      );

      result.crossoversCreated++;

      logger.info("Crossover child created", {
        parent1: parent1.genome_id,
        parent2: parent2.genome_id,
        child: child.genome_id,
        mutations: mutations.length,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      result.errors.push(`Crossover failed: ${msg}`);
      logger.debug("Crossover failed", { error: msg });
    }
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  /**
   * Update a strategy slot's genome_id after a winner is promoted.
   * Persists the change via the runtime store (not just in-memory).
   */
  private updateSlotGenome(playbookName: string, genomeId: string): void {
    try {
      const runtime = StrategyRuntime.getInstance();
      const slots = runtime.getActiveSlots();
      const matchingSlot = slots.find((s) => s.playbook_name === playbookName);

      if (matchingSlot) {
        // Update the slot's genome_id and persist via deployStrategy path
        matchingSlot.genome_id = genomeId;
        // Re-save the slot to persist to SQLite
        const runtimeStore = getRuntimeStore();
        runtimeStore.saveSlot(matchingSlot);

        logger.debug("Updated and persisted slot genome_id", {
          slot: matchingSlot.slot_id,
          genome: genomeId,
        });
      }
    } catch (err) {
      logger.debug("Could not update slot genome", {
        playbook: playbookName,
        error: (err as Error).message,
      });
    }
  }
}
