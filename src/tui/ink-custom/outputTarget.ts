// outputTarget — CellBuffer-backed paint target for renderNodeToOutput.
//
// Status: Phase 1+ (behind GORDON_CUSTOM_RENDER flag). Replaces Ink's
// Output class. Responsibilities:
//   * Accept `write(x, y, text, { transformers })` calls from render-node-
//     to-output, where `text` may contain ANSI SGR sequences and newlines.
//   * Tokenize the text into styled characters (via @alcalzone/ansi-tokenize),
//     apply transformers, and paint each character into the backing
//     CellBuffer by interning its glyph + style through the char/style pools.
//   * Preserve Ink's clip() / unclip() stack so `overflow: hidden` still
//     works — implemented with the same heuristic as Ink's Output.get().
//   * Expose `toAnsiString()` for a simple fallback path that doesn't need
//     the PatchEmitter (useful for first-paint + debug/CI).

import sliceAnsi from "./sliceAnsi.ts";
import stringWidth from "string-width";
import widestLine from "widest-line";
import {
  styledCharsFromTokens,
  tokenize,
  type AnsiCode,
  type StyledChar,
} from "@alcalzone/ansi-tokenize";
import type {
  CellBuffer,
  CellWidth,
  CharPool,
  HyperlinkPool,
  StylePool,
} from "./internal/contracts.ts";

// ============================================================================
// OSC 8 hyperlink detection
// ============================================================================
//
// @alcalzone/ansi-tokenize parses OSC 8 sequences as `ansi` tokens and
// attaches them to the `styles` array of subsequent StyledChars. The
// reducer (`reduceAnsiCodesIncremental`) keeps the latest link code as a
// style until another link code (including the URL-less closer
// `\x1b]8;;\x07`) replaces it. That means:
//   * `\x1b]8;;https://foo\x07` → an "open" style carrying the URL
//   * `\x1b]8;;\x07`            → an explicit "closer" style (empty URL)
//   * Chars following a closer still carry the closer in their styles[]
//     until another link code replaces it.
//
// To thread hyperlinks into the paint pipeline we must:
//   1. Identify link opens and closes on each StyledChar.
//   2. For opens, intern the URL into HyperlinkPool and record the
//      resulting ID in a side table keyed by (x + y*width).
//   3. Filter OSC 8 codes out of the style string that goes into StylePool
//      so styleId stays stable across URL variations (otherwise every URL
//      spawns a unique style and the pool saturates).

const LINK_START_PREFIX = "\x1b]8;;";
const LINK_CLOSE_CODE = "\x1b]8;;\x07";

/** Returns true if the AnsiCode is an OSC 8 hyperlink open/close. */
function isLinkCode(code: AnsiCode): boolean {
  return code.code.startsWith(LINK_START_PREFIX);
}

/**
 * Given a StyledChar's styles array, return the URL to apply to the cell
 * (or `null` if the char is not part of a hyperlink run). The explicit
 * closer `\x1b]8;;\x07` also yields `null` — it marks the end of the run.
 *
 * We scan right-to-left so the most recently applied link code wins.
 */
function extractHyperlinkUrl(styles: readonly AnsiCode[]): string | null {
  for (let i = styles.length - 1; i >= 0; i--) {
    const s = styles[i];
    if (!s || !isLinkCode(s)) continue;
    if (s.code === LINK_CLOSE_CODE) return null;
    // Extract the URL between "\x1b]8;;" and the trailing "\x07".
    const url = s.code.slice(LINK_START_PREFIX.length, s.code.length - 1);
    return url.length > 0 ? url : null;
  }
  return null;
}

/** Returns the styles[] with all OSC 8 link codes removed. */
function stripLinkStyles(styles: readonly AnsiCode[]): AnsiCode[] {
  // Fast path: no link codes present, return the original array.
  let hasLink = false;
  for (const s of styles) {
    if (isLinkCode(s)) {
      hasLink = true;
      break;
    }
  }
  if (!hasLink) return styles as AnsiCode[];
  return styles.filter((s) => !isLinkCode(s));
}

