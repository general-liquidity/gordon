import { mkdir, writeFile } from "fs/promises";
import path from "path";

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { loadBacktestResult } from "../../../backtest/persistence/storage.ts";
import {
  buildSystematicPortfolioSummary,
  buildDatasetInventoryReport,
  buildDecayOperatorReport,
  buildExperimentsReport,
  buildLifecycleReport,
  buildPortfolioOperatorReport,
  buildStrategyStatusReport,
  formatOperatorReport,
  getDatasetSnapshot,
  getSystematicStrategyStatus,
  getValidationRun,
  listDatasetRecords,
  listDatasetSnapshots,
  listResearchExperiments,
  operatorReportSchema,
} from "../../domain/systematic/index.ts";

const datasetRowSchema = z.object({
  datasetId: z.string(),
  symbol: z.string(),
  timeframe: z.string(),
  marketFamily: z.enum(["crypto", "stocks"]),
  sourceId: z.string(),
  sourceKind: z.enum(["exchange", "broker", "cache"]),
  candleCount: z.number(),
  qualityScore: z.number(),
  coveragePercent: z.number(),
  updatedAt: z.string(),
});

function resolveExportPath(prefix: string, format: string): string {
  return path.join(process.cwd(), "exports", "systematic", `${prefix}-${Date.now()}.${format}`);
}

function rowsToCsv<T extends object>(rows: T[]): string {
  if (rows.length === 0) return "";
  const normalizedRows = rows.map((row) => ({ ...(row as Record<string, unknown>) }));
  const headers = Object.keys(normalizedRows[0] ?? {});
  const escaped = (value: unknown): string => {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
  };
  return [
    headers.join(","),
    ...normalizedRows.map((row) => headers.map((header) => escaped(row[header])).join(",")),
  ].join("\n");
}

