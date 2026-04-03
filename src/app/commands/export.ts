/**
 * Export Commands
 * CLI utilities for exporting recent results and session data to files.
 */

import { mkdir, writeFile } from "fs/promises";
import path from "path";

import type { ChatMessage } from "../chatTypes.ts";
import {
  formatScanResults,
  formatAnalysisResults,
} from "../resultFormatting.ts";

export interface ScanExportData {
  timestamp?: string;
  coinsScanned?: number;
  opportunities?: Array<{
    symbol: string;
    price: number;
    change24h: number;
    setupConfidence: number;
    bias: string;
    risk: string;
  }>;
  executionTime?: number;
  formattedSummary?: string;
}

export interface AnalysisExportData {
  symbol?: string;
  price?: number;
  trend?: string;
  setupDetected?: boolean;
  setupConfidence?: number;
  indicators?: {
    rsi?: number | null;
    macdState?: string;
    volumeTrend?: string;
  };
  supports?: Array<{ price: number; strength: number }>;
  resistances?: Array<{ price: number; strength: number }>;
  executionTime?: number;
  formattedSummary?: string;
}

export interface BacktestExportData {
  result?: unknown;
  summary?: string;
  formattedSummary?: string;
}

export interface ExportContext {
  lastScan?: ScanExportData;
  lastAnalysis?: AnalysisExportData;
  lastBacktest?: BacktestExportData;
  lastPortfolio?: Record<string, unknown>;
  lastTechnicalAnalysis?: Record<string, unknown>;
  lastRegime?: Record<string, unknown>;
  toolResults?: Record<string, Record<string, unknown>>;
  sessionMessages?: ChatMessage[];
}

export interface ExportCommandResult {
  success: boolean;
  message: string;
  path?: string;
}

const EXPORT_DIR = "exports";

function normalizeFormat(format: string | undefined, fallback: string): string {
  if (!format) return fallback;
  const lower = format.toLowerCase();
  if (lower === "markdown") return "md";
  if (lower === "text") return "txt";
  return lower;
}