// ============================================================================
// Operations accumulated during a render pass
// ============================================================================

type WriteOp = {
  type: "write";
  x: number;
  y: number;
  text: string;
  transformers: Array<(s: string, i: number) => string>;
};

type ClipOp = {
  type: "clip";
  clip: { x1?: number; x2?: number; y1?: number; y2?: number };
};

type UnclipOp = { type: "unclip" };

type Operation = WriteOp | ClipOp | UnclipOp;

// ============================================================================
// OutputTarget interface (mirrors Ink's Output.write/clip/unclip)
// ============================================================================

export interface OutputTarget {
  readonly width: number;
  readonly height: number;
  write(
    x: number,
    y: number,
    text: string,
    options: { transformers: Array<(s: string, i: number) => string> },
  ): void;
  clip(clip: { x1?: number; x2?: number; y1?: number; y2?: number }): void;
  unclip(): void;
  /**
   * Flush accumulated operations into the supplied CellBuffer. When a
   * HyperlinkPool is provided, OSC 8 URLs embedded in painted text are
   * interned and the resulting IDs are stored in the OutputTarget's cell-
   * level side table (query via `getHyperlinkAt(x, y)`). When omitted,
   * OSC 8 codes fall through the style path unchanged (the legacy
   * inline-passthrough behavior) — existing tests and callers that don't
   * yet thread a pool continue to work.
   */
  paintInto(
    buffer: CellBuffer,
    charPool: CharPool,
    stylePool: StylePool,
    hyperlinkPool?: HyperlinkPool,
  ): void;
  /**
   * Flush accumulated operations into a plain ANSI string. When a
   * HyperlinkPool is provided, consecutive cells sharing the same
   * hyperlink ID are wrapped with a single `\x1b]8;;URL\x07` open /
   * `\x1b]8;;\x07` close pair instead of being repeated per cell — the
   * correct, terminal-friendly emission shape.
   */
  toAnsiString(hyperlinkPool?: HyperlinkPool): string;
  /**
   * Returns the hyperlink ID painted at the given cell, or `null` if that
   * cell is not part of a hyperlink run. Lookups require a prior
   * `paintInto()` call with a HyperlinkPool; otherwise returns `null`.
   */
  getHyperlinkAt(x: number, y: number): number | null;
}

// Small styled-char cache — same idea as Ink's patched output.js cache. We
// key by the line text so repeated lines (borders etc.) tokenize once.
const styledCharCache = new Map<string, StyledChar[]>();
const MAX_CACHE_ENTRIES = 4096;

function cacheStyledChars(line: string): StyledChar[] {
  const cached = styledCharCache.get(line);
  if (cached) return cached;
  const tokens = tokenize(line);
  const chars = styledCharsFromTokens(tokens);
  styledCharCache.set(line, chars);
  if (styledCharCache.size > MAX_CACHE_ENTRIES) styledCharCache.clear();
  return chars;
}

function styledCharToAnsi(character: StyledChar): string {
  // Serialize a StyledChar's opening SGR codes into a single string.
  // Close codes are NOT stored — AnsiPatcher emits SGR_RESET between style
  // changes and at end-of-frame, which is simpler and cheaper than tracking
  // per-style closers.
  //
  // OSC 8 link codes are serialized inline here as a fallback. When a
  // HyperlinkPool is threaded through paintInto/toAnsiString, link codes
  // are stripped from the style string and emitted via the side-table
  // pipeline instead — keeping the StylePool free of URL-specific entries
  // and producing properly-bounded open/close runs in the output.
  return character.styles.map((s) => s.code).join("");
}

/**
 * Same as `styledCharToAnsi` but with OSC 8 link codes removed. Used when
 * paintInto() has a HyperlinkPool — the link metadata is carried in the
 * cell-level side table and wrapped around full runs in toAnsiString(),
 * so the style string fed into StylePool must not include URLs.
 */