export const getSystematicStrategyStatusTool = createTool({
  id: "get_systematic_strategy_status",
  description:
    "Inspect the systematic research and promotion state for a strategy or playbook. " +
    "Returns validation score, eligibility, lifecycle events, recent experiments, and an operator report.",
  inputSchema: z.object({
    strategyId: z.string().describe("Strategy or playbook identifier"),
  }),
  outputSchema: z.object({
    profile: z.object({
      strategyId: z.string(),
      strategyName: z.string(),
      marketFamily: z.enum(["crypto", "stocks"]),
      status: z.enum(["research", "validated", "paper", "live", "degraded", "retired"]),
      validationStatus: z.enum(["passed", "warning", "failed"]),
      validationScore: z.number(),
      returnDriver: z.string(),
      regimeTag: z.string(),
      capitalWeight: z.number(),
      maxAllocation: z.number(),
      latestDatasetId: z.string().optional(),
      latestDatasetSnapshotId: z.string().optional(),
      latestBacktestResultId: z.string().optional(),
      latestValidationId: z.string().optional(),
      liveEligible: z.boolean(),
      decayScore: z.number(),
    }).optional(),
    latestValidation: z.object({
      validationId: z.string(),
      status: z.enum(["passed", "warning", "failed"]),
      score: z.number(),
      liveEligible: z.boolean(),
      createdAt: z.string(),
      gates: z.array(z.object({
        name: z.string(),
        passed: z.boolean(),
        score: z.number(),
        detail: z.string(),
      })),
      biasDiagnostics: z.object({
        status: z.enum(["passed", "warning", "failed"]),
        score: z.number(),
        blockerCount: z.number(),
        warningCount: z.number(),
        notes: z.array(z.string()),
      }).optional(),
    }).optional(),
    recentExperiments: z.array(z.object({
      experimentId: z.string(),
      status: z.enum(["research", "validated", "paper", "live", "archived"]),
      hypothesis: z.string(),
      updatedAt: z.string(),
    })),
    recentLifecycle: z.array(z.object({
      eventId: z.string(),
      eventType: z.string(),
      createdAt: z.string(),
    })),
    operatorReport: operatorReportSchema.optional(),
    formattedSummary: z.string().optional(),
  }),
  execute: async ({ strategyId }) => {
    const status = getSystematicStrategyStatus(strategyId);
    const operatorReport = buildStrategyStatusReport({
      strategyId,
      profile: status.profile,
      validation: status.latestValidation,
      experiments: status.experiments,
      lifecycle: status.lifecycle,
    });

    return {
      profile: status.profile
        ? {
            strategyId: status.profile.strategyId,
            strategyName: status.profile.strategyName,
            marketFamily: status.profile.marketFamily,
            status: status.profile.status,
            validationStatus: status.profile.validationStatus,
            validationScore: status.profile.validationScore,
            returnDriver: status.profile.returnDriver,
            regimeTag: status.profile.regimeTag,
            capitalWeight: status.profile.capitalWeight,
            maxAllocation: status.profile.maxAllocation,
            latestDatasetId: status.profile.latestDatasetId,
            latestDatasetSnapshotId: status.profile.latestDatasetSnapshotId,
            latestBacktestResultId: status.profile.latestBacktestResultId,
            latestValidationId: status.profile.latestValidationId,
            liveEligible: status.profile.liveEligible,
            decayScore: status.profile.decayScore,
          }
        : undefined,
      latestValidation: status.latestValidation
        ? {
            validationId: status.latestValidation.validationId,
            status: status.latestValidation.status,
            score: status.latestValidation.score,
            liveEligible: status.latestValidation.liveEligible,
            createdAt: status.latestValidation.createdAt,
            gates: status.latestValidation.gates,
            biasDiagnostics: status.latestValidation.biasDiagnostics
              ? {
                  status: status.latestValidation.biasDiagnostics.status,
                  score: status.latestValidation.biasDiagnostics.score,
                  blockerCount: status.latestValidation.biasDiagnostics.blockerCount,
                  warningCount: status.latestValidation.biasDiagnostics.warningCount,
                  notes: status.latestValidation.biasDiagnostics.notes,
                }
              : undefined,
          }
        : undefined,
      recentExperiments: status.experiments.slice(0, 5).map((experiment) => ({
        experimentId: experiment.experimentId,
        status: experiment.status,
        hypothesis: experiment.hypothesis,
        updatedAt: experiment.updatedAt,
      })),
      recentLifecycle: status.lifecycle.slice(0, 8).map((event) => ({
        eventId: event.eventId,
        eventType: event.eventType,
        createdAt: event.createdAt,
      })),
      operatorReport,
      formattedSummary: formatOperatorReport(operatorReport),
    };
  },
});

export const listSystematicDatasetsTool = createTool({
  id: "list_systematic_datasets",
  description:
    "List historical datasets captured for systematic research, including quality scores and provenance.",
  inputSchema: z.object({
    marketFamily: z.enum(["crypto", "stocks"]).optional(),
    symbol: z.string().optional(),
    timeframe: z.string().optional(),
    limit: z.number().min(1).max(50).default(20),
  }),
  outputSchema: z.object({
    datasets: z.array(datasetRowSchema),
    operatorReport: operatorReportSchema.optional(),
    formattedSummary: z.string().optional(),
  }),
  execute: async ({ marketFamily, symbol, timeframe, limit }) => {
    const datasets = listDatasetRecords({ marketFamily, symbol, timeframe, limit }).map((dataset) => ({
      datasetId: dataset.datasetId,
      symbol: dataset.symbol,
      timeframe: dataset.timeframe,
      marketFamily: dataset.marketFamily,
      sourceId: dataset.sourceId,
      sourceKind: dataset.sourceKind,
      candleCount: dataset.candleCount,
      qualityScore: dataset.quality.qualityScore,
      coveragePercent: dataset.quality.coveragePercent,
      updatedAt: dataset.updatedAt,
    }));
    const operatorReport = buildDatasetInventoryReport({
      datasets: listDatasetRecords({ marketFamily, symbol, timeframe, limit }),
      snapshots: listDatasetSnapshots().slice(0, limit),
    });

    return {
      datasets,
      operatorReport,
      formattedSummary: formatOperatorReport(operatorReport),
    };
  },
});

