/**
 * Chart Tools (Mastra Format)
 * ASCII chart visualization for terminal display
 *
 * This file is the Mastra-format version of the chart tools.
 * Key differences from OpenAI Agents SDK format:
 * - tool() -> createTool()
 * - name -> id
 * - parameters -> inputSchema
 * - Context access via first parameter destructuring
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const asciichart = require("asciichart") as {
  plot: (series: number[] | number[][], options?: Record<string, unknown>) => string;
  green: string;
  red: string;
  blue: string;
  yellow: string;
};

import { getGordonContext, normalizeSymbol, type MastraExecutionContext } from "../types.ts";

// ============================================================================
// Error Messages
// ============================================================================

const errors = {
  noExchange: { error: "Exchange client not connected. Please run setup first." },
};

// ============================================================================
// ANSI Color Codes for Terminal
// ============================================================================

const COLORS = {
  green: "\x1b[32m",
  red: "\x1b[31m",
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
};

// ============================================================================
// Lightweight ASCII Candlestick Renderer
// ============================================================================

interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Render ASCII candlestick chart with red/green colors
 * Each candle is 3 characters wide with 1 char spacing for readability
 */
function renderCandlestickChart(
  candles: Candle[],
  options: { height?: number; showVolume?: boolean } = {}
): string {
  const { height = 18, showVolume = true } = options;
  const chartHeight = showVolume ? height - 5 : height;
  const candleWidth = 3; // Width of each candle body
  const spacing = 1;     // Space between candles
  const cellWidth = candleWidth + spacing; // Total width per candle

  // Find price range
  const allPrices = candles.flatMap((c) => [c.high, c.low]);
  const maxPrice = Math.max(...allPrices);
  const minPrice = Math.min(...allPrices);
  const priceRange = maxPrice - minPrice || 1;

  // Scale helper - maps price to row index
  const scaleY = (price: number): number => {
    return Math.round(((price - minPrice) / priceRange) * (chartHeight - 1));
  };

  // Initialize grid - each cell holds a string (with ANSI codes)
  const totalWidth = candles.length * cellWidth;
  const grid: string[][] = Array.from({ length: chartHeight }, () =>
    Array(totalWidth).fill(" ")
  );

  // Draw each candle
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (!c) continue;

    const isBullish = c.close >= c.open;
    const color = isBullish ? COLORS.green : COLORS.red;
    const startX = i * cellWidth; // Starting X position for this candle
    const centerX = startX + 1;   // Center of the candle (for wick)

    const highY = scaleY(c.high);
    const lowY = scaleY(c.low);
    const openY = scaleY(c.open);
    const closeY = scaleY(c.close);
    const bodyTop = Math.max(openY, closeY);
    const bodyBottom = Math.min(openY, closeY);

    // Draw the candle from bottom to top
    for (let y = lowY; y <= highY; y++) {
      const rowIndex = chartHeight - 1 - y; // Invert for display
      if (rowIndex < 0 || rowIndex >= chartHeight) continue;

      if (y > bodyTop || y < bodyBottom) {
        // Wick - only center character
        grid[rowIndex]![centerX] = `${color}│${COLORS.reset}`;
      } else {
        // Body - fill all 3 characters
        const bodyChar = isBullish ? "█" : "░";
        const dojiChar = "─";

        if (bodyTop === bodyBottom) {
          // Doji - horizontal line
          grid[rowIndex]![startX] = `${color}${dojiChar}${COLORS.reset}`;
          grid[rowIndex]![startX + 1] = `${color}${dojiChar}${COLORS.reset}`;
          grid[rowIndex]![startX + 2] = `${color}${dojiChar}${COLORS.reset}`;
        } else {
          grid[rowIndex]![startX] = `${color}${bodyChar}${COLORS.reset}`;
          grid[rowIndex]![startX + 1] = `${color}${bodyChar}${COLORS.reset}`;
          grid[rowIndex]![startX + 2] = `${color}${bodyChar}${COLORS.reset}`;
        }
      }
    }
  }

  // Build output with price axis
  const lines: string[] = [];
  const priceStep = priceRange / (chartHeight - 1);

  for (let row = 0; row < chartHeight; row++) {
    const price = maxPrice - row * priceStep;
    const priceLabel = formatPrice(price).padStart(10);
    const rowContent = grid[row]!.join("");

    // Show price labels at top, middle, and bottom
    if (row === 0 || row === chartHeight - 1 || row === Math.floor(chartHeight / 2)) {
      lines.push(`${COLORS.dim}${priceLabel}${COLORS.reset} ┤${rowContent}`);
    } else {
      lines.push(`${" ".repeat(10)} │${rowContent}`);
    }
  }

  // Add bottom border with time markers
  const borderLine = "─".repeat(totalWidth);
  lines.push(`${" ".repeat(10)} └${borderLine}`);

  // Time axis labels (oldest -> newest)
  let timeAxis = `${" ".repeat(12)}`;
  const labelInterval = Math.max(1, Math.floor(candles.length / 5)); // ~5 labels
  for (let i = 0; i < candles.length; i++) {
    if (i % labelInterval === 0 || i === candles.length - 1) {
      const label = i === 0 ? "oldest" : i === candles.length - 1 ? "now" : `${i}`;
      timeAxis += label.padEnd(cellWidth * labelInterval);
    }
  }
  lines.push(`${COLORS.dim}${timeAxis}${COLORS.reset}`);

  // Add volume bars if requested
  if (showVolume) {
    const volumes = candles.map((c) => c.volume);
    const maxVol = Math.max(...volumes);

    let volBar = `${" ".repeat(12)}`;
    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      if (!c) continue;

      const volRatio = c.volume / maxVol;
      const isBullish = c.close >= c.open;
      const color = isBullish ? COLORS.green : COLORS.red;

      // Use different height chars based on volume ratio
      let volChar: string;
      if (volRatio > 0.75) volChar = "█";
      else if (volRatio > 0.5) volChar = "▆";
      else if (volRatio > 0.25) volChar = "▄";
      else volChar = "▂";

      // Volume bar is 3 chars wide like the candle
      volBar += `${color}${volChar}${volChar}${volChar}${COLORS.reset} `;
    }
    lines.push(volBar);
    lines.push(`${COLORS.dim}${"Vol".padStart(10)}  └${"─".repeat(totalWidth)}${COLORS.reset}`);
  }

  return lines.join("\n");
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