function styledCharToAnsiNoLinks(character: StyledChar): string {
  const stripped = stripLinkStyles(character.styles);
  if (stripped.length === character.styles.length) {
    // No link codes to strip — reuse the existing serializer.
    return styledCharToAnsi(character);
  }
  return stripped.map((s) => s.code).join("");
}

export function createOutputTarget(width: number, height: number): OutputTarget {
  const operations: Operation[] = [];

  // Cell-level hyperlink side table. Keyed by `y * width + x`. Populated
  // during paintInto() when a HyperlinkPool is supplied; read back via
  // getHyperlinkAt() and consumed inside toAnsiString() to wrap runs of
  // contiguous same-ID cells with a single OSC 8 open/close pair.
  //
  // A side table is used because the packed 32-bit cell layout has no
  // spare bits for a hyperlink ID (20 char + 8 style + 2 width + 1 dirty
  // + 1 reserved = 32 — the reserved bit is already earmarked for other
  // reconciler needs). Paying a Map lookup per hyperlink cell is cheap
  // compared to repainting a full frame.
  const hyperlinkMap = new Map<number, number>();
  const hyperlinkKey = (x: number, y: number): number => y * width + x;

  const target: OutputTarget = {
    width,
    height,

    write(x, y, text, options) {
      if (!text) return;
      operations.push({ type: "write", x, y, text, transformers: options.transformers });
    },

    clip(clip) {
      operations.push({ type: "clip", clip });
    },

    unclip() {
      operations.push({ type: "unclip" });
    },

    getHyperlinkAt(x, y) {
      const id = hyperlinkMap.get(hyperlinkKey(x, y));
      return id === undefined ? null : id;
    },

    paintInto(buffer, charPool, stylePool, hyperlinkPool) {
      // Intern empty-cell base so we have a canonical default.
      const blankCharId = charPool.intern(" ");
      const baseStyleId = stylePool.intern("");

      // Reset the hyperlink side table at the start of each paint pass so
      // stale entries from a previous frame don't survive.
      hyperlinkMap.clear();

      // Select the style serializer: when a pool is provided we strip OSC
      // 8 codes (link metadata lives in the side table instead); otherwise
      // preserve the legacy inline passthrough.
      const toAnsi = hyperlinkPool ? styledCharToAnsiNoLinks : styledCharToAnsi;

      // Initialize: pre-fill the whole viewport with blanks so residual
      // painted cells from the previous frame don't leak. Caller may choose
      // to clear the buffer before paintInto() — we still fill explicitly.
      for (let y = 0; y < Math.min(height, buffer.height); y++) {
        for (let x = 0; x < Math.min(width, buffer.width); x++) {
          buffer.set(x, y, blankCharId, baseStyleId, 1);
        }
      }

      const clips: Array<ClipOp["clip"]> = [];

      for (const op of operations) {
        if (op.type === "clip") {
          clips.push(op.clip);
          continue;
        }
        if (op.type === "unclip") {
          clips.pop();
          continue;
        }

        let { x, y } = op;
        const { text, transformers } = op;
        let lines = text.split("\n");
        const clip = clips.at(-1);

        if (clip) {
          const clipH = typeof clip.x1 === "number" && typeof clip.x2 === "number";
          const clipV = typeof clip.y1 === "number" && typeof clip.y2 === "number";

          if (clipH) {
            const w = widestLine(text);
            if (x + w < clip.x1! || x > clip.x2!) continue;
          }
          if (clipV) {
            const h = lines.length;
            if (y + h < clip.y1! || y > clip.y2!) continue;
          }

          if (clipH) {
            lines = lines.map((line) => {
              const from = x < clip.x1! ? clip.x1! - x : 0;
              const w = stringWidth(line);
              const to = x + w > clip.x2! ? clip.x2! - x : w;
              return sliceAnsi(line, from, to);
            });
            if (x < clip.x1!) x = clip.x1!;
          }
          if (clipV) {
            const from = y < clip.y1! ? clip.y1! - y : 0;
            const h = lines.length;
            const to = y + h > clip.y2! ? clip.y2! - y : h;
            lines = lines.slice(from, to);
            if (y < clip.y1!) y = clip.y1!;
          }
        }

        let offsetY = 0;
        for (let index = 0; index < lines.length; index++) {
          let line = lines[index]!;
          const targetY = y + offsetY;
          if (targetY < 0 || targetY >= buffer.height) {
            offsetY++;
            continue;
          }
          for (const t of transformers) {
            line = t(line, index);
          }
          const characters = cacheStyledChars(line);
          let offsetX = x;
          for (const ch of characters) {
            if (offsetX >= buffer.width) break;
            if (offsetX < 0) {
              // Advance by visual width, keep counting for correctness even
              // though we can't paint yet.
              const skipWidth = Math.max(1, stringWidth(ch.value));
              offsetX += skipWidth;
              continue;
            }
            const visualWidth = Math.max(1, stringWidth(ch.value));
            const styleId = stylePool.intern(toAnsi(ch));
            const charId = charPool.intern(ch.value);
            const widthBits: CellWidth = visualWidth > 1 ? 1 : 1;
            buffer.set(offsetX, targetY, charId, styleId, widthBits);
            if (visualWidth > 1) {
              // Clear trailing half-cell so nothing leaks from previous paint.
              for (let k = 1; k < visualWidth; k++) {
                if (offsetX + k >= buffer.width) break;
                buffer.set(offsetX + k, targetY, blankCharId, styleId, 1);
              }
            }
            // Side-table hyperlink record. Only runs when the caller
            // threaded a HyperlinkPool; record each cell of a multi-cell
            // glyph so wrapping logic in toAnsiString handles double-width
            // chars without losing the link boundary.
            if (hyperlinkPool) {
              const url = extractHyperlinkUrl(ch.styles);
              if (url !== null) {
                const id = hyperlinkPool.intern(url);
                for (let k = 0; k < visualWidth; k++) {
                  if (offsetX + k >= buffer.width) break;
                  hyperlinkMap.set(hyperlinkKey(offsetX + k, targetY), id);
                }
              }
            }
            offsetX += visualWidth;
          }
          offsetY++;
        }
      }
    },

    toAnsiString(hyperlinkPool) {
      // Build a plain styled-char grid identical to Ink's Output.get() then
      // serialize row-by-row. Used as a fallback when the pipeline runs
      // without the PatchEmitter (first paint, debug mode).
      const output: StyledChar[][] = [];
      for (let y = 0; y < height; y++) {
        const row: StyledChar[] = [];
        for (let x = 0; x < width; x++) {
          row.push({ type: "char", value: " ", fullWidth: false, styles: [] });
        }
        output.push(row);
      }

      // Parallel grid of hyperlink IDs. `0` means "no link". Only populated
      // when a HyperlinkPool is provided AND the inbound text carries OSC
      // 8 codes — blank cells and non-link chars stay 0 and generate no
      // OSC 8 sequences in the emitted string.
      const linkGrid: Uint32Array | null = hyperlinkPool
        ? new Uint32Array(width * height)
        : null;

      const clips: Array<ClipOp["clip"]> = [];
      for (const op of operations) {
        if (op.type === "clip") {
          clips.push(op.clip);
          continue;
        }
        if (op.type === "unclip") {
          clips.pop();
          continue;
        }

        let { x, y } = op;
        const { text, transformers } = op;
        let lines = text.split("\n");
        const clip = clips.at(-1);

        if (clip) {
          const clipH = typeof clip.x1 === "number" && typeof clip.x2 === "number";
          const clipV = typeof clip.y1 === "number" && typeof clip.y2 === "number";
          if (clipH) {
            const w = widestLine(text);
            if (x + w < clip.x1! || x > clip.x2!) continue;
          }
          if (clipV) {
            const h = lines.length;
            if (y + h < clip.y1! || y > clip.y2!) continue;
          }
          if (clipH) {
            lines = lines.map((line) => {
              const from = x < clip.x1! ? clip.x1! - x : 0;
              const w = stringWidth(line);
              const to = x + w > clip.x2! ? clip.x2! - x : w;
              return sliceAnsi(line, from, to);
            });
            if (x < clip.x1!) x = clip.x1!;
          }
          if (clipV) {
            const from = y < clip.y1! ? clip.y1! - y : 0;
            const h = lines.length;
            const to = y + h > clip.y2! ? clip.y2! - y : h;
            lines = lines.slice(from, to);
            if (y < clip.y1!) y = clip.y1!;
          }
        }

        let offsetY = 0;
        for (let index = 0; index < lines.length; index++) {
          let line = lines[index]!;
          const row = output[y + offsetY];
          if (!row) {
            offsetY++;
            continue;
          }
          for (const t of transformers) {
            line = t(line, index);
          }
          const characters = cacheStyledChars(line);
          let offsetX = x;
          const targetRowY = y + offsetY;
          for (const ch of characters) {
            // When a HyperlinkPool is provided, strip OSC 8 codes from the
            // grid's styles[] (to avoid per-cell OSC 8 emission in the
            // serializer) and record the URL in linkGrid instead.
            let cellForGrid: StyledChar = ch;
            let cellUrl: string | null = null;
            if (linkGrid && hyperlinkPool) {
              cellUrl = extractHyperlinkUrl(ch.styles);
              const stripped = stripLinkStyles(ch.styles);
              if (stripped.length !== ch.styles.length) {
                cellForGrid = {
                  type: "char",
                  value: ch.value,
                  fullWidth: ch.fullWidth,
                  styles: stripped,
                };
              }
            }
            if (offsetX >= 0 && offsetX < row.length) {
              row[offsetX] = cellForGrid;
              if (linkGrid && cellUrl !== null) {
                const id = hyperlinkPool!.intern(cellUrl);
                linkGrid[targetRowY * width + offsetX] = id;
              }
            }
            const visualWidth = Math.max(1, stringWidth(ch.value));
            if (visualWidth > 1) {
              for (let k = 1; k < visualWidth; k++) {
                if (offsetX + k >= 0 && offsetX + k < row.length) {
                  row[offsetX + k] = {
                    type: "char",
                    value: "",
                    fullWidth: false,
                    styles: cellForGrid.styles,
                  };
                  if (linkGrid && cellUrl !== null) {
                    const id = hyperlinkPool!.intern(cellUrl);
                    linkGrid[targetRowY * width + (offsetX + k)] = id;
                  }
                }
              }
            }
            offsetX += visualWidth;
          }
          offsetY++;
        }
      }

      const rowStrings = output.map((row, rowY) => {
        let out = "";
        // Track active hyperlink ID across cells in the row so we emit
        // `\x1b]8;;URL\x07` when entering a link run and `\x1b]8;;\x07` when
        // leaving it — rather than per-cell (which bloats the output and
        // confuses some terminals). Row boundaries auto-close.
        let activeLinkId = 0;
        for (let colX = 0; colX < row.length; colX++) {
          const ch = row[colX]!;
          const newLinkId = linkGrid ? linkGrid[rowY * width + colX] ?? 0 : 0;
          if (newLinkId !== activeLinkId) {
            if (activeLinkId !== 0) out += LINK_CLOSE_CODE;
            if (newLinkId !== 0 && hyperlinkPool) {
              const url = hyperlinkPool.get(newLinkId);
              if (url !== undefined) {
                out += `${LINK_START_PREFIX}${url}\x07`;
              }
            }
            activeLinkId = newLinkId;
          }
          for (const s of ch.styles) out += s.code;
          out += ch.value;
          for (let i = ch.styles.length - 1; i >= 0; i--) {
            const st = ch.styles[i];
            if (st) out += st.endCode;
          }
        }
        // Close any open link at end of row.
        if (activeLinkId !== 0) out += LINK_CLOSE_CODE;
        return out.replace(/\s+$/u, "");
      });
      return rowStrings.join("\n");
    },
  };

  return target;
}