function nowStamp(): string {
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function resolveOutputPath(type: string, ext: string, filename?: string): { filePath: string; dir: string } {
  const baseDir = path.join(process.cwd(), EXPORT_DIR);
  if (!filename) {
    return {
      filePath: path.join(baseDir, `${type}-${nowStamp()}.${ext}`),
      dir: baseDir,
    };
  }

  const hasExt = path.extname(filename).length > 0;
  const finalName = hasExt ? filename : `${filename}.${ext}`;
  const filePath = path.isAbsolute(finalName) ? finalName : path.join(baseDir, finalName);
  return { filePath, dir: path.dirname(filePath) };
}

function escapeCsv(value: unknown): string {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function rowsToCsv(rows: Array<Array<unknown>>): string {
  return rows.map((row) => row.map(escapeCsv).join(",")).join("\n");
}

function formatSessionMarkdown(messages: ChatMessage[]): string {
  const lines: string[] = [];
  lines.push("# Gordon Session Export");
  lines.push("");
  lines.push(`Exported: ${new Date().toLocaleString()}`);
  lines.push(`Messages: ${messages.length}`);
  lines.push("");

  for (const msg of messages) {
    const header = `${msg.role === "user" ? "You" : "Gordon"}${msg.timestamp ? ` (${msg.timestamp})` : ""}`;
    lines.push(`## ${header}`);
    lines.push("");
    lines.push(msg.content);
    lines.push("");
  }

  return lines.join("\n");
}

export async function handleExportCommand(args: string, ctx: ExportContext): Promise<ExportCommandResult> {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  const type = parts[0]?.toLowerCase();

  if (!type) {
    return {
      success: false,
      message: "Usage: /export <scan|analysis|backtest|session> [format] [filename]",
    };
  }

  switch (type) {
    case "scan": {
      if (!ctx.lastScan) {
        return { success: false, message: "No recent scan results to export. Run /scan first." };
      }
      const format = normalizeFormat(parts[1], "csv");
      const filename = parts[2];

      let content = "";
      if (format === "json") {
        content = JSON.stringify(ctx.lastScan, null, 2);
      } else if (format === "csv") {
        const rows: Array<Array<unknown>> = [["symbol", "price", "change24h", "setupConfidence", "bias", "risk"]];
        for (const op of ctx.lastScan.opportunities || []) {
          rows.push([op.symbol, op.price, op.change24h, op.setupConfidence, op.bias, op.risk]);
        }
        content = rowsToCsv(rows);
      } else if (format === "md") {
        const summary = ctx.lastScan.formattedSummary ?? formatScanResults({
          coinsScanned: ctx.lastScan.coinsScanned ?? 0,
          opportunities: ctx.lastScan.opportunities ?? [],
          executionTime: ctx.lastScan.executionTime ?? 0,
        });
        content = summary;
      } else {
        return { success: false, message: `Unsupported format: ${format}. Use csv, json, or md.` };
      }

      const { filePath, dir } = resolveOutputPath("scan", format, filename);
      await mkdir(dir, { recursive: true });
      await writeFile(filePath, content, "utf8");

      return { success: true, message: `Scan export saved: ${filePath}`, path: filePath };
    }

    case "analysis": {
      if (!ctx.lastAnalysis) {
        return { success: false, message: "No recent analysis results to export. Run /analyze first." };
      }
      const symbol = parts[1]?.toUpperCase();
      const format = normalizeFormat(parts[2], "json");
      const filename = parts[3];

      if (symbol && ctx.lastAnalysis.symbol && ctx.lastAnalysis.symbol !== symbol) {
        return {
          success: false,
          message: `Last analysis is for ${ctx.lastAnalysis.symbol}. Run /analyze ${symbol} to export that symbol.`,
        };
      }

      let content = "";
      if (format === "json") {
        content = JSON.stringify(ctx.lastAnalysis, null, 2);
      } else if (format === "md") {
        const summary = ctx.lastAnalysis.formattedSummary ?? formatAnalysisResults({
          symbol: ctx.lastAnalysis.symbol ?? symbol ?? "",
          price: ctx.lastAnalysis.price ?? 0,
          trend: ctx.lastAnalysis.trend ?? "N/A",
          setupDetected: ctx.lastAnalysis.setupDetected ?? false,
          setupConfidence: ctx.lastAnalysis.setupConfidence ?? 0,
          indicators: {
            rsi: ctx.lastAnalysis.indicators?.rsi ?? null,
            macdState: ctx.lastAnalysis.indicators?.macdState,
            volumeTrend: ctx.lastAnalysis.indicators?.volumeTrend,
          },
          supports: ctx.lastAnalysis.supports ?? [],
          resistances: ctx.lastAnalysis.resistances ?? [],
          executionTime: ctx.lastAnalysis.executionTime ?? 0,
        });
        content = summary;
      } else {
        return { success: false, message: `Unsupported format: ${format}. Use json or md.` };
      }

      const { filePath, dir } = resolveOutputPath("analysis", format, filename);
      await mkdir(dir, { recursive: true });
      await writeFile(filePath, content, "utf8");

      return { success: true, message: `Analysis export saved: ${filePath}`, path: filePath };
    }

    case "backtest": {
      if (!ctx.lastBacktest) {
        return { success: false, message: "No recent backtest results to export. Run /backtest first." };
      }
      const format = normalizeFormat(parts[1], "json");
      const filename = parts[2];

      let content = "";
      if (format === "json") {
        content = JSON.stringify(ctx.lastBacktest, null, 2);
      } else if (format === "md") {
        content = ctx.lastBacktest.formattedSummary ?? ctx.lastBacktest.summary ?? "Backtest result available.";
      } else {
        return { success: false, message: `Unsupported format: ${format}. Use json or md.` };
      }

      const { filePath, dir } = resolveOutputPath("backtest", format, filename);
      await mkdir(dir, { recursive: true });
      await writeFile(filePath, content, "utf8");

      return { success: true, message: `Backtest export saved: ${filePath}`, path: filePath };
    }

    case "session": {
      if (!ctx.sessionMessages || ctx.sessionMessages.length === 0) {
        return { success: false, message: "No session messages to export yet." };
      }
      const format = normalizeFormat(parts[1], "md");
      const filename = parts[2];

      let content = "";
      if (format === "json") {
        content = JSON.stringify({ exportedAt: new Date().toISOString(), messages: ctx.sessionMessages }, null, 2);
      } else if (format === "md") {
        content = formatSessionMarkdown(ctx.sessionMessages);
      } else {
        return { success: false, message: `Unsupported format: ${format}. Use md or json.` };
      }

      const { filePath, dir } = resolveOutputPath("session", format, filename);
      await mkdir(dir, { recursive: true });
      await writeFile(filePath, content, "utf8");

      return { success: true, message: `Session export saved: ${filePath}`, path: filePath };
    }

    default:
      return {
        success: false,
        message: `Unknown export type: ${type}. Use scan, analysis, backtest, or session.`,
      };
  }
}

