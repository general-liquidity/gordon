// renderPipeline — Phase 2 diff + ANSI serialization glue.
//
// Active in customRender. Exposes two factory functions that together turn a
// pair of cell buffers into a single ANSI string ready for
// `process.stdout.write()`:
//
//   * `createPatchEmitter()` — produces a `PatchEmitter` that walks two
//     `CellBuffer` Int32Array views, compares them cell by cell, and emits
//     a merged `Patch[]`. If a caller has a faster Phase 1 diff available
//     (e.g. `./cellDiff.ts`), they can pass it in and this module will
//     delegate. The default naive path exists so this module typechecks
//     and runs end-to-end independently of Phase 1's internals.
//   * `createAnsiPatcher()` — produces an `AnsiPatcher` that sorts patches
//     by (row, col), groups consecutive patches, and emits cursor-move +
//     style-change + content, finishing with an SGR reset when any style
//     was applied. This is the hot path on every frame, so the
//     implementation is deliberately small and loop-local: a single
//     forward pass over the sorted patch array, one `String` concatenation
//     per segment.
//
// ANSI notes:
//   * Cursor move uses `CSI row ; col H` (CUP). Both row and column are
//     1-indexed in CUP, so a patch at (y=0, x=0) emits `\x1b[1;1H`. A patch
//     at (y=5, x=3) emits `\x1b[6;4H`.
//   * Style sequences are looked up through `stylePool.get(styleId)` and
//     emitted only when the styleId changes. The reset `\x1b[0m` is emitted
//     exactly once at the end if any style was written, so downstream
//     output is not left in a colored state.

import type {
  AnsiPatcher,
  CellBuffer,
  CharPool,
  Patch,
  PatchEmitter,
  StylePool,
} from "./internal/contracts.ts";
import {
  CELL_CHAR_MASK,
  CELL_STYLE_MASK,
  CELL_STYLE_SHIFT,
  CELL_WIDTH_MASK,
  CELL_WIDTH_SHIFT,
} from "./internal/contracts.ts";

/** Optional pluggable diff — lets callers supply a tuned Phase 1
 *  implementation (e.g. `./cellDiff.ts#diffCells`) without this module
 *  having to know about it at import time. */
export type DiffFn = (
  prev: CellBuffer,
  curr: CellBuffer,
  stylePool: StylePool,
  charPool: CharPool,
) => Patch[];

/**
 * Build a `PatchEmitter`. If a `diffFn` is supplied it is used verbatim;
 * otherwise a small built-in comparison walks `curr.raw()` / `prev.raw()`
 * and produces merged runs.
 */
export function createPatchEmitter(diffFn?: DiffFn): PatchEmitter {
  if (diffFn) {
    return { diff: diffFn };
  }
  return { diff: naiveDiff };
}

/**
 * Baseline cell diff. Compares packed Int32 cells directly: identical ints
 * mean identical (char, style, width) — no lookup needed. When cells
 * differ, the new cell is decoded via the char/style pools and merged into
 * a growing run on the current row as long as the styleId stays constant.
 */
function naiveDiff(
  prev: CellBuffer,
  curr: CellBuffer,
  stylePool: StylePool,
  charPool: CharPool,
): Patch[] {
  const w = curr.width;
  const h = curr.height;
  if (prev.width !== w || prev.height !== h) {
    throw new Error(
      `naiveDiff: buffer size mismatch prev=${prev.width}x${prev.height} curr=${w}x${h}`,
    );
  }
  const a = prev.raw();
  const b = curr.raw();

  const patches: Patch[] = [];
  // Keep the in-progress run so we can merge adjacent changed cells that
  // share a styleId — the common case when a whole word flips color.
  let runY = -1;
  let runX = -1;
  let runStyleId = -1;
  let runContent = "";
  let runVisualWidth = 0;
  let runNextX = -1;

  const flush = (): void => {
    if (runY !== -1) {
      patches.push({
        x: runX,
        y: runY,
        content: runContent,
        visualWidth: runVisualWidth,
        styleId: runStyleId,
      });
      runY = -1;
      runX = -1;
      runStyleId = -1;
      runContent = "";
      runVisualWidth = 0;
      runNextX = -1;
    }
  };

  for (let y = 0; y < h; y++) {
    const rowBase = y * w;
    for (let x = 0; x < w; x++) {
      const prevCell = a[rowBase + x] ?? 0;
      const currCell = b[rowBase + x] ?? 0;
      if (prevCell === currCell) {
        flush();
        continue;
      }
      const charIdx = currCell & CELL_CHAR_MASK;
      const styleId = (currCell >>> CELL_STYLE_SHIFT) & CELL_STYLE_MASK;
      const widthBits = (currCell >>> CELL_WIDTH_SHIFT) & CELL_WIDTH_MASK;
      const cellVisualWidth =
        widthBits === 1 ? 2 : widthBits === 2 ? 0 : 1;
      const content = charPool.get(charIdx) ?? "";
      if (runY === y && runNextX === x && runStyleId === styleId) {
        runContent += content;
        runVisualWidth += cellVisualWidth;
        runNextX = x + Math.max(cellVisualWidth, 1);
      } else {
        flush();
        runY = y;
        runX = x;
        runStyleId = styleId;
        runContent = content;
        runVisualWidth = cellVisualWidth;
        runNextX = x + Math.max(cellVisualWidth, 1);
      }
    }
    flush();
  }
  flush();
  // `stylePool` is part of the signature so callers can rely on it without
  // a special case; the naive path doesn't need it because `AnsiPatcher`
  // is the one that resolves styleId → ANSI. Swallow the unused binding.
  void stylePool;
  return patches;
}

