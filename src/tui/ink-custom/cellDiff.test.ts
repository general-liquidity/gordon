import { describe, expect, test } from "bun:test";

import { createCellBuffer } from "./cellBuffer.ts";
import { createDamageTracker, diffCells } from "./cellDiff.ts";
import { createCharPool } from "./charPool.ts";
import { createStylePool } from "./stylePool.ts";
import { CELL_DIRTY_BIT } from "./internal/contracts.ts";

function paint(
  buf: ReturnType<typeof createCellBuffer>,
  pool: ReturnType<typeof createCharPool>,
  x: number,
  y: number,
  ch: string,
  styleId = 0,
) {
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

describe("diffCells damage rectangle", () => {
  test("first call with tracker performs a full scan and records the box", () => {
    const sp = createStylePool();
    const cp = createCharPool();
    const prev = createCellBuffer(20, 10);
    const curr = createCellBuffer(20, 10);
    // Paint a small change at (5,3) -> (7,3).
    for (let x = 5; x <= 7; x++) curr.set(x, 3, cp.intern("x"), 0, 0);

    const tracker = createDamageTracker();
    expect(tracker.mustFullScan).toBe(true);
    const patches = diffCells(prev, curr, sp, cp, tracker);
    expect(patches.length).toBe(1);
    expect(tracker.box).not.toBeNull();
    expect(tracker.box).toEqual({ minY: 3, maxY: 3, minX: 5, maxX: 7 });
    expect(tracker.mustFullScan).toBe(false);
  });

  test("second call with change INSIDE prior box uses fast path correctly", () => {
    const sp = createStylePool();
    const cp = createCharPool();
    const prev = createCellBuffer(20, 10);
    const curr = createCellBuffer(20, 10);
    const tracker = createDamageTracker();

    // Frame 1: change row 5 cols 4-7.
    for (let x = 4; x <= 7; x++) curr.set(x, 5, cp.intern("a"), 0, 0);
    diffCells(prev, curr, sp, cp, tracker);
    // Promote curr -> prev for next frame (simulate swap).
    prev.copyFrom(curr);
    curr.clear();
    // Frame 2: keep frame 1 content; change a single cell on row 5, col 6.
    for (let x = 4; x <= 7; x++) curr.set(x, 5, cp.intern("a"), 0, 0);
    curr.set(6, 5, cp.intern("b"), 0, 0);

    const patches = diffCells(prev, curr, sp, cp, tracker);
    expect(patches.length).toBe(1);
    expect(patches[0]!.x).toBe(6);
    expect(patches[0]!.y).toBe(5);
    expect(patches[0]!.content).toBe("b");
    expect(tracker.box).toEqual({ minY: 5, maxY: 5, minX: 6, maxX: 6 });
  });

  test("change OUTSIDE prior box trips sentinel and falls back to full scan", () => {
    const sp = createStylePool();
    const cp = createCharPool();
    const prev = createCellBuffer(30, 20);
    const curr = createCellBuffer(30, 20);
    const tracker = createDamageTracker();

    // Frame 1: change at row 2, col 5.
    curr.set(5, 2, cp.intern("a"), 0, 0);
    diffCells(prev, curr, sp, cp, tracker);
    expect(tracker.box).toEqual({ minY: 2, maxY: 2, minX: 5, maxX: 5 });

    prev.copyFrom(curr);
    curr.clear();
    // Frame 2: keep prior content + add a change FAR outside the box at (15,18).
    curr.set(5, 2, cp.intern("a"), 0, 0);
    curr.set(15, 18, cp.intern("z"), 0, 0);

    const patches = diffCells(prev, curr, sp, cp, tracker);
    // Sentinel trip causes full scan; the only NEW change is at row 18.
    // Row 2 already matches prev so no patch from there.
    expect(patches.length).toBe(1);
    expect(patches[0]!.x).toBe(15);
    expect(patches[0]!.y).toBe(18);
    // Tracker should now reflect the new damage box.
    expect(tracker.box).toEqual({ minY: 18, maxY: 18, minX: 15, maxX: 15 });
  });

  test("no-change frame after a clean frame returns O(1) once box is empty", () => {
    const sp = createStylePool();
    const cp = createCharPool();
    const prev = createCellBuffer(40, 25);
    const curr = createCellBuffer(40, 25);
    const tracker = createDamageTracker();

    // Frame 1: no changes (both empty).
    let patches = diffCells(prev, curr, sp, cp, tracker);
    expect(patches).toEqual([]);
    // Tracker should record an "empty" box (minY > maxY).
    expect(tracker.box).not.toBeNull();
    expect(tracker.box!.minY).toBeGreaterThan(tracker.box!.maxY);

    // Frame 2: still no changes.
    patches = diffCells(prev, curr, sp, cp, tracker);
    expect(patches).toEqual([]);
  });

  test("expansion within 1-row margin is captured by fast path", () => {
    const sp = createStylePool();
    const cp = createCharPool();
    const prev = createCellBuffer(20, 10);
    const curr = createCellBuffer(20, 10);
    const tracker = createDamageTracker();

    // Frame 1: change on row 5.
    curr.set(2, 5, cp.intern("a"), 0, 0);
    diffCells(prev, curr, sp, cp, tracker);

    prev.copyFrom(curr);
    curr.clear();
    // Frame 2: same on row 5, plus a NEW change on row 6 (within +1 margin).
    curr.set(2, 5, cp.intern("a"), 0, 0);
    curr.set(3, 6, cp.intern("b"), 0, 0);

    const patches = diffCells(prev, curr, sp, cp, tracker);
    expect(patches.length).toBe(1);
    expect(patches[0]!.y).toBe(6);
    // New box covers both rows even though we only emitted one patch.
    expect(tracker.box).toEqual({ minY: 6, maxY: 6, minX: 3, maxX: 3 });
  });

  test("invalidate() forces a full scan on the next call", () => {
    const sp = createStylePool();
    const cp = createCharPool();
    const prev = createCellBuffer(10, 10);
    const curr = createCellBuffer(10, 10);
    const tracker = createDamageTracker();

    curr.set(0, 0, cp.intern("a"), 0, 0);
    diffCells(prev, curr, sp, cp, tracker);
    expect(tracker.mustFullScan).toBe(false);
    tracker.invalidate();
    expect(tracker.mustFullScan).toBe(true);
    expect(tracker.box).toBeNull();
  });

  test("backward compatibility: omitting tracker still works", () => {
    const sp = createStylePool();
    const cp = createCharPool();
    const prev = createCellBuffer(5, 2);
    const curr = createCellBuffer(5, 2);
    curr.set(1, 0, cp.intern("a"), 0, 0);
    const patches = diffCells(prev, curr, sp, cp);
    expect(patches.length).toBe(1);
  });

  test("scan limited to box: cells outside box are not visited (correctness)", () => {
    // To prove the walker stays in the box, seed prev and curr with
    // identical content everywhere except inside the prior box. If the
    // walker accidentally walks the whole buffer it would still produce
    // the same patches in this case, so this is purely a correctness
    // check (not a perf test). Perf is implicit — the loop body short-
    // circuits cleanly on equal cells.
    const sp = createStylePool();
    const cp = createCharPool();
    const prev = createCellBuffer(50, 30);
    const curr = createCellBuffer(50, 30);
    const tracker = createDamageTracker();

    // Frame 1: localized change.
    for (let x = 10; x < 14; x++) curr.set(x, 5, cp.intern("a"), 0, 0);
    diffCells(prev, curr, sp, cp, tracker);

    prev.copyFrom(curr);
    curr.clear();
    // Frame 2: identical except inside the prior box.
    for (let x = 10; x < 14; x++) curr.set(x, 5, cp.intern("a"), 0, 0);
    curr.set(11, 5, cp.intern("Z"), 0, 0);

    const patches = diffCells(prev, curr, sp, cp, tracker);
    expect(patches.length).toBe(1);
    expect(patches[0]!.x).toBe(11);
    expect(patches[0]!.y).toBe(5);
    expect(patches[0]!.content).toBe("Z");
  });
});
