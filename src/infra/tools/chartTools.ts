/**
 * Multi-Modal Chart Tools
 * Chart image generation and vision-based analysis
 *
 * Features:
 * - Generate candlestick chart images with technical indicators
 * - Analyze chart images using vision-capable models
 * - Support for multiple timeframes and indicators
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import { getGordonContext, normalizeSymbol, type MastraExecutionContext } from "../agents/tools/types.ts";
import { GORDON_MODELS, type LLMProvider } from "../llm/types.ts";

// ============================================================================
// Types and Constants
// ============================================================================

interface ChartDataPoint {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface IndicatorData {
  ma20?: number[];
  ma50?: number[];
  rsi?: number[];
  volumeAvg?: number[];
}

interface ChartGenerationResult {
  success: boolean;
  filePath?: string;
  asciiChart?: string;
  error?: string;
  metadata?: {
    symbol: string;
    timeframe: string;
    periods: number;
    indicators: string[];
    generatedAt: string;
  };
}

interface ChartAnalysisResult {
  success: boolean;
  analysis?: {
    trend: "bullish" | "bearish" | "neutral";
    trendStrength: "strong" | "moderate" | "weak";
    keyLevels: {
      support: number[];
      resistance: number[];
    };
    patterns: string[];
    signals: string[];
    summary: string;
    recommendation: string;
  };
  error?: string;
}

// Chart dimensions for ASCII rendering
const CHART_WIDTH = 80;
const CHART_HEIGHT = 24;

// ANSI colors for terminal
const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  bgGreen: "\x1b[42m",
  bgRed: "\x1b[41m",
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Calculate Simple Moving Average
 */
function calculateSMA(data: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
    } else {
      const sum = data.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
      result.push(sum / period);
    }
  }
  return result;
}

/**
 * Calculate RSI
 */
function calculateRSI(closes: number[], period: number = 14): number[] {
  const result: number[] = [];
  const gains: number[] = [];
  const losses: number[] = [];

  for (let i = 1; i < closes.length; i++) {
    const change = closes[i]! - closes[i - 1]!;
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? Math.abs(change) : 0);
  }

  for (let i = 0; i < closes.length; i++) {
    if (i < period) {
      result.push(NaN);
    } else {
      const avgGain = gains.slice(i - period, i).reduce((a, b) => a + b, 0) / period;
      const avgLoss = losses.slice(i - period, i).reduce((a, b) => a + b, 0) / period;

      if (avgLoss === 0) {
        result.push(100);
      } else {
        const rs = avgGain / avgLoss;
        result.push(100 - 100 / (1 + rs));
      }
    }
  }

  return result;
}

/**
 * Format price for display
 */
function formatPrice(price: number): string {
  if (price >= 10000) return price.toFixed(0);
  if (price >= 100) return price.toFixed(1);
  if (price >= 1) return price.toFixed(2);
  if (price >= 0.01) return price.toFixed(4);
  return price.toFixed(6);
}

/**
 * Scale value to chart row
 */
function scaleToRow(value: number, min: number, max: number, height: number): number {
  const range = max - min || 1;
  return Math.round(((value - min) / range) * (height - 1));
}

/**
 * Detect simple chart patterns
 */