const CSI = "\x1b[";
const SGR_RESET = "\x1b[0m";

/**
 * Build an `AnsiPatcher`. The returned instance is stateless so it can be
 * safely reused across frames and threads (well — single-threaded JS, but
 * the point is there is no per-frame setup cost).
 */
export function createAnsiPatcher(): AnsiPatcher {
  return {
    write(
      patches: readonly Patch[],
      stylePool: StylePool,
      charPool: CharPool,
    ): string {
      if (patches.length === 0) return "";

      // Sort by (y, x). Copy first — `patches` is readonly on the type.
      const sorted = patches.slice().sort((p, q) => {
        if (p.y !== q.y) return p.y - q.y;
        return p.x - q.x;
      });

      let out = "";
      let lastY = -1;
      let lastX = -1;
      let lastStyleId = -1;
      let styleUsed = false;

      for (let i = 0; i < sorted.length; i++) {
        const patch = sorted[i]!;
        // Cursor move on row boundary, or when this patch is not the next
        // cell on the current row (gap or out-of-order).
        if (patch.y !== lastY || patch.x !== lastX) {
          out += CSI + (patch.y + 1) + ";" + (patch.x + 1) + "H";
        }
        // Style change. `styleId === -1` means neutral — no SGR emitted.
        if (patch.styleId >= 0 && patch.styleId !== lastStyleId) {
          const seq = stylePool.get(patch.styleId);
          if (seq !== undefined && seq.length > 0) {
            // Reset any previous style before applying the new one so
            // attributes (bold/dim/color) from the old style don't bleed.
            if (styleUsed) out += SGR_RESET;
            out += seq;
            styleUsed = true;
          } else if (styleUsed && (seq === undefined || seq.length === 0)) {
            // Switching from a styled run to a neutral run — reset once.
            out += SGR_RESET;
            styleUsed = false;
          }
          lastStyleId = patch.styleId;
        }
        out += patch.content;
        lastY = patch.y;
        lastX =
          patch.x +
          (patch.visualWidth > 0 ? patch.visualWidth : patch.content.length);
      }

      if (styleUsed) out += SGR_RESET;
      // `charPool` is part of the signature so callers with richer
      // serialization strategies can access it. Not used in the default
      // path because `Patch.content` already carries the resolved string.
      void charPool;
      return out;
    },
  };
}

/**
 * Relative-cursor variant of AnsiPatcher. Unlike `createAnsiPatcher()` which
 * emits absolute CUP sequences (`CSI row ; col H`) — only safe in alt-screen
 * mode — this patcher emits RELATIVE cursor movements that work in main-screen
 * mode where the live frame is embedded inside a scrolling viewport.
 *
 * Emission contract:
 *   * Caller must have just written `fullAnsi + "\n"` so the cursor sits at
 *     column 0 of the line just below the previous frame.
 *   * Caller passes `previousFrameHeight` — the number of rows the previous
 *     frame occupied. The patcher uses this to pull the cursor back up to
 *     the frame's top-left before emitting per-patch movements, then pushes
 *     the cursor back down to the same "line below frame" invariant so the
 *     next caller can repeat the sequence without drift.
 *
 * Strategy:
 *   1. `cursorUp(previousFrameHeight) + \r` pulls the cursor to the
 *      frame's top-left anchor (conceptually row=0, col=0 of the frame).
 *   2. For each patch (sorted by (y, x)):
 *        * Cross-row: `cursorDown(rowDelta) + \r + cursorForward(x)` —
 *          reset column to 0, then move right to target x. Skipping `\r` +
 *          cursorForward when x=0 keeps emissions tight.
 *        * Same-row right: `cursorForward(colDelta)` where colDelta is the
 *          lateral distance from the previous cursor position. Skipped when
 *          patches are adjacent (colDelta == 0).
 *        * Same-row left / row above: defensive `cursorBackward` / `cursorUp`
 *          (not expected with sorted input, but handled so a misuse doesn't
 *          corrupt the frame).
 *   3. Emit style sequences and content identically to the absolute patcher
 *      (reset between styles, single trailing reset if any style was used).
 *   4. After the last patch, push the cursor back to "line below frame" so
 *      the next render starts from the same invariant.
 *
 * Returns "" on empty patch list — callers can short-circuit transport
 * without special-casing the empty string.
 */
