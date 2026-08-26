// cellDiff — Phase 1 cell-level diff producing minimal Patch runs.
//
// Active in customRender. Walks the raw Int32Arrays of two buffers and emits one
// Patch per contiguous same-style run on each row. Clean cells are skipped
// cheaply by comparing packed ints directly. The dirty bit on `curr` is
// cleared as we read each cell so subsequent diffs only pay for real changes.
//
// Damage rectangle optimization (B3):
//
//   On a 200x80 terminal the naive walk performs 16,000 cell compares to
//   find a 10-cell change. The optional `DamageTracker` records the
//   bounding box of patches emitted on the previous frame; on the next
//   diff, the walker confines itself to that box (plus a 1-row margin to
//   absorb growth) and runs a sentinel scan on a small set of rows
//   outside the box to catch changes that escaped the previous damage
//   region. If the sentinel scan trips, the tracker invalidates itself
//   and the walker falls back to a full-buffer scan for that frame.
//
// Correctness invariant: the optimization NEVER misses a real change.
// The sentinel-row check covers every row outside the box; if any of
// those rows differs, we fall back to a full scan. The 1-row margin
// guards against off-by-one growth at the box's edges.

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

/** Bounding box of damaged cells from the previous diff. `null` means
 *  "no prior frame information — must do a full scan next time". An
 *  "empty" box (minY > maxY) means "previous frame had zero changes". */
export interface DamageBox {
  minY: number;
  maxY: number;
  minX: number;
  maxX: number;
}

/** Lightweight tracker that callers can thread through successive
 *  `diffCells` invocations. After each diff, the tracker holds the
 *  bounding box of patches emitted; the next `diffCells` call uses it
 *  to bound its scan.
 */
export interface DamageTracker {
  /** Current box. `null` => unknown / must full-scan. Empty => no damage. */
  readonly box: DamageBox | null;
  /** True when next diff should ignore the box and full-scan. Set when
   *  a sentinel row outside the box trips, when the buffer is resized,
   *  or after explicit `invalidate()`. */
  readonly mustFullScan: boolean;
  /** Reset to "no prior info" — next diff will full-scan. */
  invalidate(): void;
  /** Caller-driven update: pass a freshly-computed bounding box from
   *  the patch list this frame, or `null` to mark "no patches". */
  recordBox(next: DamageBox | null): void;
  /** Mark the next diff as needing a full scan without losing the box.
   *  Used when the diff itself decides the box was insufficient. */
  forceFullScanNext(): void;
}

export function createDamageTracker(): DamageTracker {
  let box: DamageBox | null = null;
  let mustFullScan = true; // first frame is always a full scan
  return {
    get box() {
      return box;
    },
    get mustFullScan() {
      return mustFullScan;
    },
    invalidate(): void {
      box = null;
      mustFullScan = true;
    },
    recordBox(next: DamageBox | null): void {
      box = next;
      mustFullScan = false;
    },
    forceFullScanNext(): void {
      mustFullScan = true;
    },
  };
}

const CONTENT_MASK = ~CELL_DIRTY_BIT;

/**
 * Sentinel scan: walk every row outside [boxStartY, boxEndY] and check
 * whether the row contains any differing cell. If so, the prior damage
 * box is stale — caller must fall back to a full scan. We use simple
 * row-wise compares; the inner loop is dense but each row outside the
 * box is rare-changed so it short-circuits early in practice.
 *
 * Returns true when a difference was detected outside the box.
 */
function sentinelHitsOutsideBox(
  prevRaw: Int32Array,
  currRaw: Int32Array,
  width: number,
  height: number,
  boxStartY: number,
  boxEndY: number,
): boolean {
  for (let y = 0; y < height; y++) {
    if (y >= boxStartY && y <= boxEndY) continue;
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      const idx = rowOffset + x;
      const p = (prevRaw[idx] ?? 0) & CONTENT_MASK;
      const c = (currRaw[idx] ?? 0) & CONTENT_MASK;
      if (p !== c) return true;
    }
  }
  return false;
}

/**
 * Scan rows in [yStart, yEndExclusive). Emits patches; also tracks the
 * bounding box of any emitted runs into the supplied accumulator.
 */