function detectPatterns(candles: ChartDataPoint[]): string[] {
  const patterns: string[] = [];
  const len = candles.length;

  if (len < 5) return patterns;

  // Check for recent candle patterns
  const last = candles[len - 1]!;
  const prev = candles[len - 2]!;
  const prev2 = candles[len - 3]!;

  // Doji detection
  const bodySize = Math.abs(last.close - last.open);
  const wickSize = last.high - last.low;
  if (wickSize > 0 && bodySize / wickSize < 0.1) {
    patterns.push("Doji (indecision)");
  }

  // Hammer/Shooting Star
  const upperWick = last.high - Math.max(last.open, last.close);
  const lowerWick = Math.min(last.open, last.close) - last.low;
  if (lowerWick > bodySize * 2 && upperWick < bodySize * 0.5) {
    patterns.push("Hammer/Bullish reversal");
  }
  if (upperWick > bodySize * 2 && lowerWick < bodySize * 0.5) {
    patterns.push("Shooting Star/Bearish reversal");
  }

  // Engulfing patterns
  if (
    prev.close < prev.open && // Previous was bearish
    last.close > last.open && // Current is bullish
    last.open < prev.close &&
    last.close > prev.open
  ) {
    patterns.push("Bullish Engulfing");
  }
  if (
    prev.close > prev.open && // Previous was bullish
    last.close < last.open && // Current is bearish
    last.open > prev.close &&
    last.close < prev.open
  ) {
    patterns.push("Bearish Engulfing");
  }

  // Three soldiers / Three crows
  if (
    candles[len - 3]!.close > candles[len - 3]!.open &&
    candles[len - 2]!.close > candles[len - 2]!.open &&
    candles[len - 1]!.close > candles[len - 1]!.open
  ) {
    patterns.push("Three White Soldiers (bullish)");
  }
  if (
    candles[len - 3]!.close < candles[len - 3]!.open &&
    candles[len - 2]!.close < candles[len - 2]!.open &&
    candles[len - 1]!.close < candles[len - 1]!.open
  ) {
    patterns.push("Three Black Crows (bearish)");
  }

  return patterns;
}

/**
 * Detect support and resistance levels
 */
function detectLevels(
  candles: ChartDataPoint[],
  count: number = 3
): { support: number[]; resistance: number[] } {
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const currentPrice = candles[candles.length - 1]!.close;

  // Find local minima for support
  const supportLevels: number[] = [];
  for (let i = 2; i < lows.length - 2; i++) {
    if (
      lows[i]! < lows[i - 1]! &&
      lows[i]! < lows[i - 2]! &&
      lows[i]! < lows[i + 1]! &&
      lows[i]! < lows[i + 2]! &&
      lows[i]! < currentPrice
    ) {
      supportLevels.push(lows[i]!);
    }
  }

  // Find local maxima for resistance
  const resistanceLevels: number[] = [];
  for (let i = 2; i < highs.length - 2; i++) {
    if (
      highs[i]! > highs[i - 1]! &&
      highs[i]! > highs[i - 2]! &&
      highs[i]! > highs[i + 1]! &&
      highs[i]! > highs[i + 2]! &&
      highs[i]! > currentPrice
    ) {
      resistanceLevels.push(highs[i]!);
    }
  }

  // Sort and deduplicate (cluster nearby levels)
  const clusterLevels = (levels: number[], threshold: number): number[] => {
    if (levels.length === 0) return [];
    const sorted = [...levels].sort((a, b) => a - b);
    const clustered: number[] = [];
    let current = sorted[0]!;
    let count = 1;

    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i]! - current < threshold) {
        current = (current * count + sorted[i]!) / (count + 1);
        count++;
      } else {
        clustered.push(current);
        current = sorted[i]!;
        count = 1;
      }
    }
    clustered.push(current);
    return clustered;
  };

  const priceRange = Math.max(...highs) - Math.min(...lows);
  const threshold = priceRange * 0.02; // 2% clustering

  return {
    support: clusterLevels(supportLevels, threshold).slice(-count),
    resistance: clusterLevels(resistanceLevels, threshold).slice(0, count),
  };
}

/**
 * Generate ASCII candlestick chart with indicators
 */
