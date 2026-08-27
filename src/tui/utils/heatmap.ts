// ============================================================================
// Heatmap — GitHub-style activity heatmap for terminal
//
// 7 rows (Mon-Sun) x N weeks. Unicode blocks colored by value intensity.
// Percentile-based bucketing: ░ (zero), ▒ (low), ▓ (medium), █ (high).
// ============================================================================

export interface DayData {
  date: Date;
  value: number;
}

const BLOCKS = [" ", "\u2591", "\u2592", "\u2593", "\u2588"];

export function generateHeatmap(data: DayData[], weeks = 52): string[] {
  // Create a grid: 7 rows (days) x N weeks
  const grid: number[][] = Array.from({ length: 7 }, () => Array(weeks).fill(0));

  // Find the range for percentile bucketing
  const values = data.map((d) => d.value).filter((v) => v !== 0);
  const sorted = [...values].sort((a, b) => a - b);
  const p25 = sorted[Math.floor(sorted.length * 0.25)] ?? 0;
  const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
  const p75 = sorted[Math.floor(sorted.length * 0.75)] ?? 0;

  function bucket(value: number): number {
    if (value === 0) return 0;
    if (value <= p25) return 1;
    if (value <= p50) return 2;
    if (value <= p75) return 3;
    return 4;
  }

  // Fill grid from data
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay() - (weeks - 1) * 7);

  for (const item of data) {
    const diffMs = item.date.getTime() - startOfWeek.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const week = Math.floor(diffDays / 7);
    const day = diffDays % 7;
    if (week >= 0 && week < weeks && day >= 0 && day < 7) {
      grid[day]![week] = bucket(item.value);
    }
  }

  // Render as strings
  const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return grid.map((row, dayIdx) => {
    const label = dayIdx % 2 === 0 ? dayLabels[dayIdx]! : "   ";
    const cells = row.map((level) => BLOCKS[level]).join("");
    return `${label} ${cells}`;
  });
}
