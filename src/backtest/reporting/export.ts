/**
 * Backtest Reporting Exports
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { BacktestResult } from "../types.ts";

export interface ExportStatus {
  status: "success" | "error";
  filepath?: string;
  numResults?: number;
  error?: string;
}

export async function exportResultsJson(
  results: BacktestResult[],
  filepath: string
): Promise<ExportStatus> {
  try {
    await mkdir(dirname(filepath), { recursive: true });
    await writeFile(filepath, JSON.stringify(results, null, 2));
    return {
      status: "success",
      filepath,
      numResults: results.length,
    };
  } catch (error) {
    return {
      status: "error",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function exportResultsCsv(
  results: BacktestResult[],
  filepath: string
): Promise<ExportStatus> {
  try {
    await mkdir(dirname(filepath), { recursive: true });

    const header = [
      "Strategy",
      "Framework",
      "Initial Value",
      "Final Value",
      "Total Return %",
      "Sharpe Ratio",
      "Max Drawdown %",
      "Trades",
      "Win Rate %",
      "Execution Time s",
    ];

    const rows = results.map((result) => {
      const metrics = result.metrics;
      return [
        result.strategyName,
        "gordon-native",
        metrics.initialValue.toFixed(2),
        metrics.finalValue.toFixed(2),
        metrics.totalReturn.toFixed(2),
        metrics.sharpeRatio.toFixed(4),
        metrics.maxDrawdown.toFixed(2),
        metrics.totalTrades.toString(),
        (metrics.winRate * 100).toFixed(2),
        (result.executionTime / 1000).toFixed(2),
      ];
    });

    const csv = [header, ...rows]
      .map((row) => row.map((value) => `"${value}"`).join(","))
      .join("\n");

    await writeFile(filepath, csv);

    return {
      status: "success",
      filepath,
      numResults: results.length,
    };
  } catch (error) {
    return {
      status: "error",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function generateHtmlReport(
  results: BacktestResult[],
  filepath: string
): Promise<ExportStatus> {
  try {
    await mkdir(dirname(filepath), { recursive: true });

    const bestReturn = results.length > 0
      ? Math.max(...results.map((r) => r.metrics.totalReturn))
      : 0;

    const rows = results
      .map((result) => {
        const metrics = result.metrics;
        const isBest = metrics.totalReturn === bestReturn;
        const rowClass = isBest ? " class=\"best\"" : "";
        return `      <tr${rowClass}>
        <td>${result.strategyName}</td>
        <td>${metrics.totalReturn.toFixed(2)}%</td>
        <td>${metrics.sharpeRatio.toFixed(3)}</td>
        <td>${metrics.maxDrawdown.toFixed(2)}%</td>
        <td>${metrics.totalTrades}</td>
        <td>${(metrics.winRate * 100).toFixed(2)}%</td>
      </tr>`;
      })
      .join("\n");

    const html = `<!DOCTYPE html>
<html>
<head>
  <title>Backtest Report</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; }
    table { border-collapse: collapse; width: 100%; margin: 20px 0; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background-color: #4CAF50; color: white; }
    tr:nth-child(even) { background-color: #f2f2f2; }
    .best { background-color: #90EE90; }
  </style>
</head>
<body>
  <h1>Backtest Results Report</h1>
  <table>
    <tr>
      <th>Strategy</th>
      <th>Return %</th>
      <th>Sharpe</th>
      <th>Max DD %</th>
      <th>Trades</th>
      <th>Win Rate %</th>
    </tr>
${rows}
  </table>
</body>
</html>`;

    await writeFile(filepath, html);

    return {
      status: "success",
      filepath,
      numResults: results.length,
    };
  } catch (error) {
    return {
      status: "error",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
