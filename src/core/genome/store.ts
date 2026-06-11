/**
 * Strategy Genome Store
 *
 * SQLite persistence for genomes, experiments, and mutation suggestions.
 * Follows the same patterns as src/core/backtesting/store.ts for consistency.
 */

import { getDatabase } from "../../infra/storage/index.ts";
import { createModuleLogger } from "../../infra/logger/index.ts";
import type { Genome, Experiment, MutationSuggestion } from "./types.ts";

const logger = createModuleLogger("genome-store");

// ============================================================================
// Table Initialization
// ============================================================================

let tablesInitialized = false;

/**
 * Initialize the genome-related tables.
 * Safe to call multiple times (idempotent).
 */
export function initGenomeTables(): void {
  if (tablesInitialized) return;

  const db = getDatabase();

  db.run(`
    CREATE TABLE IF NOT EXISTS genomes (
      genome_id TEXT PRIMARY KEY,
      playbook_name TEXT NOT NULL,
      parent_genome_id TEXT,
      generation INTEGER NOT NULL DEFAULT 0,
      mutations_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'candidate',

      backtest_sharpe REAL,
      backtest_win_rate REAL,
      backtest_profit_factor REAL,
      backtest_max_drawdown REAL,

      paper_trades INTEGER NOT NULL DEFAULT 0,
      paper_pnl REAL NOT NULL DEFAULT 0,
      paper_win_rate REAL,

      live_trades INTEGER NOT NULL DEFAULT 0,
      live_pnl REAL NOT NULL DEFAULT 0,
      live_win_rate REAL,

      fitness_score REAL,

      created_at TEXT NOT NULL,
      promoted_at TEXT,
      deprecated_at TEXT
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_genomes_playbook
    ON genomes(playbook_name)
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_genomes_status
    ON genomes(status)
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_genomes_parent
    ON genomes(parent_genome_id)
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_genomes_fitness
    ON genomes(fitness_score)
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS experiments (
      experiment_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      control_genome_id TEXT NOT NULL,
      variant_genome_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      symbol TEXT NOT NULL,
      min_trades INTEGER NOT NULL DEFAULT 10,
      max_duration_days INTEGER NOT NULL DEFAULT 30,

      control_trades INTEGER NOT NULL DEFAULT 0,
      control_pnl REAL NOT NULL DEFAULT 0,
      variant_trades INTEGER NOT NULL DEFAULT 0,
      variant_pnl REAL NOT NULL DEFAULT 0,

      winner TEXT NOT NULL DEFAULT 'undecided',
      winner_reason TEXT,

      started_at TEXT NOT NULL,
      ended_at TEXT
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_experiments_status
    ON experiments(status)
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS mutation_suggestions (
      suggestion_id TEXT PRIMARY KEY,
      genome_id TEXT NOT NULL,
      suggested_by TEXT NOT NULL,
      reason TEXT NOT NULL,
      mutations_json TEXT NOT NULL,
      confidence REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_suggestions_genome
    ON mutation_suggestions(genome_id)
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_suggestions_status
    ON mutation_suggestions(status)
  `);

  tablesInitialized = true;
  logger.debug("Genome tables initialized");
}

// ============================================================================
// Genome Row Mapping
// ============================================================================

interface GenomeRow {
  genome_id: string;
  playbook_name: string;
  parent_genome_id: string | null;
  generation: number;
  mutations_json: string;
  status: string;
  backtest_sharpe: number | null;
  backtest_win_rate: number | null;
  backtest_profit_factor: number | null;
  backtest_max_drawdown: number | null;
  paper_trades: number;
  paper_pnl: number;
  paper_win_rate: number | null;
  live_trades: number;
  live_pnl: number;
  live_win_rate: number | null;
  fitness_score: number | null;
  created_at: string;
  promoted_at: string | null;
  deprecated_at: string | null;
}

function rowToGenome(row: GenomeRow): Genome {
  return {
    genome_id: row.genome_id,
    playbook_name: row.playbook_name,
    parent_genome_id: row.parent_genome_id ?? undefined,
    generation: row.generation,
    mutations_from_parent: JSON.parse(row.mutations_json),
    status: row.status as Genome["status"],
    backtest_sharpe: row.backtest_sharpe ?? undefined,
    backtest_win_rate: row.backtest_win_rate ?? undefined,
    backtest_profit_factor: row.backtest_profit_factor ?? undefined,
    backtest_max_drawdown: row.backtest_max_drawdown ?? undefined,
    paper_trades: row.paper_trades,
    paper_pnl: row.paper_pnl,
    paper_win_rate: row.paper_win_rate ?? undefined,
    live_trades: row.live_trades,
    live_pnl: row.live_pnl,
    live_win_rate: row.live_win_rate ?? undefined,
    fitness_score: row.fitness_score ?? undefined,
    created_at: row.created_at,
    promoted_at: row.promoted_at ?? undefined,
    deprecated_at: row.deprecated_at ?? undefined,
  };
}

