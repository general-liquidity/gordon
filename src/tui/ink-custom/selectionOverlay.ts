/**
 * selectionOverlay — Phase 4 reconciler module.
 *
 * Non-destructive inverse-video highlight applied to a patch list during the
 * ANSI serialization pass. Selection lives outside the cell grid so that
 * updating or clearing a selection does NOT require re-diffing the frame —
 * the reconciler re-runs `applyTo` on the patches just before they go to
 * stdout.
 *
 * ANSI: SGR 7 (inverse video) / SGR 27 (reset inverse).
 */

import type { Patch, SelectionOverlay, SelectionRange } from "./internal/contracts.ts";

const SGR_INVERSE_ON = "\x1b[7m";
const SGR_INVERSE_OFF = "\x1b[27m";

/**
 * Is cell (x, y) contained in the selection range?
 *
 * Semantics: the range is inclusive on both ends and spans rows top-to-bottom.
 *   - On the start row (row == startRow), cells at x >= startCol are in.
 *   - On the end row (row == endRow), cells at x <= endCol are in.
 *   - On rows strictly between start and end, every cell is in.
 *   - When startRow == endRow, both startCol AND endCol bounds apply.
 */
function cellInRange(x: number, y: number, range: SelectionRange): boolean {
  const { startRow, startCol, endRow, endCol } = range;
  if (y < startRow || y > endRow) return false;

  if (startRow === endRow) {
    return x >= startCol && x <= endCol;
  }
  if (y === startRow) return x >= startCol;
  if (y === endRow) return x <= endCol;
  return true; // fully selected interior row
}

export function createSelectionOverlay(): SelectionOverlay {
  const overlay: SelectionOverlay = {
    current: null,

    set(range: SelectionRange | null): void {
      overlay.current = range;
    },

    clear(): void {
      overlay.current = null;
    },

    applyTo(patches: readonly Patch[]): Patch[] {
      const range = overlay.current;
      if (range === null) {
        // No selection — copy the input into a fresh mutable array so callers
        // always receive a plain Patch[] they may mutate.
        return patches.slice();
      }

      const out: Patch[] = new Array(patches.length);
      for (let i = 0; i < patches.length; i++) {
        const patch = patches[i]!;
        if (cellInRange(patch.x, patch.y, range)) {
          out[i] = {
            x: patch.x,
            y: patch.y,
            content: `${SGR_INVERSE_ON}${patch.content}${SGR_INVERSE_OFF}`,
            visualWidth: patch.visualWidth,
            styleId: patch.styleId,
          };
        } else {
          // Shallow copy so mutations to `out[i]` don't leak back into caller.
          out[i] = {
            x: patch.x,
            y: patch.y,
            content: patch.content,
            visualWidth: patch.visualWidth,
            styleId: patch.styleId,
          };
        }
      }
      return out;
    },
  };

  return overlay;
}
