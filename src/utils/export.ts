/**
 * Export Utilities
 * Provides data export functionality for scan results, analysis, and backtests
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { GORDON_DIR } from "../infra/storage/paths.ts";

import type { ScanResult, CoinAnalysis } from "../types/market.ts";
import type { DetailedAnalysis } from "../core/analyzer.ts";
import type { BacktestResult, BacktestMetrics } from "../backtest/types.ts";
import type { ChatSession } from "../infra/storage/chat-history.ts";

// ============================================================================
// Types
// ============================================================================

export type ExportFormat = "csv" | "json" | "markdown";

export interface ExportOptions {
  format: ExportFormat;
  filename?: string;
  includeTimestamp?: boolean;
  outputDir?: string;
}

export interface ExportResult {
  success: boolean;
  filepath: string;
  format: ExportFormat;
  recordCount?: number;
  error?: string;
}

// ============================================================================
// Constants
// ============================================================================

const EXPORTS_DIR = join(GORDON_DIR, "exports");

// ============================================================================
// Helpers
// ============================================================================

/**
 * Ensure the exports directory exists
 */
async function ensureExportsDir(customDir?: string): Promise<string> {
  const dir = customDir || EXPORTS_DIR;
  await mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Generate a filename with optional timestamp
 */
function generateFilename(
  base: string,
  format: ExportFormat,
  includeTimestamp: boolean = true
): string {
  const sanitizedBase = base.toLowerCase().replace(/[^a-z0-9-_]/g, "-");
  const date = new Date();
  const dateStr = date.toISOString().split("T")[0]; // YYYY-MM-DD

  if (includeTimestamp) {
    return `gordon-${sanitizedBase}-${dateStr}.${format}`;
  }
  return `gordon-${sanitizedBase}.${format}`;
}

/**
 * Format a number for display
 */
function formatNumber(value: number | null | undefined, decimals: number = 2): string {
  if (value === null || value === undefined) return "N/A";
  return value.toFixed(decimals);
}

/**
 * Escape CSV value
 */
function escapeCSV(value: unknown): string {
  const str = String(value ?? "");
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// ============================================================================
// Scan Results Export
// ============================================================================

/**
 * Export scan results to the specified format
 */
export async function exportScanResults(
  data: ScanResult,
  options: ExportOptions
): Promise<ExportResult> {
  const { format, filename, includeTimestamp = true, outputDir } = options;

  try {
    const dir = await ensureExportsDir(outputDir);
    const fname = filename || generateFilename("scan", format, includeTimestamp);
    const filepath = join(dir, fname);

    let content: string;
    const opportunities = data.coins.filter((c) => c.setupDetected);

    switch (format) {
      case "json":
        content = JSON.stringify(
          {
            exportedAt: new Date().toISOString(),
            scanTimestamp: data.timestamp,
            universe: data.universe,
            timeframes: data.timeframes,
            totalCoinsScanned: data.coins.length,
            opportunitiesFound: opportunities.length,
            opportunities: opportunities.map((c) => ({
              symbol: c.symbol,
              price: c.price,
              change24h: c.change24h,
              volume24h: c.volume24h,
              setupConfidence: c.setupConfidence,
              bias: c.bias,
              risk: c.risk,
              trend: c.trend,
              rsi: c.indicators.rsi,
            })),
          },
          null,
          2
        );
        break;

      case "csv":
        const csvHeader = [
          "Symbol",
          "Price",
          "Change 24h %",
          "Volume 24h",
          "Setup Confidence",
          "Bias",
          "Risk",
          "Trend",
          "RSI",
        ].join(",");

        const csvRows = opportunities.map((c) =>
          [
            escapeCSV(c.symbol),
            escapeCSV(formatNumber(c.price, 8)),
            escapeCSV(formatNumber(c.change24h)),
            escapeCSV(formatNumber(c.volume24h, 0)),
            escapeCSV(formatNumber(c.setupConfidence * 100)),
            escapeCSV(c.bias),
            escapeCSV(c.risk),
            escapeCSV(c.trend),
            escapeCSV(formatNumber(c.indicators.rsi)),
          ].join(",")
        );

        content = [csvHeader, ...csvRows].join("\n");
        break;

      case "markdown":
        const lines: string[] = [
          `# Gordon Market Scan Report`,
          "",
          `**Scan Time:** ${data.timestamp}`,
          `**Universe:** ${data.universe}`,
          `**Timeframes:** ${data.timeframes.join(", ")}`,
          `**Coins Scanned:** ${data.coins.length}`,
          `**Opportunities Found:** ${opportunities.length}`,
          "",
          "## Trading Opportunities",
          "",
          "| Symbol | Price | 24h Change | Confidence | Bias | Risk | RSI |",
          "|--------|-------|------------|------------|------|------|-----|",
        ];

        for (const c of opportunities.slice(0, 20)) {
          lines.push(
            `| ${c.symbol} | $${formatNumber(c.price, 4)} | ${formatNumber(c.change24h)}% | ${formatNumber(c.setupConfidence * 100)}% | ${c.bias} | ${c.risk} | ${formatNumber(c.indicators.rsi, 0)} |`
          );
        }

        if (opportunities.length > 20) {
          lines.push("", `*...and ${opportunities.length - 20} more opportunities*`);
        }

        lines.push("", "---", `*Exported by Gordon CLI on ${new Date().toISOString()}*`);

        content = lines.join("\n");
        break;
    }

    await writeFile(filepath, content, "utf-8");

    return {
      success: true,
      filepath,
      format,
      recordCount: opportunities.length,
    };
  } catch (error) {
    return {
      success: false,
      filepath: "",
      format,
      error: error instanceof Error ? error.message : "Export failed",
    };
  }
}

// ============================================================================
// Analysis Export
// ============================================================================

/**
 * Export detailed analysis to the specified format
 */
export async function exportAnalysis(
  data: DetailedAnalysis,
  options: ExportOptions
): Promise<ExportResult> {
  const { format, filename, includeTimestamp = true, outputDir } = options;

  try {
    const dir = await ensureExportsDir(outputDir);
    const symbolLower = data.symbol.toLowerCase().replace("usdt", "");
    const fname = filename || generateFilename(`analysis-${symbolLower}`, format, includeTimestamp);
    const filepath = join(dir, fname);

    let content: string;

    switch (format) {
      case "json":
        content = JSON.stringify(
          {
            exportedAt: new Date().toISOString(),
            symbol: data.symbol,
            price: data.price,
            change24h: data.change24h,
            volume24h: data.volume24h,
            trend: data.trend,
            bias: data.bias,
            risk: data.risk,
            setupDetected: data.setupDetected,
            setupConfidence: data.setupConfidence,
            indicators: {
              rsi: data.indicators.rsi,
              macd: data.indicators.macd,
              volumeRatio: data.indicators.volumeRatio,
            },
            macdState: data.macdState,
            rsiState: data.rsiState,
            volumeTrend: data.volumeTrend,
            supports: data.supports.slice(0, 5).map((s) => ({
              price: s.price,
              strength: s.strength,
              touches: s.touches,
            })),
            resistances: data.resistances.slice(0, 5).map((r) => ({
              price: r.price,
              strength: r.strength,
              touches: r.touches,
            })),
            setupDetails: data.setupDetails,
          },
          null,
          2
        );
        break;

      case "csv":
        // For single analysis, CSV is a simple key-value format
        const pairs = [
          ["Field", "Value"],
          ["Symbol", data.symbol],
          ["Price", formatNumber(data.price, 8)],
          ["Change 24h %", formatNumber(data.change24h)],
          ["Volume 24h", formatNumber(data.volume24h, 0)],
          ["Trend", data.trend],
          ["Bias", data.bias],
          ["Risk", data.risk],
          ["Setup Detected", data.setupDetected ? "Yes" : "No"],
          ["Setup Confidence", formatNumber(data.setupConfidence * 100) + "%"],
          ["RSI", formatNumber(data.indicators.rsi)],
          ["RSI State", data.rsiState],
          ["MACD State", data.macdState],
          ["Volume Trend", data.volumeTrend],
          ["Support 1", data.supports[0] ? formatNumber(data.supports[0].price, 4) : "N/A"],
          ["Support 2", data.supports[1] ? formatNumber(data.supports[1].price, 4) : "N/A"],
          ["Resistance 1", data.resistances[0] ? formatNumber(data.resistances[0].price, 4) : "N/A"],
          ["Resistance 2", data.resistances[1] ? formatNumber(data.resistances[1].price, 4) : "N/A"],
        ];

        content = pairs.map((row) => row.map(escapeCSV).join(",")).join("\n");
        break;

      case "markdown":
        const mdLines: string[] = [
          `# ${data.symbol} Analysis Report`,
          "",
          `**Price:** $${formatNumber(data.price, 4)}`,
          `**24h Change:** ${formatNumber(data.change24h)}%`,
          "",
          "## Summary",
          "",
          `| Metric | Value |`,
          `|--------|-------|`,
          `| Trend | ${data.trend} |`,
          `| Bias | ${data.bias} |`,
          `| Risk | ${data.risk} |`,
          `| Setup Detected | ${data.setupDetected ? "Yes" : "No"} |`,
          `| Setup Confidence | ${formatNumber(data.setupConfidence * 100)}% |`,
          "",
          "## Technical Indicators",
          "",
          `| Indicator | Value | State |`,
          `|-----------|-------|-------|`,
          `| RSI | ${formatNumber(data.indicators.rsi, 1)} | ${data.rsiState} |`,
          `| MACD | - | ${data.macdState} |`,
          `| Volume | - | ${data.volumeTrend} |`,
          "",
          "## Key Levels",
          "",
          "### Support Levels",
          "",
        ];

        for (let i = 0; i < Math.min(3, data.supports.length); i++) {
          const s = data.supports[i]!;
          mdLines.push(`- **S${i + 1}:** $${formatNumber(s.price, 4)} (strength: ${formatNumber(s.strength * 100)}%)`);
        }

        mdLines.push("", "### Resistance Levels", "");

        for (let i = 0; i < Math.min(3, data.resistances.length); i++) {
          const r = data.resistances[i]!;
          mdLines.push(`- **R${i + 1}:** $${formatNumber(r.price, 4)} (strength: ${formatNumber(r.strength * 100)}%)`);
        }

        if (data.setupDetails.nearestSupport) {
          mdLines.push(
            "",
            "## Setup Details",
            "",
            `- **Nearest Support:** $${formatNumber(data.setupDetails.nearestSupport.price, 4)}`,
            `- **Distance to Support:** ${formatNumber(data.setupDetails.distanceToSupport)}%`,
            `- **Invalidation Price:** $${formatNumber(data.setupDetails.invalidationPrice, 4)}`
          );
        }

        mdLines.push("", "---", `*Exported by Gordon CLI on ${new Date().toISOString()}*`);

        content = mdLines.join("\n");
        break;
    }

    await writeFile(filepath, content, "utf-8");

    return {
      success: true,
      filepath,
      format,
      recordCount: 1,
    };
  } catch (error) {
    return {
      success: false,
      filepath: "",
      format,
      error: error instanceof Error ? error.message : "Export failed",
    };
  }
}

// ============================================================================
// Backtest Export
// ============================================================================

/**
 * Export backtest results to the specified format
 */
export async function exportBacktest(
  data: BacktestResult,
  options: ExportOptions
): Promise<ExportResult> {
  const { format, filename, includeTimestamp = true, outputDir } = options;

  try {
    const dir = await ensureExportsDir(outputDir);
    const strategyLower = data.strategyName.toLowerCase().replace(/[^a-z0-9]/g, "-");
    const symbolLower = data.config.symbol.toLowerCase().replace("usdt", "");
    const fname = filename || generateFilename(`backtest-${strategyLower}-${symbolLower}`, format, includeTimestamp);
    const filepath = join(dir, fname);

    let content: string;
    const metrics = data.metrics;

    switch (format) {
      case "json":
        content = JSON.stringify(
          {
            exportedAt: new Date().toISOString(),
            backtestId: data.id,
            strategyName: data.strategyName,
            config: data.config,
            period: {
              startDate: data.startDate,
              endDate: data.endDate,
            },
            metrics: {
              totalReturn: metrics.totalReturn,
              annualizedReturn: metrics.annualizedReturn,
              sharpeRatio: metrics.sharpeRatio,
              sortinoRatio: metrics.sortinoRatio,
              maxDrawdown: metrics.maxDrawdown,
              totalTrades: metrics.totalTrades,
              winRate: metrics.winRate,
              profitFactor: metrics.profitFactor,
              averageTrade: metrics.averageTrade,
              expectancy: metrics.expectancy,
            },
            trades: data.trades.map((t) => ({
              id: t.id,
              entryTime: t.entryTime,
              exitTime: t.exitTime,
              entryPrice: t.entryPrice,
              exitPrice: t.exitPrice,
              side: t.side,
              pnl: t.pnl,
              pnlPercent: t.pnlPercent,
              exitReason: t.exitReason,
            })),
            executionTime: data.executionTime,
            warnings: data.warnings,
          },
          null,
          2
        );
        break;

      case "csv":
        // CSV for trades
        const header = [
          "Trade ID",
          "Entry Time",
          "Exit Time",
          "Entry Price",
          "Exit Price",
          "Side",
          "P&L",
          "P&L %",
          "Exit Reason",
        ].join(",");

        const rows = data.trades.map((t) =>
          [
            escapeCSV(t.id),
            escapeCSV(t.entryTime),
            escapeCSV(t.exitTime),
            escapeCSV(formatNumber(t.entryPrice, 8)),
            escapeCSV(formatNumber(t.exitPrice, 8)),
            escapeCSV(t.side),
            escapeCSV(formatNumber(t.pnl)),
            escapeCSV(formatNumber(t.pnlPercent)),
            escapeCSV(t.exitReason),
          ].join(",")
        );

        // Add summary at the top
        const summaryLines = [
          `# Strategy: ${data.strategyName}`,
          `# Symbol: ${data.config.symbol}`,
          `# Period: ${data.startDate} to ${data.endDate}`,
          `# Total Return: ${formatNumber(metrics.totalReturn)}%`,
          `# Win Rate: ${formatNumber(metrics.winRate)}%`,
          `# Sharpe Ratio: ${formatNumber(metrics.sharpeRatio)}`,
          "",
        ];

        content = [...summaryLines, header, ...rows].join("\n");
        break;

      case "markdown":
        const mdContent: string[] = [
          `# Backtest Report: ${data.strategyName}`,
          "",
          "## Configuration",
          "",
          `| Parameter | Value |`,
          `|-----------|-------|`,
          `| Symbol | ${data.config.symbol} |`,
          `| Timeframe | ${data.config.timeframe} |`,
          `| Period | ${data.config.days} days |`,
          `| Initial Capital | $${formatNumber(data.config.initialCapital, 0)} |`,
          `| Position Size | ${data.config.positionSizePercent}% |`,
          `| Commission | ${data.config.feePercent}% |`,
          "",
          "## Performance Summary",
          "",
          `| Metric | Value |`,
          `|--------|-------|`,
          `| Total Return | ${formatNumber(metrics.totalReturn)}% |`,
          `| Annualized Return | ${formatNumber(metrics.annualizedReturn)}% |`,
          `| Sharpe Ratio | ${formatNumber(metrics.sharpeRatio)} |`,
          `| Sortino Ratio | ${formatNumber(metrics.sortinoRatio)} |`,
          `| Max Drawdown | ${formatNumber(metrics.maxDrawdown)}% |`,
          `| Calmar Ratio | ${formatNumber(metrics.calmarRatio)} |`,
          "",
          "## Trade Statistics",
          "",
          `| Metric | Value |`,
          `|--------|-------|`,
          `| Total Trades | ${metrics.totalTrades} |`,
          `| Winning Trades | ${metrics.winningTrades} |`,
          `| Losing Trades | ${metrics.losingTrades} |`,
          `| Win Rate | ${formatNumber(metrics.winRate)}% |`,
          `| Profit Factor | ${formatNumber(metrics.profitFactor)} |`,
          `| Average Trade | $${formatNumber(metrics.averageTrade)} |`,
          `| Average Win | $${formatNumber(metrics.averageWin)} |`,
          `| Average Loss | $${formatNumber(metrics.averageLoss)} |`,
          `| Expectancy | $${formatNumber(metrics.expectancy)} |`,
          "",
          "## Trade History",
          "",
          "| # | Entry | Exit | Side | Entry Price | Exit Price | P&L | P&L % |",
          "|---|-------|------|------|-------------|------------|-----|-------|",
        ];

        for (let i = 0; i < Math.min(20, data.trades.length); i++) {
          const t = data.trades[i]!;
          const entryDate = t.entryTime.split("T")[0];
          const exitDate = t.exitTime.split("T")[0];
          const pnlSign = t.pnl >= 0 ? "+" : "";
          mdContent.push(
            `| ${i + 1} | ${entryDate} | ${exitDate} | ${t.side} | $${formatNumber(t.entryPrice, 4)} | $${formatNumber(t.exitPrice, 4)} | ${pnlSign}$${formatNumber(t.pnl)} | ${pnlSign}${formatNumber(t.pnlPercent)}% |`
          );
        }

        if (data.trades.length > 20) {
          mdContent.push("", `*...showing 20 of ${data.trades.length} trades*`);
        }

        if (data.warnings.length > 0) {
          mdContent.push("", "## Warnings", "");
          for (const warning of data.warnings) {
            mdContent.push(`- ${warning}`);
          }
        }

        mdContent.push(
          "",
          "---",
          `*Backtest executed in ${(data.executionTime / 1000).toFixed(2)}s*`,
          `*Exported by Gordon CLI on ${new Date().toISOString()}*`
        );

        content = mdContent.join("\n");
        break;
    }

    await writeFile(filepath, content, "utf-8");

    return {
      success: true,
      filepath,
      format,
      recordCount: data.trades.length,
    };
  } catch (error) {
    return {
      success: false,
      filepath: "",
      format,
      error: error instanceof Error ? error.message : "Export failed",
    };
  }
}

// ============================================================================
// Generic Export
// ============================================================================

/**
 * Export generic data to the specified format
 */
export async function exportData(
  data: unknown,
  options: ExportOptions & { name?: string }
): Promise<ExportResult> {
  const { format, filename, includeTimestamp = true, outputDir, name = "data" } = options;

  try {
    const dir = await ensureExportsDir(outputDir);
    const fname = filename || generateFilename(name, format, includeTimestamp);
    const filepath = join(dir, fname);

    let content: string;

    switch (format) {
      case "json":
        content = JSON.stringify(
          {
            exportedAt: new Date().toISOString(),
            data,
          },
          null,
          2
        );
        break;

      case "csv":
        // Try to convert to CSV if it's an array of objects
        if (Array.isArray(data) && data.length > 0 && typeof data[0] === "object") {
          const keys = Object.keys(data[0] as object);
          const header = keys.map(escapeCSV).join(",");
          const rows = data.map((item) =>
            keys.map((key) => escapeCSV((item as Record<string, unknown>)[key])).join(",")
          );
          content = [header, ...rows].join("\n");
        } else {
          content = JSON.stringify(data, null, 2);
        }
        break;

      case "markdown":
        // Simple markdown representation
        content = [
          `# Data Export`,
          "",
          `**Exported:** ${new Date().toISOString()}`,
          "",
          "```json",
          JSON.stringify(data, null, 2),
          "```",
        ].join("\n");
        break;
    }

    await writeFile(filepath, content, "utf-8");

    return {
      success: true,
      filepath,
      format,
      recordCount: Array.isArray(data) ? data.length : 1,
    };
  } catch (error) {
    return {
      success: false,
      filepath: "",
      format,
      error: error instanceof Error ? error.message : "Export failed",
    };
  }
}

// ============================================================================
// Session Export
// ============================================================================

/**
 * Export a chat session with all analysis data
 */
export async function exportSession(
  session: ChatSession,
  options: ExportOptions
): Promise<ExportResult> {
  const { format, filename, includeTimestamp = true, outputDir } = options;

  try {
    const dir = await ensureExportsDir(outputDir);
    const sessionDate = session.id.replace(/_/g, "-").replace(/:/g, "-");
    const fname = filename || generateFilename(`session-${sessionDate}`, format, includeTimestamp);
    const filepath = join(dir, fname);

    let content: string;

    switch (format) {
      case "json":
        content = JSON.stringify(
          {
            exportedAt: new Date().toISOString(),
            session: {
              id: session.id,
              startedAt: session.startedAt,
              endedAt: session.endedAt,
              durationSeconds: session.metadata.durationSeconds,
              messageCount: session.metadata.messageCount,
              symbolsDiscussed: session.symbolsDiscussed,
              commandsUsed: session.commandsUsed,
              permissionMode: session.metadata.permissionMode,
            },
            messages: session.messages,
          },
          null,
          2
        );
        break;

      case "csv":
        const csvHeader = ["Timestamp", "Role", "Content", "Agent", "Tool Calls"].join(",");
        const csvRows = session.messages.map((m) =>
          [
            escapeCSV(m.timestamp),
            escapeCSV(m.role),
            escapeCSV(m.content.slice(0, 500)),
            escapeCSV(m.agent || ""),
            escapeCSV((m.toolCalls || []).join("; ")),
          ].join(",")
        );
        content = [csvHeader, ...csvRows].join("\n");
        break;

      case "markdown":
        const mdLines: string[] = [
          `# Gordon Session Export`,
          "",
          `**Session ID:** ${session.id}`,
          `**Started:** ${session.startedAt}`,
          `**Ended:** ${session.endedAt}`,
          `**Duration:** ${Math.floor(session.metadata.durationSeconds / 60)} minutes`,
          `**Messages:** ${session.metadata.messageCount}`,
          `**Permission Mode:** ${session.metadata.permissionMode}`,
          "",
          "## Symbols Discussed",
          "",
          session.symbolsDiscussed.length > 0
            ? session.symbolsDiscussed.map((s) => `- ${s}`).join("\n")
            : "*No specific symbols discussed*",
          "",
          "## Commands Used",
          "",
          session.commandsUsed.length > 0
            ? session.commandsUsed.map((c) => `- \`${c}\``).join("\n")
            : "*No commands used*",
          "",
          "## Conversation",
          "",
        ];

        for (const msg of session.messages) {
          const roleLabel = msg.role === "user" ? "**You:**" : msg.role === "assistant" ? "**Gordon:**" : "**System:**";
          mdLines.push(roleLabel);
          mdLines.push("");
          mdLines.push(msg.content);
          mdLines.push("");
          if (msg.toolCalls && msg.toolCalls.length > 0) {
            mdLines.push(`*Tools used: ${msg.toolCalls.join(", ")}*`);
            mdLines.push("");
          }
          mdLines.push("---");
          mdLines.push("");
        }

        mdLines.push(`*Exported by Gordon CLI on ${new Date().toISOString()}*`);

        content = mdLines.join("\n");
        break;
    }

    await writeFile(filepath, content, "utf-8");

    return {
      success: true,
      filepath,
      format,
      recordCount: session.messages.length,
    };
  } catch (error) {
    return {
      success: false,
      filepath: "",
      format,
      error: error instanceof Error ? error.message : "Export failed",
    };
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Parse export format from string
 */
export function parseExportFormat(formatStr: string): ExportFormat | null {
  const normalized = formatStr.toLowerCase().trim();
  if (normalized === "csv" || normalized === "json" || normalized === "markdown" || normalized === "md") {
    return normalized === "md" ? "markdown" : (normalized as ExportFormat);
  }
  return null;
}

/**
 * Get the exports directory path
 */
export function getExportsDir(): string {
  return EXPORTS_DIR;
}