export const listDatasetSnapshotsTool = createTool({
  id: "list_dataset_snapshots",
  description: "List reproducible dataset snapshots for a systematic dataset or across all datasets.",
  inputSchema: z.object({
    datasetId: z.string().optional(),
    limit: z.number().min(1).max(100).default(20),
  }),
  outputSchema: z.object({
    snapshots: z.array(z.object({
      snapshotId: z.string(),
      datasetId: z.string(),
      startTime: z.number(),
      endTime: z.number(),
      candleCount: z.number(),
      createdAt: z.string(),
    })),
    operatorReport: operatorReportSchema.optional(),
    formattedSummary: z.string().optional(),
  }),
  execute: async ({ datasetId, limit }) => {
    const snapshots = listDatasetSnapshots(datasetId).slice(0, limit);
    const operatorReport = buildDatasetInventoryReport({
      datasets: datasetId ? listDatasetRecords().filter((dataset) => dataset.datasetId === datasetId) : listDatasetRecords({ limit }),
      snapshots,
    });

    return {
      snapshots: snapshots.map((snapshot) => ({
        snapshotId: snapshot.snapshotId,
        datasetId: snapshot.datasetId,
        startTime: snapshot.startTime,
        endTime: snapshot.endTime,
        candleCount: snapshot.candleCount,
        createdAt: snapshot.createdAt,
      })),
      operatorReport,
      formattedSummary: formatOperatorReport(operatorReport),
    };
  },
});

export const getDatasetSnapshotTool = createTool({
  id: "get_dataset_snapshot",
  description:
    "Retrieve a saved reproducible dataset snapshot for a systematic backtest run.",
  inputSchema: z.object({
    snapshotId: z.string().describe("Snapshot identifier"),
  }),
  outputSchema: z.object({
    snapshot: z.object({
      snapshotId: z.string(),
      datasetId: z.string(),
      candleCount: z.number(),
      startTime: z.number(),
      endTime: z.number(),
      createdAt: z.string(),
      metadata: z.record(z.string(), z.unknown()),
      candles: z.array(z.object({
        timestamp: z.number(),
        open: z.number(),
        high: z.number(),
        low: z.number(),
        close: z.number(),
        volume: z.number(),
      })),
    }).optional(),
    formattedSummary: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ snapshotId }) => {
    const snapshot = getDatasetSnapshot(snapshotId);
    if (!snapshot) {
      return { error: `Dataset snapshot '${snapshotId}' not found.` };
    }

    const formattedSummary = [
      "=== DATASET SNAPSHOT ===",
      `Snapshot: ${snapshot.snapshotId}`,
      `Dataset: ${snapshot.datasetId}`,
      `Candles: ${snapshot.candleCount}`,
      `Window: ${new Date(snapshot.startTime).toISOString()} -> ${new Date(snapshot.endTime).toISOString()}`,
      `Created: ${snapshot.createdAt}`,
    ].join("\n");

    return { snapshot, formattedSummary };
  },
});

