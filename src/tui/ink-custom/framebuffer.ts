// framebuffer — Phase 2 double-buffered frame management.
//
// Active in customRender. Built against the interfaces in
// `./internal/contracts.ts`. The concrete `CellBuffer` implementation lives
// in Phase 1 (`./cellBuffer.ts`) and is supplied here via a factory, so this
// module never has to import Phase 1's implementation directly.
//
// Responsibilities:
//   * Hold two `CellBuffer`s — `back` (being painted) and `front` (on
//     screen). Reconciler paints into `back`, diffs against `front`, then
//     calls `swap()` to promote `back` to `front`.
//   * `swap()` returns the bounding boxes of cells that changed between the
//     old front and the new front. The reconciler already has a fine-grained
//     patch list from the PatchEmitter; this coarser region list is useful
//     for higher-level bookkeeping (e.g., scroll region hints, damage
//     tracking in the log-update transport).
//   * `resize(w, h)` discards all cell state and reallocates both buffers.

import type {
  CellBuffer,
  ChangedRegion,
  FrameBuffer,
} from "./internal/contracts.ts";

/** Factory signature for `CellBuffer` — injected by the caller so this
 *  module does not depend on Phase 1's concrete implementation. */
export type NewCellBuffer = (width: number, height: number) => CellBuffer;

/**
 * Build a `FrameBuffer` backed by two `CellBuffer`s allocated through the
 * provided factory. The factory is called exactly twice at construction
 * time and again on every `resize()`.
 */
export function createFrameBuffer(
  width: number,
  height: number,
  newCellBuffer: NewCellBuffer,
): FrameBuffer {
  if (width < 0 || height < 0) {
    throw new Error(
      `createFrameBuffer: invalid dimensions ${width}x${height}`,
    );
  }

  let w = width;
  let h = height;
  let back = newCellBuffer(w, h);
  let front = newCellBuffer(w, h);

  /**
   * Scan `back.raw()` against `front.raw()` and return the set of changed
   * bounding boxes. The scan emits one `ChangedRegion` per contiguous row
   * run that contains at least one differing cell. This keeps the return
   * cheap for the common case (few rows touched) and avoids collapsing
   * unrelated changes into a single oversized bounding box.
   */
  function computeChangedRegions(
    prev: CellBuffer,
    curr: CellBuffer,
  ): ChangedRegion[] {
    if (w === 0 || h === 0) return [];

    const a = prev.raw();
    const b = curr.raw();
    if (a.length !== b.length) {
      // Size mismatch — everything is considered changed.
      return w > 0 && h > 0
        ? [{ minX: 0, minY: 0, maxX: w - 1, maxY: h - 1 }]
        : [];
    }

    const regions: ChangedRegion[] = [];
    let rowMinX = -1;
    let rowMaxX = -1;
    let rowStart = -1;

    for (let y = 0; y < h; y++) {
      const rowBase = y * w;
      let rowDirty = false;
      let minX = w;
      let maxX = -1;
      for (let x = 0; x < w; x++) {
        if (a[rowBase + x] !== b[rowBase + x]) {
          rowDirty = true;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
        }
      }
      if (rowDirty) {
        if (rowStart === -1) {
          rowStart = y;
          rowMinX = minX;
          rowMaxX = maxX;
        } else {
          if (minX < rowMinX) rowMinX = minX;
          if (maxX > rowMaxX) rowMaxX = maxX;
        }
      } else if (rowStart !== -1) {
        regions.push({
          minX: rowMinX,
          minY: rowStart,
          maxX: rowMaxX,
          maxY: y - 1,
        });
        rowStart = -1;
        rowMinX = -1;
        rowMaxX = -1;
      }
    }
    if (rowStart !== -1) {
      regions.push({
        minX: rowMinX,
        minY: rowStart,
        maxX: rowMaxX,
        maxY: h - 1,
      });
    }
    return regions;
  }

  const fb: FrameBuffer = {
    get width() {
      return w;
    },
    get height() {
      return h;
    },
    get back() {
      return back;
    },
    set back(value: CellBuffer) {
      back = value;
    },
    get front() {
      return front;
    },
    set front(value: CellBuffer) {
      front = value;
    },
    swap(): ChangedRegion[] {
      // Compute the changed regions between the current front (on screen)
      // and the current back (about to become the new front). Must happen
      // BEFORE the swap/clear so we see the painted state.
      const regions = computeChangedRegions(front, back);
      // Swap pointers: back becomes the new front; old front is reused as
      // the new back after clearing (zero allocation in the common path).
      const oldFront = front;
      front = back;
      back = oldFront;
      back.clear();
      return regions;
    },
    resize(nextWidth: number, nextHeight: number): void {
      if (nextWidth < 0 || nextHeight < 0) {
        throw new Error(
          `FrameBuffer.resize: invalid dimensions ${nextWidth}x${nextHeight}`,
        );
      }
      w = nextWidth;
      h = nextHeight;
      back = newCellBuffer(w, h);
      front = newCellBuffer(w, h);
    },
  };

  return fb;
}
