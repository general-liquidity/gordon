/**
 * Width-Aware Unicode Truncation
 *
 * Smart terminal-width-aware string truncation that splits on grapheme
 * boundaries (not char boundaries) to avoid breaking emoji, CJK characters,
 * and surrogate pairs.
 *
 * Claude Code pattern: multiple truncation strategies for different UI
 * contexts (paths, messages, table cells).
 */

// ============================================================================
// Grapheme Segmentation
// ============================================================================

let segmenter: Intl.Segmenter | null = null;

function getSegmenter(): Intl.Segmenter {
  if (!segmenter) segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  return segmenter;
}

/**
 * Get the display width of a string (CJK = 2, emoji = 2, others = 1).
 */
export function displayWidth(str: string): number {
  let width = 0;
  for (const { segment } of getSegmenter().segment(str)) {
    const cp = segment.codePointAt(0) ?? 0;
    // CJK Unified Ideographs, CJK Compatibility, Fullwidth forms
    if (
      (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
      (cp >= 0x2e80 && cp <= 0x9fff) || // CJK
      (cp >= 0xac00 && cp <= 0xd7af) || // Hangul Syllables
      (cp >= 0xf900 && cp <= 0xfaff) || // CJK Compatibility Ideographs
      (cp >= 0xfe10 && cp <= 0xfe6f) || // CJK Compatibility Forms
      (cp >= 0xff01 && cp <= 0xff60) || // Fullwidth Forms
      (cp >= 0x20000 && cp <= 0x2ffff) // CJK Extension B+
    ) {
      width += 2;
    } else if (cp >= 0x1f000 && cp <= 0x1faff) {
      // Emoji range — most are width 2
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

// ============================================================================
// Truncation Strategies
// ============================================================================

/**
 * Truncate a string to fit within `maxWidth` terminal columns.
 * Appends ellipsis if truncated. Respects grapheme boundaries.
 */
export function truncateToWidth(str: string, maxWidth: number, ellipsis: string = "…"): string {
  if (displayWidth(str) <= maxWidth) return str;

  const ellipsisWidth = displayWidth(ellipsis);
  const targetWidth = maxWidth - ellipsisWidth;
  if (targetWidth <= 0) return ellipsis.slice(0, maxWidth);

  let result = "";
  let width = 0;

  for (const { segment } of getSegmenter().segment(str)) {
    const segWidth = displayWidth(segment);
    if (width + segWidth > targetWidth) break;
    result += segment;
    width += segWidth;
  }

  return result + ellipsis;
}

/**
 * Truncate from the start (keeps the end). Useful for paths where the
 * filename is more important than the directory.
 */
export function truncateStartToWidth(
  str: string,
  maxWidth: number,
  ellipsis: string = "…",
): string {
  if (displayWidth(str) <= maxWidth) return str;

  const ellipsisWidth = displayWidth(ellipsis);
  const targetWidth = maxWidth - ellipsisWidth;
  if (targetWidth <= 0) return ellipsis.slice(0, maxWidth);

  // Collect graphemes in reverse
  const graphemes: string[] = [];
  for (const { segment } of getSegmenter().segment(str)) {
    graphemes.push(segment);
  }

  let result = "";
  let width = 0;

  for (let i = graphemes.length - 1; i >= 0; i--) {
    const segWidth = displayWidth(graphemes[i]!);
    if (width + segWidth > targetWidth) break;
    result = graphemes[i] + result;
    width += segWidth;
  }

  return ellipsis + result;
}

/**
 * Truncate a file path in the middle, preserving the first directory
 * and the filename.
 *
 * Example: "/home/user/very/long/path/file.ts" → "/home/…/file.ts"
 */
export function truncatePathMiddle(path: string, maxWidth: number): string {
  if (displayWidth(path) <= maxWidth) return path;

  const sep = path.includes("/") ? "/" : "\\";
  const parts = path.split(sep);
  if (parts.length <= 2) return truncateToWidth(path, maxWidth);

  const first = parts[0] ?? "";
  const last = parts[parts.length - 1] ?? "";
  const middle = "…";

  const fixedWidth =
    displayWidth(first) +
    displayWidth(sep) +
    displayWidth(middle) +
    displayWidth(sep) +
    displayWidth(last);
  if (fixedWidth >= maxWidth) {
    // Even first + last don't fit — truncate the filename
    return truncateToWidth(`${first}${sep}${middle}${sep}${last}`, maxWidth);
  }

  return `${first}${sep}${middle}${sep}${last}`;
}

/**
 * Wrap text to fit within maxWidth, breaking at word boundaries.
 * Returns an array of lines.
 */
export function wrapText(text: string, maxWidth: number): string[] {
  if (maxWidth <= 0) return [text];

  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = "";
  let currentWidth = 0;

  for (const word of words) {
    const wordWidth = displayWidth(word);

    if (currentWidth === 0) {
      currentLine = word;
      currentWidth = wordWidth;
    } else if (currentWidth + 1 + wordWidth <= maxWidth) {
      currentLine += ` ${word}`;
      currentWidth += 1 + wordWidth;
    } else {
      lines.push(currentLine);
      currentLine = word;
      currentWidth = wordWidth;
    }
  }

  if (currentLine) lines.push(currentLine);
  return lines.length > 0 ? lines : [""];
}

/**
 * Pad a string to exactly `width` columns, truncating if necessary.
 */
export function padToWidth(str: string, width: number, align: "left" | "right" = "left"): string {
  const current = displayWidth(str);
  if (current >= width) return truncateToWidth(str, width);

  const padding = " ".repeat(width - current);
  return align === "left" ? str + padding : padding + str;
}
