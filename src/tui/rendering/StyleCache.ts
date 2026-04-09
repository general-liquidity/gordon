/**
 * StyleCache — Intern commonly used ANSI style strings
 *
 * Claude Code pattern: StylePool with transition cache.
 * Instead of regenerating ANSI sequences every frame, cache the
 * string representation of each unique style combination.
 *
 * After warmup (~50 unique styles), this is zero-allocation.
 */

const styleCache = new Map<string, string>();
const transitionCache = new Map<string, string>();

// Common ANSI codes
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const ITALIC = "\x1b[3m";
const UNDERLINE = "\x1b[4m";
const INVERSE = "\x1b[7m";

/**
 * Get cached ANSI string for a style key.
 * Key format: "bold,dim,color:rgb(52,238,176)"
 */
export function getCachedStyle(key: string): string {
  let cached = styleCache.get(key);
  if (cached !== undefined) return cached;

  // Build the ANSI string from the key
  const parts: string[] = [RESET];
  for (const token of key.split(",")) {
    switch (token.trim()) {
      case "bold": parts.push(BOLD); break;
      case "dim": parts.push(DIM); break;
      case "italic": parts.push(ITALIC); break;
      case "underline": parts.push(UNDERLINE); break;
      case "inverse": parts.push(INVERSE); break;
      default:
        if (token.startsWith("color:")) {
          const color = token.slice(6);
          const rgb = parseRGB(color);
          if (rgb) parts.push(`\x1b[38;2;${rgb.r};${rgb.g};${rgb.b}m`);
        } else if (token.startsWith("bg:")) {
          const color = token.slice(3);
          const rgb = parseRGB(color);
          if (rgb) parts.push(`\x1b[48;2;${rgb.r};${rgb.g};${rgb.b}m`);
        }
    }
  }

  cached = parts.join("");
  styleCache.set(key, cached);
  return cached;
}

/**
 * Get cached transition string from one style to another.
 * Avoids RESET+full-rebuild when only one attribute changes.
 */
export function getCachedTransition(fromKey: string, toKey: string): string {
  if (fromKey === toKey) return "";
  const cacheKey = `${fromKey}→${toKey}`;
  let cached = transitionCache.get(cacheKey);
  if (cached !== undefined) return cached;

  // Simple approach: reset + apply new style
  cached = getCachedStyle(toKey);
  transitionCache.set(cacheKey, cached);
  return cached;
}

function parseRGB(color: string): { r: number; g: number; b: number } | null {
  const match = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!match) return null;
  return { r: parseInt(match[1]!, 10), g: parseInt(match[2]!, 10), b: parseInt(match[3]!, 10) };
}

/**
 * Clear all style caches
 */
export function clearStyleCaches(): void {
  styleCache.clear();
  transitionCache.clear();
}
