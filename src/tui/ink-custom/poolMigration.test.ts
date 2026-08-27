import { describe, expect, test } from "bun:test";

import { createPoolMigrator, type MigrationContext } from "./poolMigration.ts";
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
  type CharPool,
  type HyperlinkPool,
  type PoolStats,
  type StylePool,
} from "./internal/contracts.ts";

// ---------------------------------------------------------------------------
// Inline fakes that satisfy the Phase 1/4 pool contracts. Simple Maps with
// sequential IDs and no LRU — we don't need eviction semantics here, we're
// only exercising the migrator.
// ---------------------------------------------------------------------------

function makeFakeStringPool(capacity: number): CharPool & { __tag: "char" } {
  const strToId = new Map<string, number>();
  const idToStr = new Map<number, string>();
  let nextId = 0;
  const pool: CharPool = {
    intern(s) {
      const existing = strToId.get(s);
      if (existing !== undefined) return existing;
      const id = nextId++;
      strToId.set(s, id);
      idToStr.set(id, s);
      return id;
    },
    get(id) {
      return idToStr.get(id);
    },
    get size() {
      return strToId.size;
    },
    get capacity() {
      return capacity;
    },
    stats(): PoolStats {
      return { size: strToId.size, capacity };
    },
    reset() {
      strToId.clear();
      idToStr.clear();
      nextId = 0;
    },
  };
  return Object.assign(pool, { __tag: "char" as const });
}

function makeFakeStylePool(capacity: number): StylePool & { __tag: "style" } {
  const strToId = new Map<string, number>();
  const idToStr = new Map<number, string>();
  let nextId = 0;
  const pool: StylePool = {
    intern(ansi) {
      const existing = strToId.get(ansi);
      if (existing !== undefined) return existing;
      const id = nextId++;
      strToId.set(ansi, id);
      idToStr.set(id, ansi);
      return id;
    },
    get(id) {
      return idToStr.get(id);
    },
    get size() {
      return strToId.size;
    },
    get capacity() {
      return capacity;
    },
    stats(): PoolStats {
      return { size: strToId.size, capacity };
    },
    reset() {
      strToId.clear();
      idToStr.clear();
      nextId = 0;
    },
  };
  return Object.assign(pool, { __tag: "style" as const });
}

function makeFakeHyperlinkPool(capacity: number): HyperlinkPool & { __tag: "hyperlink" } {
  const urlToId = new Map<string, number>();
  const idToUrl = new Map<number, string>();
  let nextId = 0;
  const pool: HyperlinkPool = {
    intern(url) {
      const existing = urlToId.get(url);
      if (existing !== undefined) return existing;
      const id = nextId++;
      urlToId.set(url, id);
      idToUrl.set(id, url);
      return id;
    },
    get(id) {
      return idToUrl.get(id);
    },
    get size() {
      return urlToId.size;
    },
    get capacity() {
      return capacity;
    },
    stats(): PoolStats {
      return { size: urlToId.size, capacity };
    },
    reset() {
      urlToId.clear();
      idToUrl.clear();
      nextId = 0;
    },
  };
  return Object.assign(pool, { __tag: "hyperlink" as const });
}

// Simple Int32Array-backed cell buffer — same packing as the real one but
// without bounds/domain checks, just enough to exercise the migrator.
function makeFakeCellBuffer(width: number, height: number): CellBuffer {
  const data = new Int32Array(width * height);
  const buf: CellBuffer = {
    width,
    height,
    set(x, y, charIdx, styleId, cellWidth) {
      const packed =
        (charIdx & CELL_CHAR_MASK) |
        ((styleId & CELL_STYLE_MASK) << CELL_STYLE_SHIFT) |
        ((cellWidth & CELL_WIDTH_MASK) << CELL_WIDTH_SHIFT) |
        CELL_DIRTY_BIT;
      data[y * width + x] = packed;
    },
    get(x, y): Cell {
      const packed = data[y * width + x] ?? 0;
      return {
        charIdx: packed & CELL_CHAR_MASK,
        styleId: (packed >>> CELL_STYLE_SHIFT) & CELL_STYLE_MASK,
        width: ((packed >>> CELL_WIDTH_SHIFT) & CELL_WIDTH_MASK) as CellWidth,
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
        throw new Error("copyFrom size mismatch");
      }
      data.set(other.raw());
    },
  };
  return buf;
}