export const listResearchExperimentsTool = createTool({
  id: "list_research_experiments",
  description:
    "List systematic research experiments and validation hypotheses for a strategy or across all strategies.",
  inputSchema: z.object({
    strategyId: z.string().optional(),
    limit: z.number().min(1).max(50).default(20),
  }),
  outputSchema: z.object({
    experiments: z.array(z.object({
      experimentId: z.string(),
      strategyId: z.string(),
      strategyName: z.string(),
      status: z.enum(["research", "validated", "paper", "live", "archived"]),
      hypothesis: z.string(),
      notes: z.string(),
      updatedAt: z.string(),
      validationId: z.string().optional(),
    })),
    operatorReport: operatorReportSchema.optional(),
    formattedSummary: z.string().optional(),
  }),
  execute: async ({ strategyId, limit }) => {
    const experiments = listResearchExperiments(strategyId).slice(0, limit);
    const operatorReport = buildExperimentsReport({ experiments });
    return {
      experiments: experiments.map((experiment) => ({
        experimentId: experiment.experimentId,
        strategyId: experiment.strategyId,
        strategyName: experiment.strategyName,
        status: experiment.status,
        hypothesis: experiment.hypothesis,
        notes: experiment.notes,
        updatedAt: experiment.updatedAt,
        validationId: experiment.validationId,
      })),
      operatorReport,
      formattedSummary: formatOperatorReport(operatorReport),
    };
  },
});

export const analyzeSystematicPortfolioTool = createTool({
  id: "analyze_systematic_portfolio",
  description:
    "Analyze the portfolio of systematic strategies across stocks and crypto, including correlation heuristics and diversification.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    portfolioId: z.string(),
    totalCapitalWeight: z.number(),
    diversificationScore: z.number(),
    concentrationRisk: z.enum(["low", "medium", "high"]),
    notes: z.array(z.string()),
    entries: z.array(z.object({
      strategyId: z.string(),
      strategyName: z.string(),
      marketFamily: z.enum(["crypto", "stocks"]),
      status: z.enum(["research", "validated", "paper", "live", "degraded", "retired"]),
      validationScore: z.number(),
      capitalWeight: z.number(),
      maxAllocation: z.number(),
      returnDriver: z.string(),
      regimeTag: z.string(),
      estimatedCorrelation: z.number(),
      diversificationContribution: z.number(),
    })),
    operatorReport: operatorReportSchema.optional(),
    formattedSummary: z.string().optional(),
  }),
  execute: async () => {
    const portfolio = buildSystematicPortfolioSummary();
    const operatorReport = buildPortfolioOperatorReport(portfolio);
    return {
      ...portfolio,
      operatorReport,
      formattedSummary: formatOperatorReport(operatorReport),
    };
  },
});

export const diagnoseStrategyBiasTool = createTool({
  id: "diagnose_strategy_bias",
  description:
    "Inspect the most recent systematic validation bias diagnostics for a strategy. " +
    "Use this to understand promotion blockers caused by sample size, walk-forward coverage, or overfitting.",
  inputSchema: z.object({
    strategyId: z.string(),
  }),
  outputSchema: z.object({
    validationId: z.string().optional(),
    biasDiagnostics: z.object({
      status: z.enum(["passed", "warning", "failed"]),
      score: z.number(),
      blockerCount: z.number(),
      warningCount: z.number(),
      checks: z.array(z.object({
        name: z.string(),
        status: z.enum(["passed", "warning", "failed"]),
        score: z.number(),
        detail: z.string(),
        blocker: z.boolean(),
      })),
      notes: z.array(z.string()),
    }).optional(),
    operatorReport: operatorReportSchema.optional(),
    formattedSummary: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ strategyId }) => {
    const status = getSystematicStrategyStatus(strategyId);
    if (!status.latestValidation?.biasDiagnostics) {
      return { error: `No bias diagnostics found for ${strategyId}. Run a systematic backtest first.` };
    }

    const operatorReport = buildStrategyStatusReport({
      strategyId,
      profile: status.profile,
      validation: status.latestValidation,
      experiments: status.experiments,
      lifecycle: status.lifecycle,
    });

    return {
      validationId: status.latestValidation.validationId,
      biasDiagnostics: status.latestValidation.biasDiagnostics,
      operatorReport,
      formattedSummary: formatOperatorReport(operatorReport),
    };
  },
});

