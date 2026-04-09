/**
 * StringWidthCache — Memoized string width calculations
 *
 * Claude Code pattern: cache stringWidth results per line (4096 cap).
 * During streaming, completed lines are immutable — their width
 * never needs recalculating. Only the current line changes.
 */

// Use Bun's native stringWidth if available (fast path)
const bunStringWidth = typeof globalThis.Bun !== "undefined" && typeof (globalThis.Bun as any).stringWidth === "function"
  ? (str: string) => (globalThis.Bun as any).stringWidth(str, { ambiguousIsNarrow: true }) as number
  : null;

const cache = new Map<string, number>();
const MAX_CACHE = 4096;

/**
 * Get the visual width of a string in terminal columns.
 * Results are cached per unique string.
 */
export function cachedStringWidth(str: string): number {
  let width = cache.get(str);
  if (width !== undefined) return width;

  if (bunStringWidth) {
    width = bunStringWidth(str);
  } else {
    // Fallback: count characters, assuming monospace
    // Strip ANSI escape sequences
    const stripped = str.replace(/\x1b\[[0-9;]*m/g, "");
    width = stripped.length;
  }

  // LRU eviction
  if (cache.size >= MAX_CACHE) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(str, width);

  return width;
}

/**
 * Clear the width cache (e.g., on terminal resize)
 */
export function clearStringWidthCache(): void {
  cache.clear();
}
