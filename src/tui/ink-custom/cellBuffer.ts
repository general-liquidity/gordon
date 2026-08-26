// cellBuffer — Phase 1 packed Int32 cell grid.
//
// Active in customRender. One Int32 per cell encodes (charIdx | styleId | width |
// dirty) per the bit layout in internal/contracts.ts. The reconciler diff
// walks the raw Int32Array directly for speed; `get()` is a convenience for
// tests and debugging.

import {
  CELL_CHAR_MASK,
  CELL_DIRTY_BIT,
  CELL_STYLE_MASK,
  CELL_STYLE_SHIFT,
  CELL_WIDTH_MASK,
  CELL_WIDTH_SHIFT,
  type Cell,
  type CellBuffer,
  type CellWidth,
} from "./internal/contracts.ts";

export function createCellBuffer(width: number, height: number): CellBuffer {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 0 || height < 0) {
    throw new Error(`createCellBuffer: invalid dimensions ${width}x${height}`);
  }

  const data = new Int32Array(width * height);

  // Pre-compute a constant pack of (charIdx=0, styleId=0, width=1, dirty=0)
  // so `clear()` zeros visual width=1 space cells. Width=1 is encoded as 0
  // in the 2-bit width field (0=single, 1=double, 2=zero) — so plain zero
  // is fine. The consumer picks a charPool ID for the blank glyph.

  const buf: CellBuffer = {
    width,
    height,
    set(x, y, charIdx, styleId, cellWidth) {
      // Bounds and domain checks — pack can't silently truncate.
      if (x < 0 || x >= width || y < 0 || y >= height) {
        throw new Error(`cellBuffer.set: (${x},${y}) out of bounds ${width}x${height}`);
      }
      if ((charIdx & ~CELL_CHAR_MASK) !== 0) {
        throw new Error(`cellBuffer.set: charIdx ${charIdx} exceeds 20-bit mask`);
      }
      if ((styleId & ~CELL_STYLE_MASK) !== 0) {
        throw new Error(`cellBuffer.set: styleId ${styleId} exceeds 8-bit mask`);
      }
      if ((cellWidth & ~CELL_WIDTH_MASK) !== 0) {
        throw new Error(`cellBuffer.set: width ${cellWidth} exceeds 2-bit mask`);
      }

      const packed =
        (charIdx & CELL_CHAR_MASK) |
        ((styleId & CELL_STYLE_MASK) << CELL_STYLE_SHIFT) |
        ((cellWidth & CELL_WIDTH_MASK) << CELL_WIDTH_SHIFT) |
        CELL_DIRTY_BIT;

      data[y * width + x] = packed;
    },
    get(x, y): Cell {
      if (x < 0 || x >= width || y < 0 || y >= height) {
        throw new Error(`cellBuffer.get: (${x},${y}) out of bounds ${width}x${height}`);
      }
      const packed = data[y * width + x] ?? 0;
      return {
        charIdx: packed & CELL_CHAR_MASK,
        styleId: (packed >> CELL_STYLE_SHIFT) & CELL_STYLE_MASK,
        width: ((packed >> CELL_WIDTH_SHIFT) & CELL_WIDTH_MASK) as CellWidth,
        dirty: (packed & CELL_DIRTY_BIT) !== 0,
      };
    },
    raw() {
      return data;
    },
    clear() {
      data.fill(0);
    },
    copyFrom(other) {
      if (other.width !== width || other.height !== height) {
        throw new Error(
          `cellBuffer.copyFrom: size mismatch ${other.width}x${other.height} vs ${width}x${height}`,
        );
      }
      data.set(other.raw());
    },
  };

  return buf;
}