export const getStrategyDecayReportTool = createTool({
  id: "get_strategy_decay_report",
  description:
    "Show decay and degradation state for a systematic strategy, including recent lifecycle events.",
  inputSchema: z.object({
    strategyId: z.string(),
  }),
  outputSchema: z.object({
    profile: z.object({
      strategyId: z.string(),
      strategyName: z.string(),
      status: z.string(),
      decayScore: z.number(),
      validationScore: z.number(),
    }).optional(),
    operatorReport: operatorReportSchema.optional(),
    formattedSummary: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ strategyId }) => {
    const status = getSystematicStrategyStatus(strategyId);
    if (!status.profile) {
      return { error: `No systematic profile found for ${strategyId}.` };
    }
    const operatorReport = buildDecayOperatorReport({
      profile: status.profile,
      lifecycle: status.lifecycle,
      validation: status.latestValidation,
    });
    return {
      profile: {
        strategyId: status.profile.strategyId,
        strategyName: status.profile.strategyName,
        status: status.profile.status,
        decayScore: status.profile.decayScore,
        validationScore: status.profile.validationScore,
      },
      operatorReport,
      formattedSummary: formatOperatorReport(operatorReport),
    };
  },
});

export const listSystematicLifecycleTool = createTool({
  id: "list_systematic_lifecycle",
  description: "List systematic lifecycle events for a strategy.",
  inputSchema: z.object({
    strategyId: z.string(),
    limit: z.number().min(1).max(100).default(20),
  }),
  outputSchema: z.object({
    events: z.array(z.object({
      eventId: z.string(),
      eventType: z.string(),
      createdAt: z.string(),
      payload: z.record(z.string(), z.unknown()),
    })),
    operatorReport: operatorReportSchema.optional(),
    formattedSummary: z.string().optional(),
  }),
  execute: async ({ strategyId, limit }) => {
    const status = getSystematicStrategyStatus(strategyId);
    const events = status.lifecycle.slice(0, limit);
    const operatorReport = buildLifecycleReport({ strategyId, lifecycle: events });
    return {
      events: events.map((event) => ({
        eventId: event.eventId,
        eventType: event.eventType,
        createdAt: event.createdAt,
        payload: event.payload,
      })),
      operatorReport,
      formattedSummary: formatOperatorReport(operatorReport),
    };
  },
});

