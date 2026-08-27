import { describe, test, expect } from "bun:test";
import { createFrameBuffer } from "./framebuffer.ts";
import type { CellBuffer, CellWidth } from "./internal/contracts.ts";
import {
  CELL_CHAR_MASK,
  CELL_STYLE_MASK,
  CELL_STYLE_SHIFT,
  CELL_WIDTH_MASK,
  CELL_WIDTH_SHIFT,
} from "./internal/contracts.ts";

// ---------------------------------------------------------------------------
// Mock CellBuffer — implements the Phase 1 contract with a plain Int32Array.
// Used by Phase 2 tests so we do not have to wait for Phase 1's concrete
// implementation. The packing matches `contracts.ts` exactly so raw() diffs
// between this mock and a future real CellBuffer would be byte-compatible.
// ---------------------------------------------------------------------------
function makeMockCellBuffer(width: number, height: number): CellBuffer {
  const data = new Int32Array(width * height);
  const buf: CellBuffer = {
    width,
    height,
    set(x: number, y: number, charIdx: number, styleId: number, cellWidth: CellWidth): void {
      if (x < 0 || x >= width || y < 0 || y >= height) return;
      const packed =
        (charIdx & CELL_CHAR_MASK) |
        ((styleId & CELL_STYLE_MASK) << CELL_STYLE_SHIFT) |
        ((cellWidth & CELL_WIDTH_MASK) << CELL_WIDTH_SHIFT);
      data[y * width + x] = packed;
    },
    get(x: number, y: number) {
      const raw = data[y * width + x] ?? 0;
      const widthBits = (raw >>> CELL_WIDTH_SHIFT) & CELL_WIDTH_MASK;
      const visual: CellWidth = widthBits === 1 ? 1 : widthBits === 2 ? 2 : 0;
      return {
        charIdx: raw & CELL_CHAR_MASK,
        styleId: (raw >>> CELL_STYLE_SHIFT) & CELL_STYLE_MASK,
        width: visual,
        dirty: false,
      };
    },
    raw(): Int32Array {
      return data;
    },
    clear(): void {
      data.fill(0);
    },
    copyFrom(other: CellBuffer): void {
      if (other.width !== width || other.height !== height) {
        throw new Error("copyFrom: size mismatch");
      }
      data.set(other.raw());
    },
  };
  return buf;
}

describe("createFrameBuffer", () => {
  test("exposes width/height and allocates back+front via factory", () => {
    let calls = 0;
    const fb = createFrameBuffer(10, 5, (w, h) => {
      calls++;
      return makeMockCellBuffer(w, h);
    });
    expect(fb.width).toBe(10);
    expect(fb.height).toBe(5);
    expect(calls).toBe(2);
    expect(fb.back.width).toBe(10);
    expect(fb.front.height).toBe(5);
  });

  test("swap moves back -> front and clears the new back", () => {
    const fb = createFrameBuffer(4, 2, makeMockCellBuffer);
    // Paint into back.
    fb.back.set(1, 0, 0x41 /* char id */, 3 /* style id */, 0);
    fb.back.set(2, 0, 0x42, 3, 0);
    // Capture a handle to the back buffer before swap to prove pointer
    // movement rather than a content copy.
    const backBefore = fb.back;
    const regions = fb.swap();
    // After swap: old back is now front, front has the painted content.
    expect(fb.front).toBe(backBefore);
    expect(fb.front.get(1, 0).charIdx).toBe(0x41);
    expect(fb.front.get(2, 0).charIdx).toBe(0x42);
    // The new back is the recycled old front - cleared to all zeros.
    expect(fb.back.get(1, 0).charIdx).toBe(0);
    expect(fb.back.get(2, 0).charIdx).toBe(0);
    // Changed region covers the painted cells on row 0.
    expect(regions.length).toBe(1);
    expect(regions[0]).toEqual({ minX: 1, minY: 0, maxX: 2, maxY: 0 });
  });

  test("swap returns empty regions when back matches front", () => {
    const fb = createFrameBuffer(3, 3, makeMockCellBuffer);
    // First swap - both buffers start empty, so no changes.
    const first = fb.swap();
    expect(first).toEqual([]);
    // Paint, swap - changes reported.
    fb.back.set(0, 0, 1, 1, 0);
    const second = fb.swap();
    expect(second.length).toBe(1);
    // Paint the SAME content again into the new back - after swap no
    // changes should be reported because old front already contains it.
    fb.back.set(0, 0, 1, 1, 0);
    const third = fb.swap();
    expect(third).toEqual([]);
  });

  test("swap splits non-adjacent dirty rows into separate regions", () => {
    const fb = createFrameBuffer(5, 5, makeMockCellBuffer);
    fb.back.set(0, 0, 7, 1, 0);
    fb.back.set(4, 0, 8, 1, 0);
    fb.back.set(2, 3, 9, 1, 0);
    const regions = fb.swap();
    // Row 0 and row 3 are non-adjacent -> two regions.
    expect(regions.length).toBe(2);
    expect(regions[0]).toEqual({ minX: 0, minY: 0, maxX: 4, maxY: 0 });
    expect(regions[1]).toEqual({ minX: 2, minY: 3, maxX: 2, maxY: 3 });
  });

  test("resize discards cell state and reallocates both buffers", () => {
    const dims: Array<[number, number]> = [];
    const fb = createFrameBuffer(4, 4, (w, h) => {
      dims.push([w, h]);
      return makeMockCellBuffer(w, h);
    });
    fb.back.set(1, 1, 42, 1, 0);
    fb.front.set(2, 2, 43, 1, 0);
    expect(dims).toEqual([
      [4, 4],
      [4, 4],
    ]);
    fb.resize(8, 6);
    expect(fb.width).toBe(8);
    expect(fb.height).toBe(6);
    expect(fb.back.width).toBe(8);
    expect(fb.front.height).toBe(6);
    // All state wiped.
    expect(fb.back.get(1, 1).charIdx).toBe(0);
    expect(fb.front.get(2, 2).charIdx).toBe(0);
    expect(dims).toEqual([
      [4, 4],
      [4, 4],
      [8, 6],
      [8, 6],
    ]);
  });

  test("rejects negative dimensions at construction and on resize", () => {
    expect(() => createFrameBuffer(-1, 5, makeMockCellBuffer)).toThrow();
    const fb = createFrameBuffer(2, 2, makeMockCellBuffer);
    expect(() => fb.resize(3, -1)).toThrow();
  });
});
