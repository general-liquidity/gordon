/**
 * Line-Width Cache
 *
 * Claude Code pattern: cache string-width calculations per completed line.
 * During streaming and message-heavy rendering, the same completed lines get
 * measured over and over — header/label/row text doesn't change between
 * frames. A 4096-entry LRU cache reduces `stringWidth()` calls by ~50x.
 *
 * Also provides a fast-path ASCII width calculation that avoids the full
 * Unicode grapheme segmentation for the 95% case where strings are ASCII
 * only. Falls through to a "good enough" grapheme counter for Unicode.
 *
 * Not a full grapheme-aware implementation (no CJK double-width, no combining
 * mark handling, no emoji clusters) — we punt on those for now. Friends who
 * use Gordon in English will see correct widths; CJK / emoji users may see
 * minor table misalignment. Upgrade later if needed.
 */

const MAX_CACHE_SIZE = 4096;
const lineWidthCache = new Map<string, number>();

const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]/g;

/**
 * Fast ASCII-only string width. Returns exact width for any ASCII string
 * that doesn't contain ANSI escape sequences. Strips ANSI first, then
 * picks ASCII fast path or codepoint counting.
 */
function fastStringWidth(s: string): number {
  // Strip ANSI escape sequences first — they must never count toward
  // display width. ESC (0x1b) is < 128 so without this step the ASCII
  // fast path would count each byte of the escape sequence.
  const stripped = s.indexOf("\x1b") >= 0 ? s.replace(ANSI_RE, "") : s;

  // ASCII fast path — 95% of our content
  let asciiOnly = true;
  for (let i = 0; i < stripped.length; i++) {
    const c = stripped.charCodeAt(i);
    if (c >= 128) {
      asciiOnly = false;
      break;
    }
  }
  if (asciiOnly) return stripped.length;

  // Non-ASCII: count codepoints (not bytes) via spread — handles BMP +
  // surrogate pairs. CJK chars should be width 2 but we report 1. Good
  // enough for table alignment on English + accented text.
  return [...stripped].length;
}

/**
 * Get the display width of a line, cached. Safe to call repeatedly with
 * the same string — first call measures, subsequent calls hit the cache.
 */
export function cachedStringWidth(line: string): number {
  const cached = lineWidthCache.get(line);
  if (cached !== undefined) {
    // MRU promotion — delete and re-insert to maintain insertion order
    lineWidthCache.delete(line);
    lineWidthCache.set(line, cached);
    return cached;
  }

  const width = fastStringWidth(line);

  // LRU eviction if over cap
  if (lineWidthCache.size >= MAX_CACHE_SIZE) {
    const firstKey = lineWidthCache.keys().next().value;
    if (firstKey !== undefined) lineWidthCache.delete(firstKey);
  }
  lineWidthCache.set(line, width);
  return width;
}

/** Pad a string to a target width using cached measurement. */
export function padRightCached(text: string, width: number): string {
  const actualWidth = cachedStringWidth(text);
  if (actualWidth >= width) return text;
  return text + " ".repeat(width - actualWidth);
}

/** Clear the cache (tests + /reset). */
export function resetLineWidthCache(): void {
  lineWidthCache.clear();
}

export function getLineWidthCacheStats(): { size: number; capacity: number } {
  return { size: lineWidthCache.size, capacity: MAX_CACHE_SIZE };
}