export interface RelativeAnsiPatcher {
  write(
    patches: readonly Patch[],
    stylePool: StylePool,
    charPool: CharPool,
    previousFrameHeight: number,
  ): string;
}

export function createRelativeAnsiPatcher(): RelativeAnsiPatcher {
  return {
    write(
      patches: readonly Patch[],
      stylePool: StylePool,
      charPool: CharPool,
      previousFrameHeight: number,
    ): string {
      if (patches.length === 0) return "";

      // Sort by (y, x) — patches may arrive out of order from row-based diff.
      const sorted = patches.slice().sort((p, q) => {
        if (p.y !== q.y) return p.y - q.y;
        return p.x - q.x;
      });

      // Anchor pull-back: cursor currently at column 0 of line below frame.
      // `cursorUp(previousFrameHeight) + \r` lands us at the frame's
      // top-left conceptual row=0 anchor. `\r` is defensive — the CSI move
      // shouldn't affect column, but explicit reset avoids relying on
      // terminal quirks.
      const pullBack = Math.max(0, previousFrameHeight);
      let out = "";
      if (pullBack > 0) {
        out += CSI + pullBack + "A" + "\r";
      } else {
        out += "\r";
      }

      // Track cursor position relative to the anchor (row=0, col=0 at start).
      let currentRow = 0;
      let currentCol = 0;
      let lastStyleId = -1;
      let styleUsed = false;

      for (let i = 0; i < sorted.length; i++) {
        const patch = sorted[i]!;
        const rowDelta = patch.y - currentRow;

        if (rowDelta > 0) {
          // Move down to the target row, then reset column and advance to
          // the target column. `\r` + cursorForward is cleaner than computing
          // a lateral delta across rows.
          out += CSI + rowDelta + "B";
          out += "\r";
          if (patch.x > 0) {
            out += CSI + patch.x + "C";
          }
        } else if (rowDelta < 0) {
          // Defensive: sorted input shouldn't produce this, but if a caller
          // passes an unsorted patch list we don't want to corrupt the frame.
          out += CSI + -rowDelta + "A";
          out += "\r";
          if (patch.x > 0) {
            out += CSI + patch.x + "C";
          }
        } else {
          // Same row — use lateral delta from current column.
          const colDelta = patch.x - currentCol;
          if (colDelta > 0) {
            out += CSI + colDelta + "C";
          } else if (colDelta < 0) {
            // Defensive — not expected with sorted input.
            out += CSI + -colDelta + "D";
          }
          // colDelta === 0 → adjacent patch, no cursor move needed.
        }

        // Style emission — identical logic to createAnsiPatcher so the
        // visual output matches exactly when both paths are live.
        if (patch.styleId >= 0 && patch.styleId !== lastStyleId) {
          const seq = stylePool.get(patch.styleId);
          if (seq !== undefined && seq.length > 0) {
            if (styleUsed) out += SGR_RESET;
            out += seq;
            styleUsed = true;
          } else if (styleUsed && (seq === undefined || seq.length === 0)) {
            out += SGR_RESET;
            styleUsed = false;
          }
          lastStyleId = patch.styleId;
        }

        out += patch.content;

        currentRow = patch.y;
        currentCol =
          patch.x +
          (patch.visualWidth > 0 ? patch.visualWidth : patch.content.length);
      }

      if (styleUsed) out += SGR_RESET;

      // Restore the cursor to "column 0 of the line just below the frame"
      // so the next render starts from the same invariant. From current
      // position (row=currentRow relative to anchor), going down by
      // `pullBack - currentRow` lines lands on the line below the frame.
      const downBy = pullBack - currentRow;
      if (downBy > 0) {
        out += CSI + downBy + "B";
      }
      out += "\r";

      // `charPool` is part of the signature for parity with AnsiPatcher and
      // future serialization strategies that need it. Patch.content already
      // carries the resolved string in the default path.
      void charPool;
      return out;
    },
  };
}
