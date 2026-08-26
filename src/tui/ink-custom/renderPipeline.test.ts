import { describe, test, expect } from "bun:test";
import {
  createAnsiPatcher,
  createPatchEmitter,
  createRelativeAnsiPatcher,
  type DiffFn,
} from "./renderPipeline.ts";
import type {
  CellBuffer,
  CellWidth,
  CharPool,
  Patch,
  StylePool,
} from "./internal/contracts.ts";
import {
  CELL_CHAR_MASK,
  CELL_STYLE_MASK,
  CELL_STYLE_SHIFT,
  CELL_WIDTH_MASK,
  CELL_WIDTH_SHIFT,
} from "./internal/contracts.ts";

// ---------------------------------------------------------------------------
// Inline Phase 1 stubs - the ANSI patcher and patch emitter code only needs
// the interfaces, so we stub `CellBuffer`, `StylePool`, and `CharPool` with
// Map-backed fakes that honor `contracts.ts`.
// ---------------------------------------------------------------------------
function makeMockCellBuffer(width: number, height: number): CellBuffer {
  const data = new Int32Array(width * height);
  return {
    width,
    height,
    set(
      x: number,
      y: number,
      charIdx: number,
      styleId: number,
      cellWidth: CellWidth,
    ): void {
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
    raw: () => data,
    clear: () => data.fill(0),
    copyFrom(other: CellBuffer) {
      if (other.width !== width || other.height !== height) {
        throw new Error("copyFrom: size mismatch");
      }
      data.set(other.raw());
    },
  };
}

function makeMockStylePool(): StylePool {
  const byId = new Map<number, string>();
  const byStr = new Map<string, number>();
  let next = 1;
  return {
    intern(ansi: string): number {
      const hit = byStr.get(ansi);
      if (hit !== undefined) return hit;
      const id = next++;
      byId.set(id, ansi);
      byStr.set(ansi, id);
      return id;
    },
    get: (id: number) => byId.get(id),
    get size() {
      return byId.size;
    },
    get capacity() {
      return 256;
    },
    stats: () => ({ size: byId.size, capacity: 256 }),
    reset: () => {
      byId.clear();
      byStr.clear();
      next = 1;
    },
  };
}

function makeMockCharPool(): CharPool {
  const byId = new Map<number, string>();
  const byStr = new Map<string, number>();
  let next = 1;
  return {
    intern(s: string): number {
      const hit = byStr.get(s);
      if (hit !== undefined) return hit;
      const id = next++;
      byId.set(id, s);
      byStr.set(s, id);
      return id;
    },
    get: (id: number) => byId.get(id),
    get size() {
      return byId.size;
    },
    get capacity() {
      return 1 << 20;
    },
    stats: () => ({ size: byId.size, capacity: 1 << 20 }),
    reset: () => {
      byId.clear();
      byStr.clear();
      next = 1;
    },
  };
}

describe("createPatchEmitter", () => {
  test("returns no patches for identical buffers", () => {
    const pool = makeMockCharPool();
    const styles = makeMockStylePool();
    const prev = makeMockCellBuffer(4, 2);
    const curr = makeMockCellBuffer(4, 2);
    const emitter = createPatchEmitter();
    const patches = emitter.diff(prev, curr, styles, pool);
    expect(patches).toEqual([]);
  });

  test("diffs a single cell change into one patch", () => {
    const chars = makeMockCharPool();
    const styles = makeMockStylePool();
    const prev = makeMockCellBuffer(4, 2);
    const curr = makeMockCellBuffer(4, 2);
    const idA = chars.intern("A");
    const sId = styles.intern("\x1b[31m");
    // CellWidth=0 -> bits 28-29 = 0 -> visual width = 1 cell (single width).
    curr.set(2, 1, idA, sId, 0);

    const patches = createPatchEmitter().diff(prev, curr, styles, chars);
    expect(patches.length).toBe(1);
    expect(patches[0]).toMatchObject({
      x: 2,
      y: 1,
      content: "A",
      styleId: sId,
    });
  });

  test("merges consecutive same-style changes on one row", () => {
    const chars = makeMockCharPool();
    const styles = makeMockStylePool();
    const prev = makeMockCellBuffer(6, 1);
    const curr = makeMockCellBuffer(6, 1);
    const h = chars.intern("h");
    const i = chars.intern("i");
    const sId = styles.intern("\x1b[32m");
    curr.set(1, 0, h, sId, 0);
    curr.set(2, 0, i, sId, 0);

    const patches = createPatchEmitter().diff(prev, curr, styles, chars);
    expect(patches.length).toBe(1);
    expect(patches[0]).toMatchObject({
      x: 1,
      y: 0,
      content: "hi",
      styleId: sId,
      visualWidth: 2,
    });
  });

  test("splits runs on style change", () => {
    const chars = makeMockCharPool();
    const styles = makeMockStylePool();
    const prev = makeMockCellBuffer(4, 1);
    const curr = makeMockCellBuffer(4, 1);
    const a = chars.intern("a");
    const b = chars.intern("b");
    const s1 = styles.intern("\x1b[31m");
    const s2 = styles.intern("\x1b[32m");
    curr.set(0, 0, a, s1, 0);
    curr.set(1, 0, b, s2, 0);

    const patches = createPatchEmitter().diff(prev, curr, styles, chars);
    expect(patches.length).toBe(2);
    expect(patches[0]).toMatchObject({ x: 0, y: 0, content: "a", styleId: s1 });
    expect(patches[1]).toMatchObject({ x: 1, y: 0, content: "b", styleId: s2 });
  });

  test("delegates to a provided diffFn when supplied", () => {
    let called = 0;
    const custom: DiffFn = () => {
      called++;
      return [
        { x: 0, y: 0, content: "X", visualWidth: 1, styleId: -1 },
      ];
    };
    const emitter = createPatchEmitter(custom);
    const prev = makeMockCellBuffer(2, 2);
    const curr = makeMockCellBuffer(2, 2);
    const out = emitter.diff(prev, curr, makeMockStylePool(), makeMockCharPool());
    expect(called).toBe(1);
    expect(out.length).toBe(1);
    expect(out[0]?.content).toBe("X");
  });
});

describe("createAnsiPatcher", () => {
  test("empty patch list yields empty string", () => {
    const patcher = createAnsiPatcher();
    expect(patcher.write([], makeMockStylePool(), makeMockCharPool())).toBe("");
  });

  test("serializes a single patch with expected CUP + SGR + reset", () => {
    // Spec example: patch at (y=5, x=3), content "hi", styleId=7,
    // stylePool.get(7) -> "\x1b[32m". Expect "\x1b[6;4H\x1b[32mhi" + reset.
    const styles: StylePool = {
      intern: () => 7,
      get: (id: number) => (id === 7 ? "\x1b[32m" : undefined),
      size: 1,
      capacity: 256,
      stats: () => ({ size: 1, capacity: 256 }),
      reset: () => {},
    };
    const chars = makeMockCharPool();
    const patcher = createAnsiPatcher();
    const out = patcher.write(
      [{ x: 3, y: 5, content: "hi", visualWidth: 2, styleId: 7 }],
      styles,
      chars,
    );
    expect(out).toBe("\x1b[6;4H\x1b[32mhi\x1b[0m");
  });

  test("sorts patches by (row, col) and emits cursor moves at boundaries", () => {
    const styles = makeMockStylePool();
    const chars = makeMockCharPool();
    const redId = styles.intern("\x1b[31m");
    const patches: Patch[] = [
      // Intentionally out of order - patcher must sort.
      { x: 0, y: 2, content: "c", visualWidth: 1, styleId: redId },
      { x: 5, y: 0, content: "b", visualWidth: 1, styleId: redId },
      { x: 0, y: 0, content: "a", visualWidth: 1, styleId: redId },
    ];
    const out = createAnsiPatcher().write(patches, styles, chars);
    // Expected sequence:
    //   (0,0) cursor + style + 'a'
    //   (0,5) cursor (gap of 4 cells) + 'b'  - style unchanged
    //   (2,0) cursor + 'c'
    //   reset
    const expected =
      "\x1b[1;1H\x1b[31ma" +
      "\x1b[1;6Hb" +
      "\x1b[3;1Hc" +
      "\x1b[0m";
    expect(out).toBe(expected);
  });

  test("omits SGR reset when no style was ever applied", () => {
    const styles = makeMockStylePool();
    const chars = makeMockCharPool();
    const out = createAnsiPatcher().write(
      [{ x: 0, y: 0, content: "x", visualWidth: 1, styleId: -1 }],
      styles,
      chars,
    );
    expect(out).toBe("\x1b[1;1Hx");
  });

  test("re-emits style only when styleId changes", () => {
    const styles: StylePool = {
      intern: () => 1,
      get(id: number) {
        if (id === 1) return "\x1b[31m";
        if (id === 2) return "\x1b[32m";
        return undefined;
      },
      size: 2,
      capacity: 256,
      stats: () => ({ size: 2, capacity: 256 }),
      reset: () => {},
    };
    const chars = makeMockCharPool();
    const patches: Patch[] = [
      { x: 0, y: 0, content: "a", visualWidth: 1, styleId: 1 },
      { x: 1, y: 0, content: "b", visualWidth: 1, styleId: 1 },
      { x: 2, y: 0, content: "c", visualWidth: 1, styleId: 2 },
    ];
    const out = createAnsiPatcher().write(patches, styles, chars);
    // 'a' with red, 'b' inline (no new SGR, cursor continues). When 'c''s
    // style changes from red to green, SGR_RESET is emitted first so the
    // red attributes don't bleed into anything downstream.
    expect(out).toBe("\x1b[1;1H\x1b[31mab\x1b[0m\x1b[32mc\x1b[0m");
  });

  test("emits SGR_RESET when transitioning from styled to neutral run", () => {
    const styles: StylePool = {
      intern: () => 1,
      get: (id: number) => (id === 1 ? "\x1b[31m" : id === 2 ? "" : undefined),
      size: 2,
      capacity: 256,
      stats: () => ({ size: 2, capacity: 256 }),
      reset: () => {},
    };
    const chars = makeMockCharPool();
    const patches: Patch[] = [
      { x: 0, y: 0, content: "a", visualWidth: 1, styleId: 1 }, // red
      { x: 1, y: 0, content: "b", visualWidth: 1, styleId: 2 }, // neutral (empty style)
    ];
    const out = createAnsiPatcher().write(patches, styles, chars);
    // Red 'a', then reset before the empty-style run, then 'b', then no
    // trailing reset (styleUsed was cleared on the transition).
    expect(out).toBe("\x1b[1;1H\x1b[31ma\x1b[0mb");
  });
});

describe("createRelativeAnsiPatcher", () => {
  test("empty patch list yields empty string", () => {
    const patcher = createRelativeAnsiPatcher();
    expect(patcher.write([], makeMockStylePool(), makeMockCharPool(), 3)).toBe(
      "",
    );
  });

  test("single patch at (y=0, x=0) with previousFrameHeight=3 emits pull-back + content + restore", () => {
    // Emission walk:
    //   * Pull-back: cursorUp(3) + \r lands at frame top-left anchor.
    //   * Patch (y=0, x=0): already at anchor, no cursor move. styleId=-1,
    //     no SGR. Write "X". Cursor now at col 1 of row 0 (relative).
    //   * Restore: downBy = 3 - 0 = 3 → cursorDown(3) + \r puts us back
    //     on the "line below frame" invariant at col 0.
    const styles = makeMockStylePool();
    const chars = makeMockCharPool();
    const patcher = createRelativeAnsiPatcher();
    const out = patcher.write(
      [{ x: 0, y: 0, content: "X", visualWidth: 1, styleId: -1 }],
      styles,
      chars,
      3,
    );
    expect(out).toBe("\x1b[3A\rX\x1b[3B\r");
  });

  test("two patches on same row separated by gap emits cursorForward(gap)", () => {
    // Patch A at (y=1, x=2) "aa" (visualWidth=2). After write: cursor at
    // (row=1, col=4). Patch B at (y=1, x=5) "bb". Gap in column space:
    // 5 - 4 = 1 → cursorForward(1) before writing "bb".
    const styles = makeMockStylePool();
    const chars = makeMockCharPool();
    const patcher = createRelativeAnsiPatcher();
    const patches: Patch[] = [
      { x: 2, y: 1, content: "aa", visualWidth: 2, styleId: -1 },
      { x: 5, y: 1, content: "bb", visualWidth: 2, styleId: -1 },
    ];
    const out = patcher.write(patches, styles, chars, 3);
    // Walk:
    //   Pull-back: \x1b[3A + \r
    //   Patch A cross-row (rowDelta=1): \x1b[1B + \r + \x1b[2C + "aa"
    //   Patch B same-row (colDelta=1): \x1b[1C + "bb"
    //   Restore (downBy = 3 - 1 = 2): \x1b[2B + \r
    expect(out).toBe("\x1b[3A\r\x1b[1B\r\x1b[2Caa\x1b[1Cbb\x1b[2B\r");
  });

  test("two patches on different rows emits cursorDown(rowDelta) + \\r + cursorForward(x)", () => {
    // Patch A at (y=0, x=0) "a" — no movement from anchor, write "a".
    // Patch B at (y=2, x=4) "b" — rowDelta=2 → cursorDown(2) + \r +
    // cursorForward(4) + "b". Restore downBy = 3 - 2 = 1.
    const styles = makeMockStylePool();
    const chars = makeMockCharPool();
    const patcher = createRelativeAnsiPatcher();
    const patches: Patch[] = [
      { x: 0, y: 0, content: "a", visualWidth: 1, styleId: -1 },
      { x: 4, y: 2, content: "b", visualWidth: 1, styleId: -1 },
    ];
    const out = patcher.write(patches, styles, chars, 3);
    expect(out).toBe("\x1b[3A\ra\x1b[2B\r\x1b[4Cb\x1b[1B\r");
  });

  test("adjacent same-row patches do not emit cursor movement between them", () => {
    // Patch A at (y=0, x=0) "ab" (visualWidth=2). Cursor ends at col 2.
    // Patch B at (y=0, x=2) "cd" — colDelta = 0, no cursor move.
    const styles = makeMockStylePool();
    const chars = makeMockCharPool();
    const patcher = createRelativeAnsiPatcher();
    const patches: Patch[] = [
      { x: 0, y: 0, content: "ab", visualWidth: 2, styleId: -1 },
      { x: 2, y: 0, content: "cd", visualWidth: 2, styleId: -1 },
    ];
    const out = patcher.write(patches, styles, chars, 3);
    // No CSI sequence should appear between "ab" and "cd".
    expect(out).toBe("\x1b[3A\rabcd\x1b[3B\r");
  });

  test("sorts out-of-order patches by (y, x) before emitting", () => {
    const styles = makeMockStylePool();
    const chars = makeMockCharPool();
    const patcher = createRelativeAnsiPatcher();
    // Intentionally reversed.
    const patches: Patch[] = [
      { x: 4, y: 2, content: "b", visualWidth: 1, styleId: -1 },
      { x: 0, y: 0, content: "a", visualWidth: 1, styleId: -1 },
    ];
    const out = patcher.write(patches, styles, chars, 3);
    // Same as the cross-row test above — sort puts 'a' first.
    expect(out).toBe("\x1b[3A\ra\x1b[2B\r\x1b[4Cb\x1b[1B\r");
  });

  test("emits style sequences with reset between styles (same semantics as absolute patcher)", () => {
    const styles: StylePool = {
      intern: () => 1,
      get(id: number) {
        if (id === 1) return "\x1b[31m";
        if (id === 2) return "\x1b[32m";
        return undefined;
      },
      size: 2,
      capacity: 256,
      stats: () => ({ size: 2, capacity: 256 }),
      reset: () => {},
    };
    const chars = makeMockCharPool();
    const patches: Patch[] = [
      { x: 0, y: 0, content: "a", visualWidth: 1, styleId: 1 },
      { x: 1, y: 0, content: "b", visualWidth: 1, styleId: 2 },
    ];
    const patcher = createRelativeAnsiPatcher();
    const out = patcher.write(patches, styles, chars, 3);
    // Walk:
    //   Pull-back \x1b[3A\r
    //   Patch A (y=0, x=0): no cursor move, styleId=1 → emit "\x1b[31m",
    //     write "a". styleUsed=true.
    //   Patch B (y=0, x=1): colDelta=0 (a was 1 cell wide, currentCol=1).
    //     styleId=2 → reset + emit "\x1b[32m", write "b".
    //   Trailing reset since styleUsed.
    //   Restore \x1b[3B\r.
    expect(out).toBe("\x1b[3A\r\x1b[31ma\x1b[0m\x1b[32mb\x1b[0m\x1b[3B\r");
  });

  test("previousFrameHeight=0 edge case still emits \\r anchor and restore", () => {
    // When the previous frame was 0 rows (e.g., first incremental paint on
    // top of an empty frame), there is no prior row to move over. The caller
    // still gets a carriage-return anchor and restore.
    const styles = makeMockStylePool();
    const chars = makeMockCharPool();
    const patcher = createRelativeAnsiPatcher();
    const out = patcher.write(
      [{ x: 0, y: 0, content: "X", visualWidth: 1, styleId: -1 }],
      styles,
      chars,
      0,
    );
    expect(out).toBe("\rX\r");
  });

  test("negative previousFrameHeight is clamped defensively", () => {
    // Defensive path — caller bug passing a negative height shouldn't crash
    // or emit a malformed CSI. Pull-back clamps to 0, no cursorUp emitted.
    const styles = makeMockStylePool();
    const chars = makeMockCharPool();
    const patcher = createRelativeAnsiPatcher();
    const out = patcher.write(
      [{ x: 0, y: 0, content: "X", visualWidth: 1, styleId: -1 }],
      styles,
      chars,
      -5,
    );
    // pullBack = 0 → no cursorUp, but still \r. Restore downBy = 0 → no
    // cursorDown, still \r.
    expect(out).toBe("\rX\r");
  });
});