function generateASCIIChart(
  candles: ChartDataPoint[],
  indicators: IndicatorData,
  symbol: string,
  timeframe: string
): string {
  const height = CHART_HEIGHT - 6; // Reserve space for header, legend, etc.
  const width = Math.min(candles.length * 3, CHART_WIDTH - 12); // 3 chars per candle + price axis
  const displayCandles = candles.slice(-Math.floor(width / 3));

  // Find price range
  const allPrices = displayCandles.flatMap((c) => [c.high, c.low]);
  const maxPrice = Math.max(...allPrices);
  const minPrice = Math.min(...allPrices);
  const priceRange = maxPrice - minPrice || 1;

  // Initialize chart grid
  const grid: string[][] = Array.from({ length: height }, () =>
    Array(width).fill(" ")
  );

  // Draw candles
  for (let i = 0; i < displayCandles.length; i++) {
    const c = displayCandles[i]!;
    const isBullish = c.close >= c.open;
    const color = isBullish ? ANSI.green : ANSI.red;
    const x = i * 3 + 1; // Center of candle

    const highRow = height - 1 - scaleToRow(c.high, minPrice, maxPrice, height);
    const lowRow = height - 1 - scaleToRow(c.low, minPrice, maxPrice, height);
    const openRow = height - 1 - scaleToRow(c.open, minPrice, maxPrice, height);
    const closeRow = height - 1 - scaleToRow(c.close, minPrice, maxPrice, height);
    const bodyTop = Math.min(openRow, closeRow);
    const bodyBottom = Math.max(openRow, closeRow);

    // Draw wick
    for (let row = highRow; row <= lowRow; row++) {
      if (row >= 0 && row < height && x < width) {
        if (row < bodyTop || row > bodyBottom) {
          grid[row]![x] = `${color}|${ANSI.reset}`;
        }
      }
    }

    // Draw body
    for (let row = bodyTop; row <= bodyBottom; row++) {
      if (row >= 0 && row < height) {
        const bodyChar = isBullish ? "█" : "░";
        if (x - 1 >= 0 && x - 1 < width) grid[row]![x - 1] = `${color}${bodyChar}${ANSI.reset}`;
        if (x < width) grid[row]![x] = `${color}${bodyChar}${ANSI.reset}`;
        if (x + 1 < width) grid[row]![x + 1] = `${color}${bodyChar}${ANSI.reset}`;
      }
    }
  }

  // Draw MA20 if available
  if (indicators.ma20 && indicators.ma20.length > 0) {
    const ma = indicators.ma20.slice(-displayCandles.length);
    for (let i = 1; i < ma.length; i++) {
      if (!isNaN(ma[i]!) && !isNaN(ma[i - 1]!)) {
        const row = height - 1 - scaleToRow(ma[i]!, minPrice, maxPrice, height);
        const x = i * 3 + 1;
        if (row >= 0 && row < height && x < width) {
          if (grid[row]![x] === " ") {
            grid[row]![x] = `${ANSI.yellow}~${ANSI.reset}`;
          }
        }
      }
    }
  }

  // Draw MA50 if available
  if (indicators.ma50 && indicators.ma50.length > 0) {
    const ma = indicators.ma50.slice(-displayCandles.length);
    for (let i = 1; i < ma.length; i++) {
      if (!isNaN(ma[i]!) && !isNaN(ma[i - 1]!)) {
        const row = height - 1 - scaleToRow(ma[i]!, minPrice, maxPrice, height);
        const x = i * 3 + 1;
        if (row >= 0 && row < height && x < width) {
          if (grid[row]![x] === " ") {
            grid[row]![x] = `${ANSI.blue}-${ANSI.reset}`;
          }
        }
      }
    }
  }

  // Build output
  const lines: string[] = [];

  // Header
  lines.push(`${ANSI.bold}${symbol} - ${timeframe}${ANSI.reset}`);
  lines.push(`${ANSI.dim}${"─".repeat(width + 12)}${ANSI.reset}`);

  // Chart with price axis
  const priceStep = priceRange / (height - 1);
  for (let row = 0; row < height; row++) {
    const price = maxPrice - row * priceStep;
    const priceLabel = formatPrice(price).padStart(10);

    // Show price labels at top, middle, bottom
    if (row === 0 || row === height - 1 || row === Math.floor(height / 2)) {
      lines.push(`${ANSI.dim}${priceLabel}${ANSI.reset} │${grid[row]!.join("")}`);
    } else {
      lines.push(`${" ".repeat(10)} │${grid[row]!.join("")}`);
    }
  }

  // Bottom border
  lines.push(`${" ".repeat(10)} └${"─".repeat(width)}`);

  // Time axis
  const timeLabel = `${ANSI.dim}${"oldest".padStart(15)}${"←  Time  →".padStart(Math.floor(width / 2))}${"now".padStart(Math.floor(width / 2) - 4)}${ANSI.reset}`;
  lines.push(timeLabel);

  // Legend
  lines.push("");
  lines.push(`${ANSI.dim}Legend:${ANSI.reset} ${ANSI.green}███${ANSI.reset} Bullish  ${ANSI.red}░░░${ANSI.reset} Bearish  ${ANSI.yellow}~~~${ANSI.reset} MA20  ${ANSI.blue}---${ANSI.reset} MA50`);

  // RSI indicator
  if (indicators.rsi && indicators.rsi.length > 0) {
    const currentRSI = indicators.rsi[indicators.rsi.length - 1];
    if (!isNaN(currentRSI!)) {
      const rsiColor =
        currentRSI! > 70 ? ANSI.red : currentRSI! < 30 ? ANSI.green : ANSI.white;
      const rsiStatus =
        currentRSI! > 70 ? "Overbought" : currentRSI! < 30 ? "Oversold" : "Neutral";
      lines.push(
        `${ANSI.dim}RSI(14):${ANSI.reset} ${rsiColor}${currentRSI!.toFixed(1)}${ANSI.reset} (${rsiStatus})`
      );
    }
  }

  // Current price
  const current = displayCandles[displayCandles.length - 1]!;
  const change = current.close - displayCandles[0]!.open;
  const changePct = (change / displayCandles[0]!.open) * 100;
  const changeColor = change >= 0 ? ANSI.green : ANSI.red;
  const changeSign = change >= 0 ? "+" : "";

  lines.push(
    `${ANSI.dim}Price:${ANSI.reset} ${ANSI.bold}${formatPrice(current.close)}${ANSI.reset} ` +
      `${changeColor}${changeSign}${changePct.toFixed(2)}%${ANSI.reset}`
  );

  return lines.join("\n");
}