function makeContext(): MigrationContext & {
  charCapacity: number;
  styleCapacity: number;
  hyperlinkCapacity: number;
} {
  return {
    charCapacity: 1 << 20,
    styleCapacity: 256,
    hyperlinkCapacity: 256,
    createCharPool: (cap) => makeFakeStringPool(cap ?? 1 << 20),
    createStylePool: (cap) => makeFakeStylePool(cap ?? 256),
    createHyperlinkPool: (cap) => makeFakeHyperlinkPool(cap ?? 256),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("poolMigration.captureSnapshot", () => {
  test("collects every char/style ID referenced by the front frame", () => {
    const ctx = makeContext();
    const migrator = createPoolMigrator(ctx);

    const frame = makeFakeCellBuffer(4, 2);
    // Cell (0,0): char=3, style=7
    frame.set(0, 0, 3, 7, 1);
    // Cell (1,0): char=42, style=1
    frame.set(1, 0, 42, 1, 1);
    // Cell (2,0): char=3 (dup), style=9
    frame.set(2, 0, 3, 9, 1);
    // Cell (0,1): char=0, style=0 — the empty/blank cell
    frame.set(0, 1, 0, 0, 1);

    const hyperlinkPool = ctx.createHyperlinkPool();
    hyperlinkPool.intern("https://a.com");
    hyperlinkPool.intern("https://b.com");

    const snap = migrator.captureSnapshot(frame, hyperlinkPool);

    // Live chars should include {0, 3, 42} (0 from the blank cell plus the
    // all-zero half of the buffer; 3 twice dedups).
    expect(snap.liveChars.has(0)).toBe(true);
    expect(snap.liveChars.has(3)).toBe(true);
    expect(snap.liveChars.has(42)).toBe(true);
    expect(snap.liveChars.size).toBe(3);

    // Live styles: {0, 1, 7, 9}.
    expect(snap.liveStyles.has(0)).toBe(true);
    expect(snap.liveStyles.has(1)).toBe(true);
    expect(snap.liveStyles.has(7)).toBe(true);
    expect(snap.liveStyles.has(9)).toBe(true);
    expect(snap.liveStyles.size).toBe(4);

    // Hyperlinks: every currently-interned ID is considered live.
    expect(snap.liveHyperlinks.size).toBe(2);
  });

  test("returns an empty hyperlink set when the hyperlink pool has no entries", () => {
    const ctx = makeContext();
    const migrator = createPoolMigrator(ctx);
    const frame = makeFakeCellBuffer(1, 1);
    const hyperlinkPool = ctx.createHyperlinkPool();

    const snap = migrator.captureSnapshot(frame, hyperlinkPool);
    expect(snap.liveHyperlinks.size).toBe(0);
  });
});

describe("poolMigration.rebase", () => {
  test("produces fresh pools containing only live items with sequential IDs from 0", () => {
    const ctx = makeContext();
    const migrator = createPoolMigrator(ctx);

    const charPool = ctx.createCharPool();
    const idA = charPool.intern("A");
    const idB = charPool.intern("B");
    const idC = charPool.intern("C");

    const stylePool = ctx.createStylePool();
    const sX = stylePool.intern("\x1b[31m");
    const sY = stylePool.intern("\x1b[32m");
    const sZ = stylePool.intern("\x1b[33m");

    const hyperlinkPool = ctx.createHyperlinkPool();
    const hP = hyperlinkPool.intern("https://p.com");
    const hQ = hyperlinkPool.intern("https://q.com");

    // Build a frame that uses A (not B) and C, with styles X and Z.
    const frame = makeFakeCellBuffer(2, 1);
    frame.set(0, 0, idA, sX, 1);
    frame.set(1, 0, idC, sZ, 1);

    const snap = migrator.captureSnapshot(frame, hyperlinkPool);
    // Sanity: B and Y are NOT in the snapshot.
    expect(snap.liveChars.has(idB)).toBe(false);
    expect(snap.liveStyles.has(sY)).toBe(false);
    // Both hyperlinks get flagged live (conservative snapshot).
    expect(snap.liveHyperlinks.has(hP)).toBe(true);
    expect(snap.liveHyperlinks.has(hQ)).toBe(true);

    const { newCharPool, newStylePool, newHyperlinkPool, remapping } = migrator.rebase(
      snap,
      charPool,
      stylePool,
      hyperlinkPool,
    );

    // New char pool contains only "A" and "C" (plus the blank/empty id 0
    // from the second half of the frame — but frame is 2x1 with both cells
    // painted, so no id=0 appears). Size should be exactly 2.
    expect(newCharPool.size).toBe(2);
    expect(newStylePool.size).toBe(2);
    expect(newHyperlinkPool.size).toBe(2);

    // Sequential IDs from 0: first interned item gets 0, second gets 1.
    // Ordering is by ascending OLD ID, so idA (old) -> 0 and idC (old) -> 1.
    const newIdA = remapping.chars.get(idA);
    const newIdC = remapping.chars.get(idC);
    expect(newIdA).toBe(0);
    expect(newIdC).toBe(1);
    expect(newCharPool.get(newIdA!)).toBe("A");
    expect(newCharPool.get(newIdC!)).toBe("C");

    const newSX = remapping.styles.get(sX);
    const newSZ = remapping.styles.get(sZ);
    expect(newSX).toBe(0);
    expect(newSZ).toBe(1);
    expect(newStylePool.get(newSX!)).toBe("\x1b[31m");
    expect(newStylePool.get(newSZ!)).toBe("\x1b[33m");

    // Evicted items must be absent from remapping.
    expect(remapping.chars.has(idB)).toBe(false);
    expect(remapping.styles.has(sY)).toBe(false);

    // Hyperlink remapping covers both (conservative).
    expect(remapping.hyperlinks.size).toBe(2);
    expect(newHyperlinkPool.get(remapping.hyperlinks.get(hP)!)).toBe("https://p.com");
    expect(newHyperlinkPool.get(remapping.hyperlinks.get(hQ)!)).toBe("https://q.com");
  });

  test("skips snapshot IDs that no longer resolve in the old pool", () => {
    const ctx = makeContext();
    const migrator = createPoolMigrator(ctx);

    const charPool = ctx.createCharPool();
    const idA = charPool.intern("A");

    const stylePool = ctx.createStylePool();
    const sX = stylePool.intern("\x1b[31m");

    const hyperlinkPool = ctx.createHyperlinkPool();

    // Fabricate a snapshot that references a stale id (999) alongside idA.
    const snap = {
      liveChars: new Set<number>([idA, 999]),
      liveStyles: new Set<number>([sX]),
      liveHyperlinks: new Set<number>([42]),
    };

    const { newCharPool, remapping } = migrator.rebase(snap, charPool, stylePool, hyperlinkPool);

    // Stale ids are dropped; only the resolvable one lands in the new pool.
    expect(newCharPool.size).toBe(1);
    expect(remapping.chars.has(999)).toBe(false);
    expect(remapping.hyperlinks.has(42)).toBe(false);
  });
});

describe("poolMigration.applyRemapping", () => {
  test("rewrites cells with the new IDs while preserving width and dirty", () => {
    const ctx = makeContext();
    const migrator = createPoolMigrator(ctx);

    const charPool = ctx.createCharPool();
    const idA = charPool.intern("A");
    const idB = charPool.intern("B");

    const stylePool = ctx.createStylePool();
    const sX = stylePool.intern("\x1b[31m");
    const sY = stylePool.intern("\x1b[32m");

    const hyperlinkPool = ctx.createHyperlinkPool();

    const frame = makeFakeCellBuffer(2, 1);
    // First cell uses double-width to verify width preservation.
    frame.set(0, 0, idA, sX, 2);
    frame.set(1, 0, idB, sY, 1);

    // Manually clear dirty bit on cell 1 to verify the dirty bit survives.
    const raw = frame.raw();
    raw[1] = (raw[1] ?? 0) & ~CELL_DIRTY_BIT;

    const snap = migrator.captureSnapshot(frame, hyperlinkPool);
    const { remapping } = migrator.rebase(snap, charPool, stylePool, hyperlinkPool);

    migrator.applyRemapping(frame, remapping);

    const c0 = frame.get(0, 0);
    const c1 = frame.get(1, 0);

    expect(c0.charIdx).toBe(remapping.chars.get(idA)!);
    expect(c0.styleId).toBe(remapping.styles.get(sX)!);
    expect(c0.width).toBe(2);
    expect(c0.dirty).toBe(true);

    expect(c1.charIdx).toBe(remapping.chars.get(idB)!);
    expect(c1.styleId).toBe(remapping.styles.get(sY)!);
    expect(c1.width).toBe(1);
    expect(c1.dirty).toBe(false);
  });

  test("falls back to ID 0 when a lookup misses (shouldn't happen but must not corrupt)", () => {
    const ctx = makeContext();
    const migrator = createPoolMigrator(ctx);

    const frame = makeFakeCellBuffer(1, 1);
    frame.set(0, 0, 77, 88, 1);

    // Empty remapping — simulates a programming error where the snapshot
    // didn't cover every live ID.
    const remapping = {
      chars: new Map<number, number>(),
      styles: new Map<number, number>(),
      hyperlinks: new Map<number, number>(),
    };

    // Swallow any dev-mode console.warn so test output stays clean.
    const origWarn = console.warn;
    console.warn = () => {};
    try {
      migrator.applyRemapping(frame, remapping);
    } finally {
      console.warn = origWarn;
    }

    const c = frame.get(0, 0);
    expect(c.charIdx).toBe(0);
    expect(c.styleId).toBe(0);
    expect(c.width).toBe(1);
    expect(c.dirty).toBe(true); // dirty bit preserved
  });

  test("end-to-end: snapshot -> rebase -> applyRemapping round-trips content", () => {
    const ctx = makeContext();
    const migrator = createPoolMigrator(ctx);

    const charPool = ctx.createCharPool();
    const stylePool = ctx.createStylePool();
    const hyperlinkPool = ctx.createHyperlinkPool();

    // Create some noise (unused ids) then the live content.
    charPool.intern("unused1");
    charPool.intern("unused2");
    const idH = charPool.intern("H");
    const idI = charPool.intern("I");
    stylePool.intern("\x1b[100m"); // unused
    const sR = stylePool.intern("\x1b[31m");

    const frame = makeFakeCellBuffer(2, 1);
    frame.set(0, 0, idH, sR, 1);
    frame.set(1, 0, idI, sR, 1);

    const snap = migrator.captureSnapshot(frame, hyperlinkPool);
    const { newCharPool, newStylePool, remapping } = migrator.rebase(
      snap,
      charPool,
      stylePool,
      hyperlinkPool,
    );

    migrator.applyRemapping(frame, remapping);

    // Decoding cell (0,0) through the NEW pools should still resolve to H.
    const c0 = frame.get(0, 0);
    expect(newCharPool.get(c0.charIdx)).toBe("H");
    expect(newStylePool.get(c0.styleId)).toBe("\x1b[31m");

    const c1 = frame.get(1, 0);
    expect(newCharPool.get(c1.charIdx)).toBe("I");
    expect(newStylePool.get(c1.styleId)).toBe("\x1b[31m");

    // New pools should be strictly smaller than the old ones (garbage
    // collected "unused1", "unused2", and "\x1b[100m").
    expect(newCharPool.size).toBeLessThan(charPool.size);
    expect(newStylePool.size).toBeLessThan(stylePool.size);
  });
});

describe("createPoolMigrator construction", () => {
  test("rejects a context missing any of the three factories", () => {
    const good = makeContext();
    expect(() =>
      createPoolMigrator({
        ...good,
        createCharPool: undefined as unknown as MigrationContext["createCharPool"],
      }),
    ).toThrow();
    expect(() =>
      createPoolMigrator({
        ...good,
        createStylePool: undefined as unknown as MigrationContext["createStylePool"],
      }),
    ).toThrow();
    expect(() =>
      createPoolMigrator({
        ...good,
        createHyperlinkPool: undefined as unknown as MigrationContext["createHyperlinkPool"],
      }),
    ).toThrow();
  });
});