// ============================================================================
// ASCII Price Chart Tool
// ============================================================================

export const displayPriceChartTool = createTool({
  id: "display_price_chart",
  description:
    "Display an ASCII price chart in the terminal. " +
    "Use when user asks for 'chart', 'graph', 'visual', 'price trend', or 'show me the price'. " +
    "Shows closing prices over time as a line chart.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT', 'ETHUSDT')"),
    interval: z
      .enum(["1h", "4h", "1d"])
      .default("1d")
      .describe("Candle interval"),
    periods: z
      .number()
      .min(7)
      .max(100)
      .default(14)
      .describe("Number of periods to show (default: 14)"),
  }),
  execute: async ({ symbol, interval, periods }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return errors.noExchange;
    }

    // Normalize symbol
    const normalizedSymbol = normalizeSymbol(symbol);

    try {
      const candles = await ctx.exchange.getCandles(normalizedSymbol, interval, periods);

      if (!candles || candles.length === 0) {
        return { error: `No candle data found for ${normalizedSymbol}` };
      }

      // Extract closing prices
      const closes = candles.map((c) => c.close);
      const highs = candles.map((c) => c.high);
      const lows = candles.map((c) => c.low);

      // Calculate stats
      const currentPrice = closes[closes.length - 1] ?? 0;
      const startPrice = closes[0] ?? 0;
      const highPrice = Math.max(...highs);
      const lowPrice = Math.min(...lows);
      const priceChange = currentPrice - startPrice;
      const priceChangePercent = startPrice > 0 ? (priceChange / startPrice) * 100 : 0;

      // Generate ASCII chart with color based on trend
      const trendColor = priceChangePercent >= 0 ? asciichart.green : asciichart.red;
      const chart = asciichart.plot(closes, {
        height: 12,
        colors: [trendColor],
        format: (x: number) => {
          // Format based on price magnitude
          if (x >= 1000) return x.toFixed(0).padStart(8);
          if (x >= 1) return x.toFixed(2).padStart(8);
          if (x >= 0.0001) return x.toFixed(6).padStart(8);
          return x.toFixed(8).padStart(10);
        },
      });

      // Build time labels
      const intervalLabel = interval === "1h" ? "hours" : interval === "4h" ? "4-hour periods" : "days";

      return {
        symbol: normalizedSymbol,
        interval,
        periods: candles.length,
        chart: `\n${chart}\n`,
        timeRange: `Last ${candles.length} ${intervalLabel}`,
        stats: {
          current: currentPrice,
          start: startPrice,
          high: highPrice,
          low: lowPrice,
          change: priceChange,
          changePercent: `${priceChangePercent >= 0 ? "+" : ""}${priceChangePercent.toFixed(2)}%`,
        },
        legend: `^ Price (${normalizedSymbol}) | Left: oldest, Right: newest`,
      };
    } catch (error) {
      return { error: `Failed to generate chart: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// Candlestick Chart Tool (with red/green colors)
// ============================================================================

export const displayCandlestickChartTool = createTool({
  id: "display_candlestick_chart",
  description:
    "Display a professional candlestick chart with red/green colors. " +
    "Use when user asks for 'candlestick', 'candles', 'OHLC', or wants a professional trading chart. " +
    "Shows open, high, low, close with bullish (green) and bearish (red) candles.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT', 'ETHUSDT')"),
    interval: z
      .enum(["1h", "4h", "1d"])
      .default("1d")
      .describe("Candle interval"),
    periods: z
      .number()
      .min(10)
      .max(50)
      .default(20)
      .describe("Number of candles to show (default: 20)"),
    showVolume: z
      .boolean()
      .default(true)
      .describe("Show volume bars below chart"),
  }),
  execute: async ({ symbol, interval, periods, showVolume }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return errors.noExchange;
    }

    // Normalize symbol
    const normalizedSymbol = normalizeSymbol(symbol);

    try {
      const candles = await ctx.exchange.getCandles(normalizedSymbol, interval, periods);

      if (!candles || candles.length === 0) {
        return { error: `No candle data found for ${normalizedSymbol}` };
      }

      // Generate the candlestick chart using our custom renderer
      const chartOutput = renderCandlestickChart(candles, {
        height: 16,
        showVolume,
      });

      // Calculate stats
      const currentPrice = candles[candles.length - 1]?.close ?? 0;
      const startPrice = candles[0]?.open ?? 0;
      const highPrice = Math.max(...candles.map((c) => c.high));
      const lowPrice = Math.min(...candles.map((c) => c.low));
      const priceChange = currentPrice - startPrice;
      const priceChangePercent = startPrice > 0 ? (priceChange / startPrice) * 100 : 0;

      // Count bullish/bearish candles
      const bullishCount = candles.filter((c) => c.close >= c.open).length;
      const bearishCount = candles.length - bullishCount;

      const intervalLabel = interval === "1h" ? "hours" : interval === "4h" ? "4-hour periods" : "days";

      return {
        symbol: normalizedSymbol,
        interval,
        periods: candles.length,
        chart: `\n${normalizedSymbol} - ${interval.toUpperCase()}\n${chartOutput}\n`,
        timeRange: `Last ${candles.length} ${intervalLabel}`,
        stats: {
          current: currentPrice,
          open: startPrice,
          high: highPrice,
          low: lowPrice,
          change: priceChange,
          changePercent: `${priceChangePercent >= 0 ? "+" : ""}${priceChangePercent.toFixed(2)}%`,
        },
        sentiment: {
          bullishCandles: bullishCount,
          bearishCandles: bearishCount,
          ratio: `${((bullishCount / candles.length) * 100).toFixed(0)}% bullish`,
        },
        legend: `${COLORS.green}███ Green${COLORS.reset} = Bullish (close > open) | ${COLORS.red}░░░ Red${COLORS.reset} = Bearish (close < open)`,
      };
    } catch (error) {
      return { error: `Failed to generate candlestick chart: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// Multi-Asset Comparison Chart
// ============================================================================

export const displayComparisonChartTool = createTool({
  id: "display_comparison_chart",
  description:
    "Display multiple assets on the same chart for comparison. " +
    "Use when user wants to compare prices of multiple coins. " +
    "Normalizes prices to percentage change from start for fair comparison.",
  inputSchema: z.object({
    symbols: z
      .array(z.string())
      .min(2)
      .max(4)
      .describe("Trading pairs to compare (e.g., ['BTCUSDT', 'ETHUSDT'])"),
    interval: z
      .enum(["1h", "4h", "1d"])
      .default("1d")
      .describe("Candle interval"),
    periods: z
      .number()
      .min(7)
      .max(50)
      .default(14)
      .describe("Number of periods"),
  }),
  execute: async ({ symbols, interval, periods }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    const exchange = ctx?.exchange;
    if (!exchange) {
      return errors.noExchange;
    }

    try {
      // Fetch data for all symbols
      const symbolData = await Promise.all(
        symbols.map(async (sym) => {
          const normalizedSymbol = normalizeSymbol(sym);

          try {
            const candles = await exchange.getCandles(normalizedSymbol, interval, periods);
            if (!candles || candles.length === 0) {
              return null;
            }

            // Normalize to percentage change from first candle
            const startPrice = candles[0]?.close ?? 1;
            const changes = candles.map((c) => ((c.close - startPrice) / startPrice) * 100);
            const currentChange = changes[changes.length - 1] ?? 0;

            return {
              symbol: normalizedSymbol.replace("USDT", ""),
              changes,
              currentChange,
            };
          } catch {
            return null;
          }
        }),
      );
      const allData = symbolData.filter((item): item is { symbol: string; changes: number[]; currentChange: number } => item !== null);

      if (allData.length === 0) {
        return { error: "No data found for any of the specified symbols" };
      }

      // Generate multi-line chart
      const series = allData.map((d) => d.changes);
      const colors = [asciichart.blue, asciichart.green, asciichart.yellow, asciichart.red];

      const chart = asciichart.plot(series, {
        height: 12,
        colors: colors.slice(0, series.length),
        format: (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(1)}%`.padStart(8),
      });

      // Build legend
      const legend = allData
        .map((d, i) => {
          const colorNames = ["Blue", "Green", "Yellow", "Red"];
          const sign = d.currentChange >= 0 ? "+" : "";
          return `${colorNames[i]}: ${d.symbol} (${sign}${d.currentChange.toFixed(2)}%)`;
        })
        .join(" | ");

      const intervalLabel = interval === "1h" ? "hours" : interval === "4h" ? "4h periods" : "days";

      // Cap the rendered ASCII chart — multi-symbol comparisons at long
      // periods can blow past 6KB. The utility preserves HEAD and TAIL
      // windows so the agent still sees the start and end of the series.
      const rawChart = `\n${chart}\n`;
      const { capWithRollingWindow } = await import("../runtime/rollingWindow.ts");
      const capped = await capWithRollingWindow(rawChart, {
        label: `comparison-chart-${interval}`,
        maxChars: 4000,
        spillToDisk: false,
      });

      return {
        chart: capped.output,
        legend,
        timeRange: `Last ${periods} ${intervalLabel}`,
        note: "Y-axis shows % change from start of period",
      };
    } catch (error) {
      return { error: `Failed to generate comparison chart: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// Volume Chart Tool
// ============================================================================

export const displayVolumeChartTool = createTool({
  id: "display_volume_chart",
  description:
    "Display a volume chart alongside price. " +
    "Use when user asks about volume trends or trading activity.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair"),
    interval: z
      .enum(["1h", "4h", "1d"])
      .default("1d")
      .describe("Candle interval"),
    periods: z
      .number()
      .min(7)
      .max(50)
      .default(14)
      .describe("Number of periods"),
  }),
  execute: async ({ symbol, interval, periods }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return errors.noExchange;
    }

    const normalizedSymbol = normalizeSymbol(symbol);

    try {
      const candles = await ctx.exchange.getCandles(normalizedSymbol, interval, periods);

      if (!candles || candles.length === 0) {
        return { error: `No data found for ${normalizedSymbol}` };
      }

      const closes = candles.map((c) => c.close);
      const volumes = candles.map((c) => c.volume);

      // Normalize volume for display (scale to fit)
      const maxVol = Math.max(...volumes);
      const normalizedVolumes = volumes.map((v) => (v / maxVol) * 100);

      const priceChart = asciichart.plot(closes, {
        height: 8,
        format: (x: number) => {
          if (x >= 1000) return x.toFixed(0).padStart(8);
          if (x >= 1) return x.toFixed(2).padStart(8);
          return x.toFixed(6).padStart(8);
        },
      });

      const volumeChart = asciichart.plot(normalizedVolumes, {
        height: 4,
        format: (x: number) => `${x.toFixed(0)}%`.padStart(5),
      });

      const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
      const currentVolume = volumes[volumes.length - 1] ?? 0;
      const volumeVsAvg = ((currentVolume - avgVolume) / avgVolume) * 100;

      return {
        symbol: normalizedSymbol,
        priceChart: `Price:\n${priceChart}\n`,
        volumeChart: `Volume (relative):\n${volumeChart}\n`,
        volumeStats: {
          current: `${(currentVolume / 1000000).toFixed(2)}M`,
          average: `${(avgVolume / 1000000).toFixed(2)}M`,
          vsAverage: `${volumeVsAvg >= 0 ? "+" : ""}${volumeVsAvg.toFixed(1)}%`,
        },
      };
    } catch (error) {
      return { error: `Failed to generate volume chart: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// Export as Object (Mastra format)
// ============================================================================

/**
 * Chart tools exported as an object for Mastra Agent
 * This is the format expected by Mastra's Agent class
 */
export const chartTools = {
  display_price_chart: displayPriceChartTool,
  display_candlestick_chart: displayCandlestickChartTool,
  display_comparison_chart: displayComparisonChartTool,
  display_volume_chart: displayVolumeChartTool,
};
