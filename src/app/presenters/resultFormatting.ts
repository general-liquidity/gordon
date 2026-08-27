export interface ResultSummary {
  operation: string;
  found: number;
  total?: number;
  filtered?: number;
  executionTime: number;
  topResult?: string;
  context?: string;
}

export interface ScanResultFormatOptions {
  coinsScanned: number;
  opportunities: Array<{
    symbol: string;
    price: number;
    change24h: number;
    setupConfidence: number;
    bias: string;
    risk: string;
  }>;
  executionTime: number;
  maxRows?: number;
}

export interface AnalysisResultFormatOptions {
  symbol: string;
  price: number;
  trend: string;
  setupDetected: boolean;
  setupConfidence: number;
  indicators: {
    rsi: number | null;
    macdState?: string;
    volumeTrend?: string;
  };
  supports: Array<{ price: number; strength: number }>;
  resistances: Array<{ price: number; strength: number }>;
  executionTime: number;
}

export function formatExecutionTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = (seconds % 60).toFixed(0);
  return `${minutes}m ${remainingSeconds}s`;
}

export function formatNumber(value: number, decimals = 2): string {
  if (value === undefined || value === null || Number.isNaN(value)) return "N/A";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(decimals)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(decimals)}K`;
  return value.toFixed(decimals);
}

export function formatPercent(value: number, decimals = 2): string {
  if (value === undefined || value === null || Number.isNaN(value)) return "N/A";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(decimals)}%`;
}

export function formatCurrency(value: number, decimals = 2): string {
  if (value === undefined || value === null || Number.isNaN(value)) return "N/A";
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(decimals)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(decimals)}K`;
  return `$${value.toFixed(decimals)}`;
}

export function formatResultSummary(summary: ResultSummary): string {
  const { operation, found, total, filtered, executionTime, topResult, context } = summary;
  const lines: string[] = [];
  lines.push(`=== ${operation.toUpperCase()} RESULTS ===`);
  const stats: string[] = [];
  if (total !== undefined) stats.push(`Scanned: ${total.toLocaleString()}`);
  stats.push(`Found: ${found.toLocaleString()}`);
  if (filtered !== undefined) stats.push(`Filtered: ${filtered.toLocaleString()}`);
  lines.push(stats.join(" | "));
  if (topResult) lines.push(`Top: ${topResult}`);
  if (context) lines.push(context);
  lines.push(`Execution: ${formatExecutionTime(executionTime)}`);
  return lines.join("\n");
}

export function formatScanResults(options: ScanResultFormatOptions): string {
  const { coinsScanned, opportunities, executionTime, maxRows = 10 } = options;
  const lines: string[] = [];
  lines.push("=== SCAN RESULTS ===");
  lines.push(
    `Scanned: ${coinsScanned} coins | Found: ${opportunities.length} setups | Filtered: ${coinsScanned - opportunities.length}`,
  );
  if (opportunities.length > 0) {
    const topSetup = opportunities[0]!;
    lines.push(
      `Top Setup: ${topSetup.symbol} at ${formatCurrency(topSetup.price)} (${Math.round(topSetup.setupConfidence * 100)}% confidence)`,
    );
  }
  lines.push(`Execution: ${formatExecutionTime(executionTime)}`);
  lines.push("");

  if (opportunities.length === 0) {
    lines.push("No opportunities detected.");
    return lines.join("\n");
  }

  lines.push("| Symbol     | Price       | 24h%     | Conf%  | Bias     | Risk   |");
  lines.push("|------------|-------------|----------|--------|----------|--------|");

  for (const opportunity of opportunities.slice(0, maxRows)) {
    const symbol = opportunity.symbol.padEnd(10);
    const price = formatCurrency(opportunity.price).padStart(11);
    const change = formatPercent(opportunity.change24h).padStart(8);
    const confidence = `${Math.round(opportunity.setupConfidence * 100)}%`.padStart(6);
    const bias = opportunity.bias.padEnd(8);
    const risk = opportunity.risk.padEnd(6);
    lines.push(`| ${symbol} | ${price} | ${change} | ${confidence} | ${bias} | ${risk} |`);
  }

  if (opportunities.length > maxRows) {
    lines.push(`\n...and ${opportunities.length - maxRows} more opportunities`);
  }

  return lines.join("\n");
}

export function formatAnalysisResults(options: AnalysisResultFormatOptions): string {
  const {
    symbol,
    price,
    trend,
    setupDetected,
    setupConfidence,
    indicators,
    supports,
    resistances,
    executionTime,
  } = options;
  const lines: string[] = [];
  lines.push(`=== ANALYSIS: ${symbol} ===`);
  lines.push(`Price: ${formatCurrency(price)} | Trend: ${trend}`);
  lines.push(
    setupDetected
      ? `Setup: DETECTED (${Math.round(setupConfidence * 100)}% confidence)`
      : "Setup: Not detected",
  );
  lines.push(`Execution: ${formatExecutionTime(executionTime)}`);
  lines.push("");
  lines.push("--- Indicators ---");
  if (indicators.rsi !== null) {
    const rsiStatus =
      indicators.rsi < 30 ? "(Oversold)" : indicators.rsi > 70 ? "(Overbought)" : "";
    lines.push(`RSI: ${indicators.rsi.toFixed(1)} ${rsiStatus}`.trim());
  }
  if (indicators.macdState) lines.push(`MACD: ${indicators.macdState}`);
  if (indicators.volumeTrend) lines.push(`Volume: ${indicators.volumeTrend}`);
  lines.push("");

  if (supports.length > 0) {
    lines.push("--- Support Levels ---");
    for (const level of supports.slice(0, 3)) {
      const strength = "=".repeat(Math.round(level.strength * 5));
      lines.push(
        `${formatCurrency(level.price)} [${strength}] ${Math.round(level.strength * 100)}%`,
      );
    }
    lines.push("");
  }

  if (resistances.length > 0) {
    lines.push("--- Resistance Levels ---");
    for (const level of resistances.slice(0, 3)) {
      const strength = "=".repeat(Math.round(level.strength * 5));
      lines.push(
        `${formatCurrency(level.price)} [${strength}] ${Math.round(level.strength * 100)}%`,
      );
    }
  }

  return lines.join("\n");
}
