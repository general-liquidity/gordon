// cellDiff — Phase 1 cell-level diff producing minimal Patch runs.
//
// Status: NOT WIRED. Walks the raw Int32Arrays of two buffers and emits one
// Patch per contiguous same-style run on each row. Clean cells are skipped
// cheaply by comparing packed ints directly. The dirty bit on `curr` is
// cleared as we read each cell so subsequent diffs only pay for real changes.

import {
  CELL_CHAR_MASK,
  CELL_DIRTY_BIT,
  CELL_STYLE_MASK,
  CELL_STYLE_SHIFT,
  CELL_WIDTH_MASK,
  CELL_WIDTH_SHIFT,
  type CellBuffer,
  type CharPool,
  type Patch,
  type StylePool,
} from "./internal/contracts.ts";

export function diffCells(
  prev: CellBuffer,
  curr: CellBuffer,
  _stylePool: StylePool,
  charPool: CharPool,
): Patch[] {
  if (prev.width !== curr.width || prev.height !== curr.height) {
    throw new Error(
      `diffCells: size mismatch ${prev.width}x${prev.height} vs ${curr.width}x${curr.height}`,
    );
  }

  const width = curr.width;
  const height = curr.height;
  const prevRaw = prev.raw();
  const currRaw = curr.raw();
  const patches: Patch[] = [];

  // Compare without the dirty bit so a stale dirty flag doesn't produce a
  // spurious patch. The dirty bit is bookkeeping, not content.
  const CONTENT_MASK = ~CELL_DIRTY_BIT;

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    let x = 0;

    while (x < width) {
      const idx = rowOffset + x;
      const prevCell = (prevRaw[idx] ?? 0) & CONTENT_MASK;
      const currPacked = currRaw[idx] ?? 0;
      const currCell = currPacked & CONTENT_MASK;

      if (prevCell === currCell) {
        // Clean: clear any stale dirty bit on curr and advance. Skipping
        // clean regions is the hot path — a tight loop keeps this cheap.
        if (currPacked !== currCell) currRaw[idx] = currCell;
        x++;
        continue;
      }

      // Start a run of changed cells sharing the same style.
      const startX = x;
      const runStyleId = (currCell >> CELL_STYLE_SHIFT) & CELL_STYLE_MASK;
      let content = "";
      let visualWidth = 0;

      while (x < width) {
        const runIdx = rowOffset + x;
        const rPrev = (prevRaw[runIdx] ?? 0) & CONTENT_MASK;
        const rPackedCurr = currRaw[runIdx] ?? 0;
        const rCurr = rPackedCurr & CONTENT_MASK;
        if (rPrev === rCurr) break;

        const styleId = (rCurr >> CELL_STYLE_SHIFT) & CELL_STYLE_MASK;
        if (styleId !== runStyleId && content.length > 0) break;

        const cellWidth = (rCurr >> CELL_WIDTH_SHIFT) & CELL_WIDTH_MASK;
        const charIdx = rCurr & CELL_CHAR_MASK;
        const glyph = charPool.get(charIdx) ?? "";

        if (cellWidth === 2) {
          // Zero-width: contribute glyph but no cell advance on visualWidth.
          // Still counts as one underlying cell in the buffer scan.
          content += glyph;
          if (rPackedCurr !== rCurr) currRaw[runIdx] = rCurr;
          x++;
          continue;
        }

        content += glyph;
        visualWidth += cellWidth === 1 ? 2 : 1;
        // Clear stale dirty bit in place.
        if (rPackedCurr !== rCurr) currRaw[runIdx] = rCurr;

        if (cellWidth === 1) {
          // Double-width: skip the trailing-half cell (it has no renderable
          // glyph of its own). Also mark its dirty bit clean so we don't
          // re-emit it next frame.
          const trailingIdx = runIdx + 1;
          if (x + 1 < width) {
            const trailPackedCurr = currRaw[trailingIdx] ?? 0;
            const trailClean = trailPackedCurr & CONTENT_MASK;
            if (trailPackedCurr !== trailClean) currRaw[trailingIdx] = trailClean;
          }
          x += 2;
        } else {
          x++;
        }
      }

      if (content.length > 0) {
        patches.push({
          x: startX,
          y,
          content,
          visualWidth,
          styleId: runStyleId,
        });
      }
    }
  }

  return patches;
}