/**
 * Generate SVG chart (for future image export)
 */
function generateSVGChart(
  candles: ChartDataPoint[],
  indicators: IndicatorData,
  symbol: string,
  timeframe: string
): string {
  const width = 800;
  const height = 400;
  const padding = 60;
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;

  const allPrices = candles.flatMap((c) => [c.high, c.low]);
  const maxPrice = Math.max(...allPrices);
  const minPrice = Math.min(...allPrices);
  const priceRange = maxPrice - minPrice || 1;

  const candleWidth = chartWidth / candles.length;
  const bodyWidth = candleWidth * 0.7;

  // SVG helper functions
  const scaleX = (i: number) => padding + i * candleWidth + candleWidth / 2;
  const scaleY = (price: number) =>
    padding + chartHeight - ((price - minPrice) / priceRange) * chartHeight;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">`;

  // Background
  svg += `<rect width="${width}" height="${height}" fill="#1a1a2e"/>`;

  // Grid lines
  svg += `<g stroke="#333" stroke-width="1">`;
  for (let i = 0; i <= 4; i++) {
    const y = padding + (i * chartHeight) / 4;
    svg += `<line x1="${padding}" y1="${y}" x2="${width - padding}" y2="${y}"/>`;
  }
  svg += `</g>`;

  // MA lines
  if (indicators.ma20) {
    const points = indicators.ma20
      .map((val, i) => (!isNaN(val) ? `${scaleX(i)},${scaleY(val)}` : null))
      .filter(Boolean)
      .join(" ");
    if (points) {
      svg += `<polyline points="${points}" fill="none" stroke="#f1c40f" stroke-width="1.5"/>`;
    }
  }

  if (indicators.ma50) {
    const points = indicators.ma50
      .map((val, i) => (!isNaN(val) ? `${scaleX(i)},${scaleY(val)}` : null))
      .filter(Boolean)
      .join(" ");
    if (points) {
      svg += `<polyline points="${points}" fill="none" stroke="#3498db" stroke-width="1.5"/>`;
    }
  }

  // Candlesticks
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;
    const x = scaleX(i);
    const isBullish = c.close >= c.open;
    const color = isBullish ? "#00d395" : "#ff6b6b";

    // Wick
    svg += `<line x1="${x}" y1="${scaleY(c.high)}" x2="${x}" y2="${scaleY(c.low)}" stroke="${color}" stroke-width="1"/>`;

    // Body
    const bodyTop = scaleY(Math.max(c.open, c.close));
    const bodyHeight = Math.abs(scaleY(c.open) - scaleY(c.close)) || 1;
    svg += `<rect x="${x - bodyWidth / 2}" y="${bodyTop}" width="${bodyWidth}" height="${bodyHeight}" fill="${color}"/>`;
  }

  // Price axis labels
  svg += `<g fill="#888" font-size="12" font-family="monospace">`;
  for (let i = 0; i <= 4; i++) {
    const price = maxPrice - (i * priceRange) / 4;
    const y = padding + (i * chartHeight) / 4;
    svg += `<text x="${padding - 5}" y="${y + 4}" text-anchor="end">${formatPrice(price)}</text>`;
  }
  svg += `</g>`;

  // Title
  svg += `<text x="${width / 2}" y="25" fill="#fff" font-size="16" font-family="sans-serif" text-anchor="middle" font-weight="bold">${symbol} - ${timeframe}</text>`;

  // Legend
  svg += `<g font-size="10" font-family="sans-serif">`;
  svg += `<rect x="${padding}" y="${height - 25}" width="10" height="10" fill="#f1c40f"/>`;
  svg += `<text x="${padding + 15}" y="${height - 17}" fill="#888">MA20</text>`;
  svg += `<rect x="${padding + 60}" y="${height - 25}" width="10" height="10" fill="#3498db"/>`;
  svg += `<text x="${padding + 75}" y="${height - 17}" fill="#888">MA50</text>`;
  svg += `</g>`;

  svg += `</svg>`;

  return svg;
}

