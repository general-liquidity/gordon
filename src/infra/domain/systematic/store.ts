import { getDatabase } from "../../storage/database.ts";
import { createModuleLogger } from "../../logger/index.ts";
import type { OHLC } from "../../../backtest/types.ts";
import type {
  DatasetRecord,
  DatasetSnapshotRecord,
  ResearchExperimentRecord,
  StrategyLifecycleEvent,
  SystematicStrategyProfile,
  SystematicValidationSummary,
} from "./types.ts";

const logger = createModuleLogger("systematic-store");

let initialized = false;

export function initSystematicTables(): void {
  if (initialized) return;

  const db = getDatabase();

  db.run(`
    CREATE TABLE IF NOT EXISTS systematic_datasets (
      dataset_id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      market_family TEXT NOT NULL,
      symbol TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      source_id TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      start_time INTEGER NOT NULL,
      end_time INTEGER NOT NULL,
      candle_count INTEGER NOT NULL,
      quality_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_systematic_datasets_symbol_tf ON systematic_datasets(symbol, timeframe)");

  db.run(`
    CREATE TABLE IF NOT EXISTS systematic_dataset_snapshots (
      snapshot_id TEXT PRIMARY KEY,
      dataset_id TEXT NOT NULL,
      start_time INTEGER NOT NULL,
      end_time INTEGER NOT NULL,
      candle_count INTEGER NOT NULL,
      candles_json TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_systematic_snapshot_dataset ON systematic_dataset_snapshots(dataset_id)");

  db.run(`
    CREATE TABLE IF NOT EXISTS systematic_validation_runs (
      validation_id TEXT PRIMARY KEY,
      strategy_id TEXT NOT NULL,
      strategy_name TEXT NOT NULL,
      dataset_id TEXT,
      dataset_snapshot_id TEXT,
      backtest_result_id TEXT,
      market_family TEXT NOT NULL,
      status TEXT NOT NULL,
      score REAL NOT NULL,
      live_eligible INTEGER NOT NULL DEFAULT 0,
      gates_json TEXT NOT NULL,
      walk_forward_json TEXT,
      monte_carlo_json TEXT,
      overfitting_json TEXT,
      bias_json TEXT,
      created_at TEXT NOT NULL
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_systematic_validation_strategy ON systematic_validation_runs(strategy_id, created_at)");

  db.run(`
    CREATE TABLE IF NOT EXISTS systematic_experiments (
      experiment_id TEXT PRIMARY KEY,
      strategy_id TEXT NOT NULL,
      strategy_name TEXT NOT NULL,
      hypothesis TEXT NOT NULL,
      notes TEXT NOT NULL,
      dataset_id TEXT,
      dataset_snapshot_id TEXT,
      backtest_result_id TEXT,
      validation_id TEXT,
      status TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_systematic_experiments_strategy ON systematic_experiments(strategy_id, updated_at)");

  db.run(`
    CREATE TABLE IF NOT EXISTS systematic_strategy_profiles (
      strategy_id TEXT PRIMARY KEY,
      strategy_name TEXT NOT NULL,
      market_family TEXT NOT NULL,
      status TEXT NOT NULL,
      validation_status TEXT NOT NULL,
      validation_score REAL NOT NULL,
      return_driver TEXT NOT NULL,
      regime_tag TEXT NOT NULL,
      capital_weight REAL NOT NULL,
      max_allocation REAL NOT NULL,
      latest_dataset_id TEXT,
      latest_dataset_snapshot_id TEXT,
      latest_backtest_result_id TEXT,
      latest_validation_id TEXT,
      live_eligible INTEGER NOT NULL DEFAULT 0,
      last_metrics_json TEXT,
      decay_score REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_systematic_profiles_status ON systematic_strategy_profiles(status, market_family)");

  db.run(`
    CREATE TABLE IF NOT EXISTS systematic_lifecycle_events (
      event_id TEXT PRIMARY KEY,
      strategy_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_systematic_lifecycle_strategy ON systematic_lifecycle_events(strategy_id, created_at)");

  initialized = true;
  try {
    db.run("ALTER TABLE systematic_validation_runs ADD COLUMN bias_json TEXT");
  } catch {
    // Column already exists.
  }
  logger.info("Systematic trading tables initialized");
}

export function saveDatasetRecord(record: DatasetRecord): void {
  initSystematicTables();
  const db = getDatabase();
  db.prepare(`
    INSERT OR REPLACE INTO systematic_datasets (
      dataset_id, kind, market_family, symbol, timeframe, source_id, source_kind,
      start_time, end_time, candle_count, quality_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.datasetId,
    record.kind,
    record.marketFamily,
    record.symbol,
    record.timeframe,
    record.sourceId,
    record.sourceKind,
    record.startTime,
    record.endTime,
    record.candleCount,
    JSON.stringify(record.quality),
    record.createdAt,
    record.updatedAt,
  );
}

export function getDatasetRecord(datasetId: string): DatasetRecord | null {
  initSystematicTables();
  const row = getDatabase()
    .prepare<Record<string, unknown>, [string]>("SELECT * FROM systematic_datasets WHERE dataset_id = ?")
    .get(datasetId);

  if (!row) return null;

  return {
    datasetId: String(row.dataset_id),
    kind: row.kind as DatasetRecord["kind"],
    marketFamily: row.market_family as DatasetRecord["marketFamily"],
    symbol: String(row.symbol),
    timeframe: String(row.timeframe),
    sourceId: String(row.source_id),
    sourceKind: row.source_kind as DatasetRecord["sourceKind"],
    startTime: Number(row.start_time),
    endTime: Number(row.end_time),
    candleCount: Number(row.candle_count),
    quality: JSON.parse(String(row.quality_json)),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function listDatasetRecords(options: {
  marketFamily?: DatasetRecord["marketFamily"];
  symbol?: string;
  timeframe?: string;
  limit?: number;
} = {}): DatasetRecord[] {
  initSystematicTables();

  const conditions: string[] = [];
  const params: Array<string | number> = [];

  if (options.marketFamily) {
    conditions.push("market_family = ?");
    params.push(options.marketFamily);
  }

  if (options.symbol) {
    conditions.push("symbol = ?");
    params.push(options.symbol.toUpperCase());
  }

  if (options.timeframe) {
    conditions.push("timeframe = ?");
    params.push(options.timeframe);
  }

  let sql = "SELECT * FROM systematic_datasets";
  if (conditions.length > 0) {
    sql += ` WHERE ${conditions.join(" AND ")}`;
  }
  sql += " ORDER BY updated_at DESC";
  if (options.limit) {
    sql += " LIMIT ?";
    params.push(options.limit);
  }

  return getDatabase()
    .prepare<Record<string, unknown>, Array<string | number>>(sql)
    .all(...params)
    .map((row) => ({
      datasetId: String(row.dataset_id),
      kind: row.kind as DatasetRecord["kind"],
      marketFamily: row.market_family as DatasetRecord["marketFamily"],
      symbol: String(row.symbol),
      timeframe: String(row.timeframe),
      sourceId: String(row.source_id),
      sourceKind: row.source_kind as DatasetRecord["sourceKind"],
      startTime: Number(row.start_time),
      endTime: Number(row.end_time),
      candleCount: Number(row.candle_count),
      quality: JSON.parse(String(row.quality_json)),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    }));
}

export function saveDatasetSnapshot(record: DatasetSnapshotRecord, candles: unknown): void {
  initSystematicTables();
  const db = getDatabase();
  db.prepare(`
    INSERT OR REPLACE INTO systematic_dataset_snapshots (
      snapshot_id, dataset_id, start_time, end_time, candle_count, candles_json, metadata_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.snapshotId,
    record.datasetId,
    record.startTime,
    record.endTime,
    record.candleCount,
    JSON.stringify(candles),
    JSON.stringify(record.metadata),
    record.createdAt,
  );
}

export function getDatasetSnapshot(snapshotId: string): (DatasetSnapshotRecord & { candles: OHLC[] }) | null {
  initSystematicTables();
  const row = getDatabase()
    .prepare<Record<string, unknown>, [string]>(
      "SELECT * FROM systematic_dataset_snapshots WHERE snapshot_id = ?",
    )
    .get(snapshotId);

  if (!row) return null;

  return {
    snapshotId: String(row.snapshot_id),
    datasetId: String(row.dataset_id),
    startTime: Number(row.start_time),
    endTime: Number(row.end_time),
    candleCount: Number(row.candle_count),
    metadata: JSON.parse(String(row.metadata_json)),
    createdAt: String(row.created_at),
    candles: JSON.parse(String(row.candles_json)) as OHLC[],
  };
}

export function saveValidationRun(record: SystematicValidationSummary & {
  datasetId?: string;
  datasetSnapshotId?: string;
  backtestResultId?: string;
  marketFamily: string;
}): void {
  initSystematicTables();
  const db = getDatabase();
  db.prepare(`
    INSERT OR REPLACE INTO systematic_validation_runs (
      validation_id, strategy_id, strategy_name, dataset_id, dataset_snapshot_id, backtest_result_id,
      market_family, status, score, live_eligible, gates_json, walk_forward_json, monte_carlo_json,
      overfitting_json, bias_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.validationId,
    record.strategyId,
    record.strategyName,
    record.datasetId ?? null,
    record.datasetSnapshotId ?? null,
    record.backtestResultId ?? null,
    record.marketFamily,
    record.status,
    record.score,
    record.liveEligible ? 1 : 0,
    JSON.stringify(record.gates),
    record.walkForwardSummary ? JSON.stringify(record.walkForwardSummary) : null,
    record.monteCarloSummary ? JSON.stringify(record.monteCarloSummary) : null,
    record.overfittingSummary ? JSON.stringify(record.overfittingSummary) : null,
    record.biasDiagnostics ? JSON.stringify(record.biasDiagnostics) : null,
    record.createdAt,
  );
}

export function listDatasetSnapshots(datasetId?: string): DatasetSnapshotRecord[] {
  initSystematicTables();
  const rows = datasetId
    ? getDatabase()
      .prepare<Record<string, unknown>, [string]>(`
        SELECT * FROM systematic_dataset_snapshots
        WHERE dataset_id = ?
        ORDER BY created_at DESC
      `)
      .all(datasetId)
    : getDatabase()
      .prepare<Record<string, unknown>, []>(`
        SELECT * FROM systematic_dataset_snapshots
        ORDER BY created_at DESC
      `)
      .all();

  return rows.map((row) => ({
    snapshotId: String(row.snapshot_id),
    datasetId: String(row.dataset_id),
    startTime: Number(row.start_time),
    endTime: Number(row.end_time),
    candleCount: Number(row.candle_count),
    metadata: JSON.parse(String(row.metadata_json)),
    createdAt: String(row.created_at),
  }));
}

export function saveResearchExperiment(record: ResearchExperimentRecord): void {
  initSystematicTables();
  const db = getDatabase();
  db.prepare(`
    INSERT OR REPLACE INTO systematic_experiments (
      experiment_id, strategy_id, strategy_name, hypothesis, notes, dataset_id,
      dataset_snapshot_id, backtest_result_id, validation_id, status, tags_json,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.experimentId,
    record.strategyId,
    record.strategyName,
    record.hypothesis,
    record.notes,
    record.datasetId ?? null,
    record.datasetSnapshotId ?? null,
    record.backtestResultId ?? null,
    record.validationId ?? null,
    record.status,
    JSON.stringify(record.tags),
    record.createdAt,
    record.updatedAt,
  );
}

export function upsertStrategyProfile(record: SystematicStrategyProfile): void {
  initSystematicTables();
  const db = getDatabase();
  db.prepare(`
    INSERT OR REPLACE INTO systematic_strategy_profiles (
      strategy_id, strategy_name, market_family, status, validation_status, validation_score,
      return_driver, regime_tag, capital_weight, max_allocation, latest_dataset_id,
      latest_dataset_snapshot_id, latest_backtest_result_id, latest_validation_id, live_eligible,
      last_metrics_json, decay_score, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.strategyId,
    record.strategyName,
    record.marketFamily,
    record.status,
    record.validationStatus,
    record.validationScore,
    record.returnDriver,
    record.regimeTag,
    record.capitalWeight,
    record.maxAllocation,
    record.latestDatasetId ?? null,
    record.latestDatasetSnapshotId ?? null,
    record.latestBacktestResultId ?? null,
    record.latestValidationId ?? null,
    record.liveEligible ? 1 : 0,
    record.lastMetrics ? JSON.stringify(record.lastMetrics) : null,
    record.decayScore,
    record.createdAt,
    record.updatedAt,
  );
}

export function saveStrategyLifecycleEvent(record: StrategyLifecycleEvent): void {
  initSystematicTables();
  const db = getDatabase();
  db.prepare(`
    INSERT OR REPLACE INTO systematic_lifecycle_events (
      event_id, strategy_id, event_type, payload_json, created_at
    ) VALUES (?, ?, ?, ?, ?)
  `).run(
    record.eventId,
    record.strategyId,
    record.eventType,
    JSON.stringify(record.payload),
    record.createdAt,
  );
}

function parseProfile(row: Record<string, unknown>): SystematicStrategyProfile {
  return {
    strategyId: String(row.strategy_id),
    strategyName: String(row.strategy_name),
    marketFamily: row.market_family as SystematicStrategyProfile["marketFamily"],
    status: row.status as SystematicStrategyProfile["status"],
    validationStatus: row.validation_status as SystematicStrategyProfile["validationStatus"],
    validationScore: Number(row.validation_score),
    returnDriver: String(row.return_driver),
    regimeTag: String(row.regime_tag),
    capitalWeight: Number(row.capital_weight),
    maxAllocation: Number(row.max_allocation),
    latestDatasetId: row.latest_dataset_id ? String(row.latest_dataset_id) : undefined,
    latestDatasetSnapshotId: row.latest_dataset_snapshot_id ? String(row.latest_dataset_snapshot_id) : undefined,
    latestBacktestResultId: row.latest_backtest_result_id ? String(row.latest_backtest_result_id) : undefined,
    latestValidationId: row.latest_validation_id ? String(row.latest_validation_id) : undefined,
    liveEligible: Number(row.live_eligible) === 1,
    lastMetrics: row.last_metrics_json ? JSON.parse(String(row.last_metrics_json)) : undefined,
    decayScore: Number(row.decay_score),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function getStrategyProfile(strategyId: string): SystematicStrategyProfile | null {
  initSystematicTables();
  const row = getDatabase()
    .prepare<Record<string, unknown>, [string]>("SELECT * FROM systematic_strategy_profiles WHERE strategy_id = ?")
    .get(strategyId);
  return row ? parseProfile(row) : null;
}

export function listStrategyProfiles(): SystematicStrategyProfile[] {
  initSystematicTables();
  return getDatabase()
    .prepare<Record<string, unknown>, []>("SELECT * FROM systematic_strategy_profiles ORDER BY updated_at DESC")
    .all()
    .map(parseProfile);
}

export function getLatestValidationForStrategy(strategyId: string): SystematicValidationSummary | null {
  initSystematicTables();
  const row = getDatabase()
    .prepare<Record<string, unknown>, [string]>(`
      SELECT * FROM systematic_validation_runs
      WHERE strategy_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `)
    .get(strategyId);

  if (!row) return null;

  return {
    validationId: String(row.validation_id),
    strategyId: String(row.strategy_id),
    strategyName: String(row.strategy_name),
    status: row.status as SystematicValidationSummary["status"],
    score: Number(row.score),
    liveEligible: Number(row.live_eligible) === 1,
    gates: JSON.parse(String(row.gates_json)),
    walkForwardSummary: row.walk_forward_json ? JSON.parse(String(row.walk_forward_json)) : undefined,
    monteCarloSummary: row.monte_carlo_json ? JSON.parse(String(row.monte_carlo_json)) : undefined,
    overfittingSummary: row.overfitting_json ? JSON.parse(String(row.overfitting_json)) : undefined,
    biasDiagnostics: row.bias_json ? JSON.parse(String(row.bias_json)) : undefined,
    createdAt: String(row.created_at),
  };
}

export function getValidationRun(validationId: string): SystematicValidationSummary | null {
  initSystematicTables();
  const row = getDatabase()
    .prepare<Record<string, unknown>, [string]>("SELECT * FROM systematic_validation_runs WHERE validation_id = ?")
    .get(validationId);

  if (!row) return null;

  return {
    validationId: String(row.validation_id),
    strategyId: String(row.strategy_id),
    strategyName: String(row.strategy_name),
    status: row.status as SystematicValidationSummary["status"],
    score: Number(row.score),
    liveEligible: Number(row.live_eligible) === 1,
    gates: JSON.parse(String(row.gates_json)),
    walkForwardSummary: row.walk_forward_json ? JSON.parse(String(row.walk_forward_json)) : undefined,
    monteCarloSummary: row.monte_carlo_json ? JSON.parse(String(row.monte_carlo_json)) : undefined,
    overfittingSummary: row.overfitting_json ? JSON.parse(String(row.overfitting_json)) : undefined,
    biasDiagnostics: row.bias_json ? JSON.parse(String(row.bias_json)) : undefined,
    createdAt: String(row.created_at),
  };
}

export function listResearchExperiments(strategyId?: string): ResearchExperimentRecord[] {
  initSystematicTables();
  const rows = strategyId
    ? getDatabase()
      .prepare<Record<string, unknown>, [string]>(`
        SELECT * FROM systematic_experiments
        WHERE strategy_id = ?
        ORDER BY updated_at DESC
      `)
      .all(strategyId)
    : getDatabase()
      .prepare<Record<string, unknown>, []>("SELECT * FROM systematic_experiments ORDER BY updated_at DESC")
      .all();

  return rows.map((row) => ({
    experimentId: String(row.experiment_id),
    strategyId: String(row.strategy_id),
    strategyName: String(row.strategy_name),
    hypothesis: String(row.hypothesis),
    notes: String(row.notes),
    datasetId: row.dataset_id ? String(row.dataset_id) : undefined,
    datasetSnapshotId: row.dataset_snapshot_id ? String(row.dataset_snapshot_id) : undefined,
    backtestResultId: row.backtest_result_id ? String(row.backtest_result_id) : undefined,
    validationId: row.validation_id ? String(row.validation_id) : undefined,
    status: row.status as ResearchExperimentRecord["status"],
    tags: JSON.parse(String(row.tags_json)),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }));
}

export function listStrategyLifecycleEvents(strategyId: string): StrategyLifecycleEvent[] {
  initSystematicTables();
  return getDatabase()
    .prepare<Record<string, unknown>, [string]>(`
      SELECT * FROM systematic_lifecycle_events
      WHERE strategy_id = ?
      ORDER BY created_at DESC
    `)
    .all(strategyId)
    .map((row) => ({
      eventId: String(row.event_id),
      strategyId: String(row.strategy_id),
      eventType: row.event_type as StrategyLifecycleEvent["eventType"],
      payload: JSON.parse(String(row.payload_json)),
      createdAt: String(row.created_at),
    }));
}
