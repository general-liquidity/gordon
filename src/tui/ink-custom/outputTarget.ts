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

import sliceAnsi from "slice-ansi";
import stringWidth from "string-width";
import widestLine from "widest-line";
import {
  styledCharsFromTokens,
  tokenize,
  type StyledChar,
} from "@alcalzone/ansi-tokenize";
import type {
  CellBuffer,
  CellWidth,
  CharPool,
  StylePool,
} from "./internal/contracts.ts";

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
  /** Flush accumulated operations into the supplied CellBuffer. */
  paintInto(buffer: CellBuffer, charPool: CharPool, stylePool: StylePool): void;
  /** Flush accumulated operations into a plain ANSI string. */
  toAnsiString(): string;
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
  return character.styles.map((s) => s.code).join("");
}

export function createOutputTarget(width: number, height: number): OutputTarget {
  const operations: Operation[] = [];

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

    paintInto(buffer, charPool, stylePool) {
      // Intern empty-cell base so we have a canonical default.
      const blankCharId = charPool.intern(" ");
      const baseStyleId = stylePool.intern("");

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
            const styleId = stylePool.intern(styledCharToAnsi(ch));
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
            offsetX += visualWidth;
          }
          offsetY++;
        }
      }
    },

    toAnsiString() {
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
          for (const ch of characters) {
            if (offsetX >= 0 && offsetX < row.length) {
              row[offsetX] = ch;
            }
            const visualWidth = Math.max(1, stringWidth(ch.value));
            if (visualWidth > 1) {
              for (let k = 1; k < visualWidth; k++) {
                if (offsetX + k >= 0 && offsetX + k < row.length) {
                  row[offsetX + k] = {
                    type: "char",
                    value: "",
                    fullWidth: false,
                    styles: ch.styles,
                  };
                }
              }
            }
            offsetX += visualWidth;
          }
          offsetY++;
        }
      }

      const rowStrings = output.map((row) => {
        let out = "";
        for (const ch of row) {
          for (const s of ch.styles) out += s.code;
          out += ch.value;
          for (let i = ch.styles.length - 1; i >= 0; i--) {
            const st = ch.styles[i];
            if (st) out += st.endCode;
          }
        }
        return out.replace(/\s+$/u, "");
      });
      return rowStrings.join("\n");
    },
  };

  return target;
}