export const exportSystematicArtifactTool = createTool({
  id: "export_systematic_artifact",
  description:
    "Export a dataset snapshot, validation, experiment, or backtest artifact to JSON, CSV, or Markdown for notebook-friendly handoff.",
  inputSchema: z.object({
    artifactType: z.enum(["dataset_snapshot", "validation", "experiment", "backtest"]),
    id: z.string().optional(),
    strategyId: z.string().optional(),
    format: z.enum(["json", "csv", "md"]).default("json"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    artifactType: z.string(),
    exportPath: z.string().optional(),
    notebookHint: z.string().optional(),
    summary: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ artifactType, id, strategyId, format }) => {
    const strategyStatus = strategyId ? getSystematicStrategyStatus(strategyId) : null;
    let payload: unknown;
    let exportPrefix: string = artifactType;
    let summary = "";

    if (artifactType === "dataset_snapshot") {
      const snapshotId = id ?? strategyStatus?.profile?.latestDatasetSnapshotId;
      if (!snapshotId) {
        return { success: false, artifactType, error: "No dataset snapshot id provided and no strategy snapshot available." };
      }
      payload = getDatasetSnapshot(snapshotId);
      if (!payload) {
        return { success: false, artifactType, error: `Dataset snapshot '${snapshotId}' not found.` };
      }
      exportPrefix = `dataset-snapshot-${snapshotId}`;
      summary = `Exported dataset snapshot ${snapshotId}.`;
    } else if (artifactType === "validation") {
      const validationId = id ?? strategyStatus?.profile?.latestValidationId;
      if (!validationId) {
        return { success: false, artifactType, error: "No validation id provided and no strategy validation available." };
      }
      payload = getValidationRun(validationId);
      if (!payload) {
        return { success: false, artifactType, error: `Validation '${validationId}' not found.` };
      }
      exportPrefix = `validation-${validationId}`;
      summary = `Exported validation ${validationId}.`;
    } else if (artifactType === "experiment") {
      const experiments = strategyId ? listResearchExperiments(strategyId) : listResearchExperiments();
      payload = id
        ? experiments.find((experiment) => experiment.experimentId === id) ?? null
        : experiments[0] ?? null;
      if (!payload) {
        return { success: false, artifactType, error: "No matching experiment found." };
      }
      exportPrefix = `experiment-${(payload as { experimentId: string }).experimentId}`;
      summary = `Exported experiment ${(payload as { experimentId: string }).experimentId}.`;
    } else {
      const backtestId = id ?? strategyStatus?.profile?.latestBacktestResultId;
      if (!backtestId) {
        return { success: false, artifactType, error: "No backtest id provided and no strategy backtest available." };
      }
      payload = loadBacktestResult(backtestId);
      if (!payload) {
        return { success: false, artifactType, error: `Backtest '${backtestId}' not found.` };
      }
      exportPrefix = `backtest-${backtestId}`;
      summary = `Exported backtest ${backtestId}.`;
    }

    const exportPath = resolveExportPath(exportPrefix, format);
    await mkdir(path.dirname(exportPath), { recursive: true });

    let content = "";
    if (format === "json") {
      content = JSON.stringify(payload, null, 2);
    } else if (format === "csv") {
      if (artifactType === "dataset_snapshot") {
        const snapshot = payload as ReturnType<typeof getDatasetSnapshot>;
        content = rowsToCsv(snapshot?.candles ?? []);
      } else if (artifactType === "experiment") {
        content = rowsToCsv(Array.isArray(payload) ? payload : [payload as Record<string, unknown>]);
      } else if (artifactType === "validation") {
        const validation = payload as ReturnType<typeof getValidationRun>;
        content = rowsToCsv(validation?.gates?.map((gate) => ({
          gate: gate.name,
          passed: gate.passed,
          score: gate.score,
          detail: gate.detail,
        })) ?? []);
      } else {
        const backtest = payload as ReturnType<typeof loadBacktestResult>;
        content = rowsToCsv(backtest?.trades ?? []);
      }
    } else {
      const report = artifactType === "validation" && payload
        ? buildStrategyStatusReport({
            strategyId: (payload as { strategyId: string }).strategyId,
            profile: strategyStatus?.profile ?? null,
            validation: payload as ReturnType<typeof getValidationRun>,
            experiments: strategyStatus?.experiments ?? [],
            lifecycle: strategyStatus?.lifecycle ?? [],
          })
        : undefined;
      content = report ? formatOperatorReport(report) : JSON.stringify(payload, null, 2);
    }

    await writeFile(exportPath, content, "utf8");

    const notebookHint = format === "csv"
      ? `import pandas as pd\nartifact = pd.read_csv(r\"${exportPath}\")`
      : `import json\nwith open(r\"${exportPath}\", \"r\", encoding=\"utf-8\") as fh:\n    artifact = json.load(fh)`;

    return {
      success: true,
      artifactType,
      exportPath,
      notebookHint,
      summary,
    };
  },
});

export const systematicTools = {
  get_systematic_strategy_status: getSystematicStrategyStatusTool,
  list_systematic_datasets: listSystematicDatasetsTool,
  list_dataset_snapshots: listDatasetSnapshotsTool,
  get_dataset_snapshot: getDatasetSnapshotTool,
  list_research_experiments: listResearchExperimentsTool,
  analyze_systematic_portfolio: analyzeSystematicPortfolioTool,
  diagnose_strategy_bias: diagnoseStrategyBiasTool,
  get_strategy_decay_report: getStrategyDecayReportTool,
  list_systematic_lifecycle: listSystematicLifecycleTool,
  export_systematic_artifact: exportSystematicArtifactTool,
};
