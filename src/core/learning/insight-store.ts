/**
 * Insight Store
 *
 * SQLite persistence for counterfactual analysis reports and insights.
 * Provides aggregation queries to detect recurring patterns across trades.
 */

import { getDatabase } from "../../infra/storage/database.ts";
import { createModuleLogger } from "../../infra/logger/index.ts";
import type { CounterfactualReport, CounterfactualInsight } from "./counterfactual-analyzer.ts";

const logger = createModuleLogger("insight-store");

let initialized = false;

function ensureTables(): void {
  if (initialized) return;

  const db = getDatabase();

  db.run(`
    CREATE TABLE IF NOT EXISTS counterfactual_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trade_id TEXT NOT NULL UNIQUE,
      symbol TEXT NOT NULL,
      playbook_name TEXT,
      actual_pnl REAL NOT NULL,
      actual_pnl_percent REAL NOT NULL,
      best_alternative_pnl REAL NOT NULL,
      improvement_percent REAL NOT NULL,
      scenarios_run INTEGER NOT NULL,
      report_json TEXT NOT NULL,
      analyzed_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS counterfactual_insights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trade_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      playbook_name TEXT,
      category TEXT NOT NULL,
      finding TEXT NOT NULL,
      actual_value REAL NOT NULL,
      optimal_value REAL NOT NULL,
      pnl_delta REAL NOT NULL,
      confidence REAL NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

  db.run("CREATE INDEX IF NOT EXISTS idx_cf_reports_symbol ON counterfactual_reports(symbol)");
  db.run("CREATE INDEX IF NOT EXISTS idx_cf_insights_category ON counterfactual_insights(category)");
  db.run("CREATE INDEX IF NOT EXISTS idx_cf_insights_playbook ON counterfactual_insights(playbook_name)");

  initialized = true;
}

// ============================================================================
// Save
// ============================================================================

export function saveReport(report: CounterfactualReport): void {
  ensureTables();
  const db = getDatabase();

  db.run(
    `INSERT OR REPLACE INTO counterfactual_reports
     (trade_id, symbol, playbook_name, actual_pnl, actual_pnl_percent, best_alternative_pnl, improvement_percent, scenarios_run, report_json, analyzed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      report.tradeId,
      report.symbol,
      report.playbookName ?? null,
      report.actualPnl,
      report.actualPnlPercent,
      report.bestAlternativePnl,
      report.improvementPercent,
      report.scenariosRun,
      JSON.stringify(report),
      report.analyzedAt,
    ],
  );

  for (const insight of report.insights) {
    db.run(
      `INSERT INTO counterfactual_insights
       (trade_id, symbol, playbook_name, category, finding, actual_value, optimal_value, pnl_delta, confidence, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        report.tradeId,
        report.symbol,
        report.playbookName ?? null,
        insight.category,
        insight.finding,
        insight.actualValue,
        insight.optimalValue,
        insight.pnlDelta,
        insight.confidence,
        report.analyzedAt,
      ],
    );
  }
}

// ============================================================================
// Queries
// ============================================================================

export function getReport(tradeId: string): CounterfactualReport | null {
  ensureTables();
  const db = getDatabase();
  const row = db
    .query<{ report_json: string }, [string]>(
      "SELECT report_json FROM counterfactual_reports WHERE trade_id = ?",
    )
    .get(tradeId);

  return row ? JSON.parse(row.report_json) : null;
}

/**
 * Get recurring insights for a playbook — patterns that appear across
 * multiple trades, suggesting systematic adjustments.
 */
export function getRecurringInsights(
  playbookName: string,
  minOccurrences: number = 3,
): Array<{
  category: string;
  avgOptimalValue: number;
  avgPnlDelta: number;
  occurrences: number;
  avgConfidence: number;
  direction: "increase" | "decrease" | "mixed";
}> {
  ensureTables();
  const db = getDatabase();

  const rows = db
    .query<
      {
        category: string;
        avg_optimal: number;
        avg_pnl_delta: number;
        cnt: number;
        avg_confidence: number;
        avg_actual: number;
      },
      [string, number]
    >(
      `SELECT
         category,
         AVG(optimal_value) as avg_optimal,
         AVG(pnl_delta) as avg_pnl_delta,
         COUNT(*) as cnt,
         AVG(confidence) as avg_confidence,
         AVG(actual_value) as avg_actual
       FROM counterfactual_insights
       WHERE playbook_name = ?
       GROUP BY category
       HAVING COUNT(*) >= ?
       ORDER BY AVG(pnl_delta) DESC`,
    )
    .all(playbookName, minOccurrences);

  return rows.map((r) => ({
    category: r.category,
    avgOptimalValue: r.avg_optimal,
    avgPnlDelta: r.avg_pnl_delta,
    occurrences: r.cnt,
    avgConfidence: r.avg_confidence,
    direction: r.avg_optimal > r.avg_actual ? "increase" as const : "decrease" as const,
  }));
}

/**
 * Get insights for a specific symbol.
 */
export function getInsightsForSymbol(
  symbol: string,
  limit: number = 20,
): CounterfactualInsight[] {
  ensureTables();
  const db = getDatabase();

  const rows = db
    .query<
      {
        category: string;
        finding: string;
        actual_value: number;
        optimal_value: number;
        pnl_delta: number;
        confidence: number;
      },
      [string, number]
    >(
      `SELECT category, finding, actual_value, optimal_value, pnl_delta, confidence
       FROM counterfactual_insights
       WHERE symbol = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(symbol, limit);

  return rows.map((r) => ({
    category: r.category as CounterfactualInsight["category"],
    finding: r.finding,
    actualValue: r.actual_value,
    optimalValue: r.optimal_value,
    pnlDelta: r.pnl_delta,
    confidence: r.confidence,
  }));
}

/**
 * Get summary stats for counterfactual analysis.
 */
export function getAnalysisSummary(): {
  totalAnalyzed: number;
  totalInsights: number;
  avgImprovementPercent: number;
} {
  ensureTables();
  const db = getDatabase();

  const row = db
    .query<{ total: number; avg_improvement: number }, []>(
      "SELECT COUNT(*) as total, AVG(improvement_percent) as avg_improvement FROM counterfactual_reports",
    )
    .get();

  const insightCount = db
    .query<{ cnt: number }, []>(
      "SELECT COUNT(*) as cnt FROM counterfactual_insights",
    )
    .get();

  return {
    totalAnalyzed: row?.total ?? 0,
    totalInsights: insightCount?.cnt ?? 0,
    avgImprovementPercent: row?.avg_improvement ?? 0,
  };
}
