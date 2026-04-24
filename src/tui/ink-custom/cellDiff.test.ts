import { describe, expect, test } from "bun:test";

import { createCellBuffer } from "./cellBuffer.ts";
import { diffCells } from "./cellDiff.ts";
import { createCharPool } from "./charPool.ts";
import { createStylePool } from "./stylePool.ts";
import { CELL_DIRTY_BIT } from "./internal/contracts.ts";

function paint(buf: ReturnType<typeof createCellBuffer>, pool: ReturnType<typeof createCharPool>, x: number, y: number, ch: string, styleId = 0) {
  buf.set(x, y, pool.intern(ch), styleId, 0);
}

describe("diffCells", () => {
  test("no change produces no patches", () => {
    const prev = createCellBuffer(4, 2);
    const curr = createCellBuffer(4, 2);
    const sp = createStylePool();
    const cp = createCharPool();
    paint(prev, cp, 0, 0, "a");
    paint(curr, cp, 0, 0, "a");
    // Clear the dirty bit on curr so the content compare is apples-to-apples.
    // (diffCells itself clears stale dirty bits as a side effect.)
    const patches = diffCells(prev, curr, sp, cp);
    expect(patches).toEqual([]);
  });

  test("clears stale dirty bits on curr even when content matches", () => {
    const prev = createCellBuffer(2, 1);
    const curr = createCellBuffer(2, 1);
    const sp = createStylePool();
    const cp = createCharPool();
    const id = cp.intern("a");
    prev.set(0, 0, id, 0, 0);
    curr.set(0, 0, id, 0, 0);
    // Both cells now have dirty=true, same content — diff must reconcile.
    diffCells(prev, curr, sp, cp);
    expect((curr.raw()[0] ?? 0) & CELL_DIRTY_BIT).toBe(0);
  });

  test("row-local change stays on the affected row only", () => {
    const prev = createCellBuffer(6, 3);
    const curr = createCellBuffer(6, 3);
    const sp = createStylePool();
    const cp = createCharPool();
    // Prev row 1 = "hello ", curr row 1 = "world " (6 cols). Rows 0 and 2
    // stay zero in both buffers; diff must not touch them.
    const prevText = "hello ";
    const currText = "world ";
    for (let x = 0; x < 6; x++) {
      paint(prev, cp, x, 1, prevText[x]!);
      paint(curr, cp, x, 1, currText[x]!);
    }

    const patches = diffCells(prev, curr, sp, cp);
    expect(patches.length).toBeGreaterThan(0);
    for (const p of patches) expect(p.y).toBe(1);
  });

  test("fully-overwriting row collapses to one run patch", () => {
    const prev = createCellBuffer(5, 1);
    const curr = createCellBuffer(5, 1);
    const sp = createStylePool();
    const cp = createCharPool();
    // Every column differs -> one contiguous run.
    const prevText = "aaaaa";
    const currText = "world";
    for (let x = 0; x < 5; x++) {
      paint(prev, cp, x, 0, prevText[x]!);
      paint(curr, cp, x, 0, currText[x]!);
    }
    const patches = diffCells(prev, curr, sp, cp);
    expect(patches.length).toBe(1);
    expect(patches[0]!.x).toBe(0);
    expect(patches[0]!.content).toBe("world");
    expect(patches[0]!.visualWidth).toBe(5);
  });

  test("merges a contiguous same-style run into one patch", () => {
    const prev = createCellBuffer(5, 1);
    const curr = createCellBuffer(5, 1);
    const sp = createStylePool();
    const cp = createCharPool();
    const red = sp.intern("\x1b[31m");
    // prev is blank (charIdx 0 = space, dirty=0), curr is 5 red letters.
    for (let x = 0; x < 5; x++) {
      curr.set(x, 0, cp.intern("abcde"[x]!), red, 0);
    }
    const patches = diffCells(prev, curr, sp, cp);
    expect(patches.length).toBe(1);
    expect(patches[0]!.content).toBe("abcde");
    expect(patches[0]!.styleId).toBe(red);
    expect(patches[0]!.visualWidth).toBe(5);
  });

  test("splits runs when style changes mid-row", () => {
    const prev = createCellBuffer(4, 1);
    const curr = createCellBuffer(4, 1);
    const sp = createStylePool();
    const cp = createCharPool();
    const red = sp.intern("\x1b[31m");
    const green = sp.intern("\x1b[32m");
    curr.set(0, 0, cp.intern("a"), red, 0);
    curr.set(1, 0, cp.intern("b"), red, 0);
    curr.set(2, 0, cp.intern("c"), green, 0);
    curr.set(3, 0, cp.intern("d"), green, 0);

    const patches = diffCells(prev, curr, sp, cp);
    expect(patches.length).toBe(2);
    expect(patches[0]!.content).toBe("ab");
    expect(patches[0]!.styleId).toBe(red);
    expect(patches[1]!.content).toBe("cd");
    expect(patches[1]!.styleId).toBe(green);
  });

  test("emits separate patches for non-contiguous changes on the same row", () => {
    const prev = createCellBuffer(5, 1);
    const curr = createCellBuffer(5, 1);
    const sp = createStylePool();
    const cp = createCharPool();
    // Seed both to identical content, then mutate col 0 and col 4.
    for (let x = 0; x < 5; x++) {
      const id = cp.intern("-");
      prev.set(x, 0, id, 0, 0);
      curr.set(x, 0, id, 0, 0);
    }
    curr.set(0, 0, cp.intern("L"), 0, 0);
    curr.set(4, 0, cp.intern("R"), 0, 0);

    const patches = diffCells(prev, curr, sp, cp);
    expect(patches.length).toBe(2);
    expect(patches[0]!.x).toBe(0);
    expect(patches[0]!.content).toBe("L");
    expect(patches[1]!.x).toBe(4);
    expect(patches[1]!.content).toBe("R");
  });

  test("changes on different rows produce separate patches", () => {
    const prev = createCellBuffer(2, 2);
    const curr = createCellBuffer(2, 2);
    const sp = createStylePool();
    const cp = createCharPool();
    paint(curr, cp, 0, 0, "a");
    paint(curr, cp, 1, 1, "b");
    const patches = diffCells(prev, curr, sp, cp);
    expect(patches.length).toBe(2);
    expect(patches[0]!.y).toBe(0);
    expect(patches[1]!.y).toBe(1);
  });

  test("double-width: leading cell emits glyph, trailing half is skipped", () => {
    const prev = createCellBuffer(4, 1);
    const curr = createCellBuffer(4, 1);
    const sp = createStylePool();
    const cp = createCharPool();
    // Col 0: double-width glyph; col 1: trailing half (blank, width 0-ish).
    const wide = cp.intern("漢");
    curr.set(0, 0, wide, 0, 1); // width=1 -> double-width
    curr.set(1, 0, cp.intern(" "), 0, 0); // trailing half placeholder
    curr.set(2, 0, cp.intern("x"), 0, 0);

    const patches = diffCells(prev, curr, sp, cp);
    // Must produce one run covering the double-width + ASCII. Trailing-half
    // glyph must not appear in the emitted content.
    expect(patches.length).toBe(1);
    expect(patches[0]!.x).toBe(0);
    expect(patches[0]!.content).toBe("漢x");
    expect(patches[0]!.visualWidth).toBe(3);
  });

  test("throws on size mismatch between prev and curr", () => {
    const sp = createStylePool();
    const cp = createCharPool();
    const a = createCellBuffer(2, 2);
    const b = createCellBuffer(3, 2);
    expect(() => diffCells(a, b, sp, cp)).toThrow();
  });
});
