import { describe, expect, test } from "bun:test";

import { createCellBuffer } from "./cellBuffer.ts";
import {
  CELL_CHAR_MASK,
  CELL_DIRTY_BIT,
  CELL_STYLE_MASK,
  CELL_STYLE_SHIFT,
  CELL_WIDTH_MASK,
  CELL_WIDTH_SHIFT,
} from "./internal/contracts.ts";

describe("cellBuffer", () => {
  test("starts zero-filled with the right dimensions", () => {
    const buf = createCellBuffer(4, 3);
    expect(buf.width).toBe(4);
    expect(buf.height).toBe(3);
    expect(buf.raw().length).toBe(12);
    for (let i = 0; i < 12; i++) expect(buf.raw()[i]).toBe(0);
  });

  test("set/get round-trips charIdx, styleId, width, dirty", () => {
    const buf = createCellBuffer(2, 2);
    buf.set(1, 1, 0xabcde, 0x42, 1);
    const cell = buf.get(1, 1);
    expect(cell.charIdx).toBe(0xabcde);
    expect(cell.styleId).toBe(0x42);
    expect(cell.width).toBe(1);
    expect(cell.dirty).toBe(true);
  });

  test("packs fields into the exact bit positions from contracts", () => {
    const buf = createCellBuffer(1, 1);
    buf.set(0, 0, 0x5, 0x3, 2);
    const raw = buf.raw()[0] ?? 0;

    expect(raw & CELL_CHAR_MASK).toBe(0x5);
    expect((raw >> CELL_STYLE_SHIFT) & CELL_STYLE_MASK).toBe(0x3);
    expect((raw >> CELL_WIDTH_SHIFT) & CELL_WIDTH_MASK).toBe(2);
    expect((raw & CELL_DIRTY_BIT) !== 0).toBe(true);
  });

  test("rejects out-of-range values instead of silently truncating", () => {
    const buf = createCellBuffer(2, 2);
    expect(() => buf.set(0, 0, CELL_CHAR_MASK + 1, 0, 0)).toThrow();
    expect(() => buf.set(0, 0, 0, CELL_STYLE_MASK + 1, 0)).toThrow();
    expect(() => buf.set(0, 0, 0, 0, (CELL_WIDTH_MASK + 1) as 0)).toThrow();
    expect(() => buf.set(-1, 0, 0, 0, 0)).toThrow();
    expect(() => buf.set(0, 99, 0, 0, 0)).toThrow();
  });

  test("clear zeros every cell", () => {
    const buf = createCellBuffer(3, 2);
    buf.set(0, 0, 1, 1, 1);
    buf.set(2, 1, 2, 2, 2);
    buf.clear();
    for (let i = 0; i < 6; i++) expect(buf.raw()[i]).toBe(0);
  });

  test("copyFrom mirrors another buffer of the same size", () => {
    const a = createCellBuffer(2, 2);
    a.set(0, 0, 9, 1, 0);
    a.set(1, 1, 5, 2, 1);
    const b = createCellBuffer(2, 2);
    b.copyFrom(a);
    expect(Array.from(b.raw())).toEqual(Array.from(a.raw()));
  });

  test("copyFrom throws on size mismatch", () => {
    const a = createCellBuffer(2, 2);
    const b = createCellBuffer(3, 2);
    expect(() => b.copyFrom(a)).toThrow();
  });

  test("rejects bad constructor dimensions", () => {
    expect(() => createCellBuffer(-1, 4)).toThrow();
    expect(() => createCellBuffer(4, 1.5)).toThrow();
  });
});