// ============================================================================
// Tool: Generate Chart
// ============================================================================

export const generateChartTool = createTool({
  id: "generate_chart",
  description:
    "Generate a chart image for a trading pair. Creates a candlestick chart with technical indicators " +
    "(MA, RSI, volume). Returns an ASCII chart for terminal display and optionally saves SVG for image viewing. " +
    "Use when user wants to see a visual price chart or asks 'show me the chart'.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT', 'ETHUSDT')"),
    timeframe: z
      .enum(["1h", "4h", "1d"])
      .default("4h")
      .describe("Chart timeframe"),
    periods: z
      .number()
      .min(20)
      .max(100)
      .default(50)
      .describe("Number of candles to display"),
    indicators: z
      .array(z.enum(["ma20", "ma50", "rsi", "volume"]))
      .default(["ma20", "ma50", "rsi"])
      .describe("Technical indicators to include"),
    saveImage: z
      .boolean()
      .default(false)
      .describe("Save SVG image to temp file"),
  }),
  execute: async (
    { symbol, timeframe, periods, indicators, saveImage },
    execContext: MastraExecutionContext
  ): Promise<ChartGenerationResult> => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.binance) {
      return {
        success: false,
        error: "Binance client not connected. Please run setup first.",
      };
    }

    const normalizedSymbol = normalizeSymbol(symbol);

    try {
      // Fetch candle data
      const rawCandles = await ctx.binance.getCandles(normalizedSymbol, timeframe, periods);

      if (!rawCandles || rawCandles.length < 20) {
        return {
          success: false,
          error: `Insufficient data for ${normalizedSymbol}. Need at least 20 candles.`,
        };
      }

      const candles: ChartDataPoint[] = rawCandles.map((c) => ({
        timestamp: c.timestamp || Date.now(),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      }));

      // Calculate indicators
      const closes = candles.map((c) => c.close);
      const indicatorData: IndicatorData = {};

      if (indicators.includes("ma20")) {
        indicatorData.ma20 = calculateSMA(closes, 20);
      }
      if (indicators.includes("ma50")) {
        indicatorData.ma50 = calculateSMA(closes, 50);
      }
      if (indicators.includes("rsi")) {
        indicatorData.rsi = calculateRSI(closes, 14);
      }
      if (indicators.includes("volume")) {
        indicatorData.volumeAvg = calculateSMA(
          candles.map((c) => c.volume),
          20
        );
      }

      // Generate ASCII chart
      const asciiChart = generateASCIIChart(candles, indicatorData, normalizedSymbol, timeframe);

      // Optionally save SVG
      let filePath: string | undefined;
      if (saveImage) {
        const svgChart = generateSVGChart(candles, indicatorData, normalizedSymbol, timeframe);
        const tempDir = os.tmpdir();
        const fileName = `chart-${normalizedSymbol}-${timeframe}-${Date.now()}.svg`;
        filePath = path.join(tempDir, fileName);
        fs.writeFileSync(filePath, svgChart);
      }

      return {
        success: true,
        filePath,
        asciiChart,
        metadata: {
          symbol: normalizedSymbol,
          timeframe,
          periods: candles.length,
          indicators,
          generatedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to generate chart: ${(error as Error).message}`,
      };
    }
  },
});

// ============================================================================
// Tool: Analyze Chart
// ============================================================================

export const analyzeChartTool = createTool({
  id: "analyze_chart",
  description:
    "Perform technical analysis on a chart. Analyzes price action, detects patterns, " +
    "identifies support/resistance levels, and provides trading signals. " +
    "Use when user asks for 'technical analysis' or 'TA' on a symbol.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT', 'ETHUSDT')"),
    timeframe: z
      .enum(["1h", "4h", "1d"])
      .default("4h")
      .describe("Analysis timeframe"),
    periods: z
      .number()
      .min(50)
      .max(200)
      .default(100)
      .describe("Historical periods to analyze"),
    useVision: z
      .boolean()
      .default(false)
      .describe("Use vision model for advanced chart analysis (if available)"),
  }),
  execute: async (
    { symbol, timeframe, periods, useVision },
    execContext: MastraExecutionContext
  ): Promise<ChartAnalysisResult> => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.binance) {
      return {
        success: false,
        error: "Binance client not connected. Please run setup first.",
      };
    }

    const normalizedSymbol = normalizeSymbol(symbol);

    try {
      // Fetch candle data
      const rawCandles = await ctx.binance.getCandles(normalizedSymbol, timeframe, periods);

      if (!rawCandles || rawCandles.length < 50) {
        return {
          success: false,
          error: `Insufficient data for ${normalizedSymbol}. Need at least 50 candles.`,
        };
      }

      const candles: ChartDataPoint[] = rawCandles.map((c) => ({
        timestamp: c.timestamp || Date.now(),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      }));

      // Calculate indicators
      const closes = candles.map((c) => c.close);
      const ma20 = calculateSMA(closes, 20);
      const ma50 = calculateSMA(closes, 50);
      const rsi = calculateRSI(closes, 14);

      const currentPrice = closes[closes.length - 1]!;
      const currentMA20 = ma20[ma20.length - 1]!;
      const currentMA50 = ma50[ma50.length - 1]!;
      const currentRSI = rsi[rsi.length - 1]!;

      // Determine trend
      let trend: "bullish" | "bearish" | "neutral";
      let trendStrength: "strong" | "moderate" | "weak";

      if (currentPrice > currentMA20 && currentMA20 > currentMA50) {
        trend = "bullish";
        trendStrength = currentPrice > currentMA50 * 1.05 ? "strong" : "moderate";
      } else if (currentPrice < currentMA20 && currentMA20 < currentMA50) {
        trend = "bearish";
        trendStrength = currentPrice < currentMA50 * 0.95 ? "strong" : "moderate";
      } else {
        trend = "neutral";
        trendStrength = "weak";
      }

      // Detect patterns
      const patterns = detectPatterns(candles);

      // Detect levels
      const levels = detectLevels(candles, 3);

      // Generate signals
      const signals: string[] = [];

      // RSI signals
      if (!isNaN(currentRSI)) {
        if (currentRSI > 70) signals.push("RSI overbought - potential pullback");
        if (currentRSI < 30) signals.push("RSI oversold - potential bounce");
        if (currentRSI > 50 && currentRSI < 70) signals.push("RSI bullish momentum");
        if (currentRSI < 50 && currentRSI > 30) signals.push("RSI bearish momentum");
      }

      // MA signals
      if (!isNaN(currentMA20) && !isNaN(currentMA50)) {
        const prevMA20 = ma20[ma20.length - 2]!;
        const prevMA50 = ma50[ma50.length - 2]!;

        if (prevMA20 < prevMA50 && currentMA20 > currentMA50) {
          signals.push("Golden Cross - bullish MA crossover");
        }
        if (prevMA20 > prevMA50 && currentMA20 < currentMA50) {
          signals.push("Death Cross - bearish MA crossover");
        }

        if (currentPrice > currentMA20) {
          signals.push("Price above MA20 - short-term bullish");
        } else {
          signals.push("Price below MA20 - short-term bearish");
        }
      }

      // Volume analysis
      const volumes = candles.map((c) => c.volume);
      const avgVolume = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
      const currentVolume = volumes[volumes.length - 1]!;
      if (currentVolume > avgVolume * 1.5) {
        signals.push("High volume - increased interest");
      }

      // Generate summary
      const summary =
        `${normalizedSymbol} is in a ${trendStrength} ${trend} trend on the ${timeframe} timeframe. ` +
        `Current price: $${formatPrice(currentPrice)}. ` +
        (patterns.length > 0 ? `Detected patterns: ${patterns.join(", ")}. ` : "") +
        (levels.support.length > 0
          ? `Key support at $${levels.support.map(formatPrice).join(", $")}. `
          : "") +
        (levels.resistance.length > 0
          ? `Key resistance at $${levels.resistance.map(formatPrice).join(", $")}. `
          : "") +
        (!isNaN(currentRSI) ? `RSI: ${currentRSI.toFixed(1)}.` : "");

      // Generate recommendation
      let recommendation: string;
      if (trend === "bullish" && trendStrength !== "weak" && currentRSI < 70) {
        recommendation =
          "Consider long positions on pullbacks to MA20 or support levels. " +
          "Use stop-loss below recent swing low.";
      } else if (trend === "bearish" && trendStrength !== "weak" && currentRSI > 30) {
        recommendation =
          "Consider short positions on bounces to MA20 or resistance levels. " +
          "Use stop-loss above recent swing high.";
      } else if (currentRSI > 70) {
        recommendation =
          "Overbought conditions. Wait for pullback before entering long. " +
          "Consider taking profits on existing longs.";
      } else if (currentRSI < 30) {
        recommendation =
          "Oversold conditions. Potential bounce opportunity. " +
          "Consider scaling into longs with tight stops.";
      } else {
        recommendation =
          "Neutral/unclear conditions. Wait for clearer signals or " +
          "trade range between support and resistance.";
      }

      return {
        success: true,
        analysis: {
          trend,
          trendStrength,
          keyLevels: levels,
          patterns,
          signals,
          summary,
          recommendation,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to analyze chart: ${(error as Error).message}`,
      };
    }
  },
});

