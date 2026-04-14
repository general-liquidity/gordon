/**
 * String Pool — userland approximation of Claude Code's CharPool/StylePool
 *
 * Claude Code's custom Ink reconciler maintains cell-level pools: characters
 * interned to integer IDs, styles interned to pre-serialized ANSI transitions,
 * packed cells stored in Int32Arrays. That entire optimization requires
 * access to the render-tree's cell output, which vanilla Ink doesn't expose.
 *
 * What we CAN do in userland is:
 *   1. Pre-freeze and share common strings (box drawing chars, bullets,
 *      markdown separators) so JS engines can intern them and GC skips them
 *   2. Cache stable-identity React elements for reused style combinations
 *   3. Share a pre-computed "ANSI reset" sequence across components
 *   4. Hint to the JS engine via Object.freeze that these values are
 *      immutable
 *
 * The rest of the pool benefit (cell-level diff, packed memory layout,
 * zero per-frame allocation) needs an Ink fork. This module gets us maybe
 * 30% of the benefit at 0% of the cost — worth it for a trading CLI that
 * doesn't render 60fps at 200x120.
 */

// ============================================================================
// Shared immutable strings
// ============================================================================

/**
 * Unicode box drawing characters. All renderers should pull from here so
 * V8 interns the strings once and string identity comparison is pointer-
 * equal across components.
 */
export const BOX = Object.freeze({
  topLeft: "\u250C",
  topMid: "\u252C",
  topRight: "\u2510",
  midLeft: "\u251C",
  midMid: "\u253C",
  midRight: "\u2524",
  botLeft: "\u2514",
  botMid: "\u2534",
  botRight: "\u2518",
  horiz: "\u2500",
  vert: "\u2502",
  horizDouble: "\u2550",
  vertDouble: "\u2551",
});

/** Bullet characters keyed by nesting depth (clamped to length). */
export const BULLETS = Object.freeze(["\u2022", "\u25E6", "\u25AB"] as const);

/** Task list ballot characters. */
export const BALLOTS = Object.freeze({
  unchecked: "\u2610", // ☐
  checked: "\u2611",   // ☑
});

/** Thinking / progress indicator glyphs. */
export const GLYPHS = Object.freeze({
  bullet: "\u2022",
  hook: "\u231F",
  therefore: "\u2234",
  arrow: "\u2192",
  check: "\u2713",
  cross: "\u2717",
  warn: "\u26A0",
  info: "\u2139",
  star: "\u2605",
  dot: "\u00B7",
});

/** Pre-built horizontal rule strings of common widths. */
const HR_CACHE = new Map<number, string>();
export function hrLine(width: number): string {
  const cached = HR_CACHE.get(width);
  if (cached) return cached;
  const line = BOX.horiz.repeat(width);
  if (HR_CACHE.size < 64) HR_CACHE.set(width, line);
  return line;
}

// ============================================================================
// ANSI style cache
// ============================================================================

/** ANSI reset sequence — single shared constant. */
export const ANSI_RESET = "\u001b[0m";

/** Common ANSI style prefixes. */
export const ANSI = Object.freeze({
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  dim: "\u001b[2m",
  italic: "\u001b[3m",
  underline: "\u001b[4m",
  strikethrough: "\u001b[9m",
  // Foreground colors
  fgBlack: "\u001b[30m",
  fgRed: "\u001b[31m",
  fgGreen: "\u001b[32m",
  fgYellow: "\u001b[33m",
  fgBlue: "\u001b[34m",
  fgMagenta: "\u001b[35m",
  fgCyan: "\u001b[36m",
  fgWhite: "\u001b[37m",
  fgGray: "\u001b[90m",
});

// ============================================================================
// Pool stats
// ============================================================================

export function getPoolStats(): {
  hrCacheSize: number;
  hrCacheCapacity: number;
} {
  return {
    hrCacheSize: HR_CACHE.size,
    hrCacheCapacity: 64,
  };
}

export function resetPool(): void {
  HR_CACHE.clear();
}
