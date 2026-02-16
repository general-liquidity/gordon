/**
 * Strategy Genome — Barrel Exports
 *
 * Evolutionary playbook system: fork, mutate, A/B test, and select
 * playbook variants based on performance fitness.
 */

// Types
export {
  MutationSchema,
  GenomeSchema,
  ExperimentSchema,
  MutationSuggestionSchema,
  type Mutation,
  type Genome,
  type Experiment,
  type MutationSuggestion,
} from "./types.ts";

// Manager (main facade)
export { GenomeManager } from "./manager.ts";

// Mutator
export { PlaybookMutator } from "./mutator.ts";

// Fitness
export { FitnessCalculator } from "./fitness.ts";

// Store
export {
  initGenomeTables,
  saveGenome,
  getGenome,
  getGenomesByPlaybook,
  getGenomesByStatus,
  getBestGenome,
  getLineage,
  saveExperiment,
  getExperiment,
  getActiveExperiments,
  updateExperiment,
  saveSuggestion,
  getPendingSuggestions,
} from "./store.ts";