// ============================================================================
// Tool: Quick Technical Analysis
// ============================================================================

export const quickTATool = createTool({
  id: "quick_ta",
  description:
    "Get a quick technical analysis summary for a trading pair. " +
    "Combines chart generation and analysis into a single tool call. " +
    "Use when user asks '/ta <symbol>' or 'quick TA for BTC'.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT', 'BTC')"),
    timeframe: z
      .enum(["1h", "4h", "1d"])
      .default("4h")
      .describe("Analysis timeframe"),
  }),
  execute: async (
    { symbol, timeframe },
    execContext: MastraExecutionContext
  ) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.binance) {
      return { error: "Binance client not connected. Please run setup first." };
    }

    const normalizedSymbol = normalizeSymbol(symbol);

    try {
      // Fetch data
      const rawCandles = await ctx.binance.getCandles(normalizedSymbol, timeframe, 100);

      if (!rawCandles || rawCandles.length < 50) {
        return { error: `Insufficient data for ${normalizedSymbol}` };
      }

      const candles: ChartDataPoint[] = rawCandles.map((c) => ({
        timestamp: c.timestamp || Date.now(),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      }));

      // Calculate all indicators
      const closes = candles.map((c) => c.close);
      const indicatorData: IndicatorData = {
        ma20: calculateSMA(closes, 20),
        ma50: calculateSMA(closes, 50),
        rsi: calculateRSI(closes, 14),
      };

      // Generate ASCII chart
      const chart = generateASCIIChart(candles, indicatorData, normalizedSymbol, timeframe);

      // Quick analysis
      const currentPrice = closes[closes.length - 1]!;
      const currentMA20 = indicatorData.ma20![indicatorData.ma20!.length - 1]!;
      const currentMA50 = indicatorData.ma50![indicatorData.ma50!.length - 1]!;
      const currentRSI = indicatorData.rsi![indicatorData.rsi!.length - 1]!;

      const patterns = detectPatterns(candles);
      const levels = detectLevels(candles, 2);

      // Trend determination
      let trend: string;
      if (currentPrice > currentMA20 && currentMA20 > currentMA50) {
        trend = "Bullish";
      } else if (currentPrice < currentMA20 && currentMA20 < currentMA50) {
        trend = "Bearish";
      } else {
        trend = "Neutral/Ranging";
      }

      // Bias
      let bias: string;
      if (currentRSI > 60 && currentPrice > currentMA20) {
        bias = "Strong Buy";
      } else if (currentRSI > 50 && currentPrice > currentMA50) {
        bias = "Buy";
      } else if (currentRSI < 40 && currentPrice < currentMA20) {
        bias = "Strong Sell";
      } else if (currentRSI < 50 && currentPrice < currentMA50) {
        bias = "Sell";
      } else {
        bias = "Hold";
      }

      return {
        symbol: normalizedSymbol,
        timeframe,
        chart,
        analysis: {
          trend,
          bias,
          price: currentPrice,
          rsi: isNaN(currentRSI) ? null : Math.round(currentRSI * 10) / 10,
          ma20: isNaN(currentMA20) ? null : currentMA20,
          ma50: isNaN(currentMA50) ? null : currentMA50,
          patterns: patterns.length > 0 ? patterns : ["None detected"],
          support: levels.support.map((p) => formatPrice(p)),
          resistance: levels.resistance.map((p) => formatPrice(p)),
        },
      };
    } catch (error) {
      return { error: `Technical analysis failed: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// Export Tools
// ============================================================================

/**
 * Multi-modal chart tools for Mastra Agent
 */
export const multiModalChartTools = {
  generate_chart: generateChartTool,
  analyze_chart: analyzeChartTool,
  quick_ta: quickTATool,
};