// ============================================================================
// Genome CRUD
// ============================================================================

/**
 * Save or update a genome.
 */
export function saveGenome(genome: Genome): void {
  try {
    initGenomeTables();
    const db = getDatabase();

    const stmt = db.prepare(`
      INSERT OR REPLACE INTO genomes (
        genome_id, playbook_name, parent_genome_id, generation,
        mutations_json, status,
        backtest_sharpe, backtest_win_rate, backtest_profit_factor, backtest_max_drawdown,
        paper_trades, paper_pnl, paper_win_rate,
        live_trades, live_pnl, live_win_rate,
        fitness_score, created_at, promoted_at, deprecated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      genome.genome_id,
      genome.playbook_name,
      genome.parent_genome_id ?? null,
      genome.generation,
      JSON.stringify(genome.mutations_from_parent),
      genome.status,
      genome.backtest_sharpe ?? null,
      genome.backtest_win_rate ?? null,
      genome.backtest_profit_factor ?? null,
      genome.backtest_max_drawdown ?? null,
      genome.paper_trades,
      genome.paper_pnl,
      genome.paper_win_rate ?? null,
      genome.live_trades,
      genome.live_pnl,
      genome.live_win_rate ?? null,
      genome.fitness_score ?? null,
      genome.created_at,
      genome.promoted_at ?? null,
      genome.deprecated_at ?? null,
    );

    logger.debug("Saved genome", { genome_id: genome.genome_id, playbook: genome.playbook_name });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("Failed to save genome", { error: msg });
    throw err;
  }
}

/**
 * Load a genome by ID.
 */
export function getGenome(genomeId: string): Genome | null {
  try {
    initGenomeTables();
    const db = getDatabase();
    const stmt = db.prepare<GenomeRow, [string]>(
      "SELECT * FROM genomes WHERE genome_id = ?"
    );
    const row = stmt.get(genomeId);
    return row ? rowToGenome(row) : null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("Failed to get genome", { genome_id: genomeId, error: msg });
    return null;
  }
}

/**
 * Get all genomes for a playbook.
 */
export function getGenomesByPlaybook(playbookName: string): Genome[] {
  try {
    initGenomeTables();
    const db = getDatabase();
    const stmt = db.prepare<GenomeRow, [string]>(
      "SELECT * FROM genomes WHERE playbook_name = ? ORDER BY generation ASC, created_at ASC"
    );
    return stmt.all(playbookName).map(rowToGenome);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("Failed to get genomes by playbook", { playbook: playbookName, error: msg });
    return [];
  }
}

/**
 * Get all genomes with a specific status.
 */
export function getGenomesByStatus(status: Genome["status"]): Genome[] {
  try {
    initGenomeTables();
    const db = getDatabase();
    const stmt = db.prepare<GenomeRow, [string]>(
      "SELECT * FROM genomes WHERE status = ? ORDER BY fitness_score DESC"
    );
    return stmt.all(status).map(rowToGenome);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("Failed to get genomes by status", { status, error: msg });
    return [];
  }
}

/**
 * Get the best genome for a playbook (highest fitness score).
 */
export function getBestGenome(playbookName: string): Genome | null {
  try {
    initGenomeTables();
    const db = getDatabase();
    const stmt = db.prepare<GenomeRow, [string]>(
      "SELECT * FROM genomes WHERE playbook_name = ? AND fitness_score IS NOT NULL ORDER BY fitness_score DESC LIMIT 1"
    );
    const row = stmt.get(playbookName);
    return row ? rowToGenome(row) : null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("Failed to get best genome", { playbook: playbookName, error: msg });
    return null;
  }
}

/**
 * Trace the full lineage chain from a genome back to generation 0.
 */
export function getLineage(genomeId: string): Genome[] {
  const chain: Genome[] = [];
  let currentId: string | undefined = genomeId;

  while (currentId) {
    const genome = getGenome(currentId);
    if (!genome) break;
    chain.unshift(genome); // prepend so chain is oldest-first
    currentId = genome.parent_genome_id;
  }

  return chain;
}

// ============================================================================
// Experiment CRUD
// ============================================================================

interface ExperimentRow {
  experiment_id: string;
  name: string;
  control_genome_id: string;
  variant_genome_id: string;
  status: string;
  symbol: string;
  min_trades: number;
  max_duration_days: number;
  control_trades: number;
  control_pnl: number;
  variant_trades: number;
  variant_pnl: number;
  winner: string;
  winner_reason: string | null;
  started_at: string;
  ended_at: string | null;
}

function rowToExperiment(row: ExperimentRow): Experiment {
  return {
    experiment_id: row.experiment_id,
    name: row.name,
    control_genome_id: row.control_genome_id,
    variant_genome_id: row.variant_genome_id,
    status: row.status as Experiment["status"],
    symbol: row.symbol,
    min_trades: row.min_trades,
    max_duration_days: row.max_duration_days,
    control_trades: row.control_trades,
    control_pnl: row.control_pnl,
    variant_trades: row.variant_trades,
    variant_pnl: row.variant_pnl,
    winner: row.winner as Experiment["winner"],
    winner_reason: row.winner_reason ?? undefined,
    started_at: row.started_at,
    ended_at: row.ended_at ?? undefined,
  };
}

/**
 * Save or update an experiment.
 */
export function saveExperiment(experiment: Experiment): void {
  try {
    initGenomeTables();
    const db = getDatabase();

    const stmt = db.prepare(`
      INSERT OR REPLACE INTO experiments (
        experiment_id, name, control_genome_id, variant_genome_id,
        status, symbol, min_trades, max_duration_days,
        control_trades, control_pnl, variant_trades, variant_pnl,
        winner, winner_reason, started_at, ended_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      experiment.experiment_id,
      experiment.name,
      experiment.control_genome_id,
      experiment.variant_genome_id,
      experiment.status,
      experiment.symbol,
      experiment.min_trades,
      experiment.max_duration_days,
      experiment.control_trades,
      experiment.control_pnl,
      experiment.variant_trades,
      experiment.variant_pnl,
      experiment.winner,
      experiment.winner_reason ?? null,
      experiment.started_at,
      experiment.ended_at ?? null,
    );

    logger.debug("Saved experiment", { experiment_id: experiment.experiment_id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("Failed to save experiment", { error: msg });
    throw err;
  }
}

/**
 * Load an experiment by ID.
 */
export function getExperiment(experimentId: string): Experiment | null {
  try {
    initGenomeTables();
    const db = getDatabase();
    const stmt = db.prepare<ExperimentRow, [string]>(
      "SELECT * FROM experiments WHERE experiment_id = ?"
    );
    const row = stmt.get(experimentId);
    return row ? rowToExperiment(row) : null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("Failed to get experiment", { experiment_id: experimentId, error: msg });
    return null;
  }
}

/**
 * Get all active (running) experiments.
 */
export function getActiveExperiments(): Experiment[] {
  try {
    initGenomeTables();
    const db = getDatabase();
    const stmt = db.prepare<ExperimentRow, []>(
      "SELECT * FROM experiments WHERE status = 'running' ORDER BY started_at DESC"
    );
    return stmt.all().map(rowToExperiment);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("Failed to get active experiments", { error: msg });
    return [];
  }
}

/**
 * Update specific fields on an experiment.
 */
export function updateExperiment(
  experimentId: string,
  data: Partial<Pick<Experiment,
    "status" | "control_trades" | "control_pnl" | "variant_trades" | "variant_pnl" |
    "winner" | "winner_reason" | "ended_at"
  >>
): void {
  const existing = getExperiment(experimentId);
  if (!existing) {
    throw new Error(`Experiment ${experimentId} not found`);
  }

  const updated: Experiment = { ...existing, ...data };
  saveExperiment(updated);
}

// ============================================================================
// Mutation Suggestion CRUD
// ============================================================================

interface SuggestionRow {
  suggestion_id: string;
  genome_id: string;
  suggested_by: string;
  reason: string;
  mutations_json: string;
  confidence: number;
  status: string;
  created_at: string;
}

function rowToSuggestion(row: SuggestionRow): MutationSuggestion {
  return {
    suggestion_id: row.suggestion_id,
    genome_id: row.genome_id,
    suggested_by: row.suggested_by,
    reason: row.reason,
    mutations: JSON.parse(row.mutations_json),
    confidence: row.confidence,
    status: row.status as MutationSuggestion["status"],
    created_at: row.created_at,
  };
}

/**
 * Save a mutation suggestion.
 */
export function saveSuggestion(suggestion: MutationSuggestion): void {
  try {
    initGenomeTables();
    const db = getDatabase();

    const stmt = db.prepare(`
      INSERT OR REPLACE INTO mutation_suggestions (
        suggestion_id, genome_id, suggested_by, reason,
        mutations_json, confidence, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      suggestion.suggestion_id,
      suggestion.genome_id,
      suggestion.suggested_by,
      suggestion.reason,
      JSON.stringify(suggestion.mutations),
      suggestion.confidence,
      suggestion.status,
      suggestion.created_at,
    );

    logger.debug("Saved mutation suggestion", { suggestion_id: suggestion.suggestion_id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("Failed to save mutation suggestion", { error: msg });
    throw err;
  }
}

/**
 * Get pending mutation suggestions for a genome.
 */
export function getPendingSuggestions(genomeId: string): MutationSuggestion[] {
  try {
    initGenomeTables();
    const db = getDatabase();
    const stmt = db.prepare<SuggestionRow, [string]>(
      "SELECT * FROM mutation_suggestions WHERE genome_id = ? AND status = 'pending' ORDER BY confidence DESC"
    );
    return stmt.all(genomeId).map(rowToSuggestion);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("Failed to get pending suggestions", { genome_id: genomeId, error: msg });
    return [];
  }
}