function scanRows(
  prevRaw: Int32Array,
  currRaw: Int32Array,
  width: number,
  charPool: CharPool,
  yStart: number,
  yEndExclusive: number,
  patches: Patch[],
  acc: { minY: number; maxY: number; minX: number; maxX: number; any: boolean },
): void {
  for (let y = yStart; y < yEndExclusive; y++) {
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
        const endX = startX + visualWidth - 1;
        patches.push({
          x: startX,
          y,
          content,
          visualWidth,
          styleId: runStyleId,
        });
        if (!acc.any) {
          acc.any = true;
          acc.minY = y;
          acc.maxY = y;
          acc.minX = startX;
          acc.maxX = endX;
        } else {
          if (y < acc.minY) acc.minY = y;
          if (y > acc.maxY) acc.maxY = y;
          if (startX < acc.minX) acc.minX = startX;
          if (endX > acc.maxX) acc.maxX = endX;
        }
      }
    }
  }
}

export function diffCells(
  prev: CellBuffer,
  curr: CellBuffer,
  _stylePool: StylePool,
  charPool: CharPool,
  tracker?: DamageTracker,
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
  const acc = { minY: 0, maxY: 0, minX: 0, maxX: 0, any: false };

  // ---------------------------------------------------------------
  // Damage-rect fast path
  //
  // Conditions to enter the fast path:
  //   * tracker is supplied
  //   * tracker has a non-null box
  //   * tracker is not flagged for full-scan
  //   * a damage box exists (last frame had >= 1 patch)
  //
  // We expand the box by 1 row on each side as a margin. We then run
  // a sentinel scan over the rows outside [boxStartY, boxEndY]; if
  // any cell there differs we abandon the fast path and full-scan.
  // ---------------------------------------------------------------
  let usedFastPath = false;
  if (
    tracker &&
    tracker.box !== null &&
    !tracker.mustFullScan &&
    width > 0 &&
    height > 0
  ) {
    const prevBox = tracker.box;
    const isEmpty = prevBox.minY > prevBox.maxY;
    if (isEmpty) {
      // Previous frame had zero patches. Run the sentinel scan over
      // the WHOLE buffer to confirm; if anything differs, full-scan.
      // If nothing differs, return immediately — O(n) but unavoidable
      // (we still must verify), then record an empty box.
      if (sentinelHitsOutsideBox(prevRaw, currRaw, width, height, 0, -1)) {
        // Differences exist somewhere. Fall through to full scan.
      } else {
        // Genuinely no change. Record empty and return.
        tracker.recordBox({ minY: 0, maxY: -1, minX: 0, maxX: -1 });
        return patches;
      }
    } else {
      // Expand by 1-row margin to absorb edge growth.
      const boxStartY = Math.max(0, prevBox.minY - 1);
      const boxEndY = Math.min(height - 1, prevBox.maxY + 1);

      // Verify nothing outside the (expanded) box differs.
      const sentinelTrip = sentinelHitsOutsideBox(
        prevRaw,
        currRaw,
        width,
        height,
        boxStartY,
        boxEndY,
      );

      if (sentinelTrip) {
        // Box is stale — fall through to full scan and force the next
        // frame to also full-scan since damage has spread.
        tracker.invalidate();
      } else {
        // Safe to confine the walk to [boxStartY, boxEndY].
        scanRows(
          prevRaw,
          currRaw,
          width,
          charPool,
          boxStartY,
          boxEndY + 1,
          patches,
          acc,
        );
        usedFastPath = true;
      }
    }
  }

  if (!usedFastPath) {
    // Full-buffer walk.
    scanRows(prevRaw, currRaw, width, charPool, 0, height, patches, acc);
  }

  // Update tracker with the freshly-computed box.
  if (tracker) {
    if (acc.any) {
      tracker.recordBox({
        minY: acc.minY,
        maxY: acc.maxY,
        minX: acc.minX,
        maxX: acc.maxX,
      });
    } else {
      // Empty box — next diff can short-circuit if no cell outside the
      // (empty) box differs. We use minY > maxY as the empty marker.
      tracker.recordBox({ minY: 0, maxY: -1, minX: 0, maxX: -1 });
    }
  }

  return patches;
}
