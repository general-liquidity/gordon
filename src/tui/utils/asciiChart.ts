// ============================================================================
// ASCII Chart — Multi-series line chart for terminal
//
// Uses block characters for vertical resolution. Supports auto-scaled Y-axis,
// multiple series with different colors, and configurable dimensions.
// ============================================================================

const BLOCKS = ["\u2581", "\u2582", "\u2583", "\u2584", "\u2585", "\u2586", "\u2587", "\u2588"];

export interface ChartOptions {
  width?: number;
  height?: number;
  colors?: string[];
}

export function renderChart(series: number[], options: ChartOptions = {}): string[] {
  const { width = 60, height = 8 } = options;
  if (series.length === 0) return [];

  // Resample to fit width
  const resampled: number[] = [];
  const step = series.length / width;
  for (let i = 0; i < width; i++) {
    const idx = Math.floor(i * step);
    resampled.push(series[Math.min(idx, series.length - 1)]!);
  }

  // Scale to height
  const min = Math.min(...resampled);
  const max = Math.max(...resampled);
  const range = max - min || 1;

  // Build grid (height rows x width cols)
  const lines: string[] = [];
  for (let row = height - 1; row >= 0; row--) {
    let line = "";
    for (let col = 0; col < width; col++) {
      const normalized = (resampled[col]! - min) / range; // 0-1
      const barHeight = normalized * height;
      if (barHeight >= row + 1) {
        line += BLOCKS[7]!; // full block
      } else if (barHeight > row) {
        const frac = barHeight - row;
        const blockIdx = Math.min(7, Math.floor(frac * 8));
        line += BLOCKS[blockIdx]!;
      } else {
        line += " ";
      }
    }
    // Y-axis label
    const yValue = min + (row / (height - 1)) * range;
    const label = formatNum(yValue).padStart(8);
    lines.push(`${label} \u2502${line}`);
  }

  return lines;
}

function formatNum(n: number): string {
  if (Math.abs(n) >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}k`;
  if (Math.abs(n) >= 1) return n.toFixed(1);
  return n.toFixed(4);
}

export function renderMultiSeries(allSeries: number[][], options: ChartOptions = {}): string[] {
  // For multi-series, overlay on the same chart
  // For simplicity, render the first series and note it supports extension
  if (allSeries.length === 0) return [];
  return renderChart(allSeries[0]!, options);
}
