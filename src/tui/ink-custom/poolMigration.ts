/**
 * poolMigration — Phase 6 reconciler module.
 *
 * Active in customRender. Compacts the string pools (chars, styles) and
 * the Phase 4 hyperlink pool by rebuilding them with only the items still
 * referenced by the current front frame. Runs periodically (see
 * migrationScheduler) so long-running Gordon sessions don't grow unbounded
 * from historical graphemes / ANSI combinations / hyperlink URLs that have
 * scrolled off the screen.
 *
 * How it's used:
 *   1. captureSnapshot(frontFrame, hyperlinkPool) — walks the raw Int32Array
 *      and records the char/style IDs still in use. Because hyperlink IDs
 *      are NOT packed into cells in the current contract (cells only hold
 *      charIdx | styleId | width | dirty), we take a conservative snapshot
 *      of all currently-interned hyperlink IDs. The reconciler may tighten
 *      this later by keeping a separate live-hyperlink-ref set; when that
 *      lands, the snapshot call site passes the pre-filtered pool.
 *   2. rebase(snapshot, ...) — constructs fresh pools via the factories
 *      supplied at migrator creation, re-interns live items in a stable
 *      order, and returns a remapping from old->new IDs for each pool.
 *   3. applyRemapping(frame, remapping) — rewrites every cell in `frame`
 *      so its char/style IDs point at the new pool positions.
 *
 * Factory deviation (documented):
 *   The contracts.ts signature for `rebase` doesn't accept factories, but
 *   with no concrete dependency on Phase 1/4 modules (they're being built
 *   in parallel), we need *some* way to materialize fresh pools. We keep
 *   the `PoolMigrator` interface from contracts.ts untouched; instead,
 *   `createPoolMigrator` accepts a `MigrationContext` with the three
 *   factory callables. The contract-level call surface stays stable.
 */

import {
  CELL_CHAR_MASK,
  CELL_DIRTY_BIT,
  CELL_STYLE_MASK,
  CELL_STYLE_SHIFT,
  CELL_WIDTH_MASK,
  CELL_WIDTH_SHIFT,
  type CellBuffer,
  type CharPool,
  type HyperlinkPool,
  type PoolMigrator,
  type PoolSnapshot,
  type RemappingTable,
  type StylePool,
} from "./internal/contracts.ts";

/**
 * Context passed to createPoolMigrator — exposes the factory functions for
 * the three pool kinds. Keeps the migrator decoupled from the concrete
 * Phase 1/4 modules so they can be built and tested independently.
 */
export interface MigrationContext {
  createCharPool: (capacity?: number) => CharPool;
  createStylePool: (capacity?: number) => StylePool;
  createHyperlinkPool: (capacity?: number) => HyperlinkPool;
}

export function createPoolMigrator(context: MigrationContext): PoolMigrator {
  if (
    typeof context.createCharPool !== "function" ||
    typeof context.createStylePool !== "function" ||
    typeof context.createHyperlinkPool !== "function"
  ) {
    throw new Error(
      "createPoolMigrator: context must provide all three pool factory functions",
    );
  }

  function captureSnapshot(
    frontFrame: CellBuffer,
    hyperlinkPool: HyperlinkPool,
  ): PoolSnapshot {
    const liveChars = new Set<number>();
    const liveStyles = new Set<number>();

    const raw = frontFrame.raw();
    const len = raw.length;
    for (let i = 0; i < len; i++) {
      const cell = raw[i] ?? 0;
      // Zero-packed cells represent the canonical "empty" (charIdx=0,
      // styleId=0) — we still record IDs 0 as live so the remapping never
      // drops them. That keeps the blank-cell glyph + empty-style usable.
      const charIdx = cell & CELL_CHAR_MASK;
      const styleId = (cell >>> CELL_STYLE_SHIFT) & CELL_STYLE_MASK;
      liveChars.add(charIdx);
      liveStyles.add(styleId);
    }

    // Hyperlink IDs are not packed into cells by the current contract, so
    // we conservatively treat every currently-interned hyperlink as live.
    // The reconciler will refine this once a dedicated live-hyperlink-ref
    // set exists.
    const liveHyperlinks = new Set<number>();
    for (let id = 0; id < hyperlinkPool.capacity; id++) {
      if (hyperlinkPool.get(id) !== undefined) {
        liveHyperlinks.add(id);
      }
    }

    return { liveChars, liveStyles, liveHyperlinks };
  }

  function rebase(
    snapshot: PoolSnapshot,
    charPool: CharPool,
    stylePool: StylePool,
    hyperlinkPool: HyperlinkPool,
  ): {
    newCharPool: CharPool;
    newStylePool: StylePool;
    newHyperlinkPool: HyperlinkPool;
    remapping: RemappingTable;
  } {
    const newCharPool = context.createCharPool(charPool.capacity);
    const newStylePool = context.createStylePool(stylePool.capacity);
    const newHyperlinkPool = context.createHyperlinkPool(hyperlinkPool.capacity);

    // Fresh pools arrive with baseline entries (e.g., ASCII/box chars, the
    // ANSI SGR baselines). Wipe them to guarantee sequential IDs starting
    // from zero — callers rely on this for the remapping table invariant.
    newCharPool.reset();
    newStylePool.reset();
    newHyperlinkPool.reset();

    const chars = new Map<number, number>();
    const styles = new Map<number, number>();
    const hyperlinks = new Map<number, number>();

    // Intern in ascending order of the OLD ID so the new IDs are stable
    // and deterministic across runs (and so tests can assert them).
    const sortedCharIds = Array.from(snapshot.liveChars).sort((a, b) => a - b);
    for (const oldId of sortedCharIds) {
      const s = charPool.get(oldId);
      if (s === undefined) continue; // stale ID — skip, remapping will miss.
      const newId = newCharPool.intern(s);
      chars.set(oldId, newId);
    }

    const sortedStyleIds = Array.from(snapshot.liveStyles).sort((a, b) => a - b);
    for (const oldId of sortedStyleIds) {
      const s = stylePool.get(oldId);
      if (s === undefined) continue;
      const newId = newStylePool.intern(s);
      styles.set(oldId, newId);
    }

    const sortedHyperlinkIds = Array.from(snapshot.liveHyperlinks).sort(
      (a, b) => a - b,
    );
    for (const oldId of sortedHyperlinkIds) {
      const url = hyperlinkPool.get(oldId);
      if (url === undefined) continue;
      const newId = newHyperlinkPool.intern(url);
      hyperlinks.set(oldId, newId);
    }

    return {
      newCharPool,
      newStylePool,
      newHyperlinkPool,
      remapping: { chars, styles, hyperlinks },
    };
  }

  function applyRemapping(frame: CellBuffer, remapping: RemappingTable): void {
    const raw = frame.raw();
    const len = raw.length;

    // Lookup misses shouldn't happen in production — captureSnapshot is
    // supposed to be taken from the SAME frame we remap. If we miss, fall
    // back to ID 0 so the output is renderable (blank glyph / empty style).
    // In dev we warn so integration bugs surface fast.
    const isDev =
      (typeof process !== "undefined" &&
        process.env?.NODE_ENV !== "production") ||
      false;

    for (let i = 0; i < len; i++) {
      const cell = raw[i] ?? 0;
      const oldCharIdx = cell & CELL_CHAR_MASK;
      const oldStyleId = (cell >>> CELL_STYLE_SHIFT) & CELL_STYLE_MASK;
      const width = (cell >>> CELL_WIDTH_SHIFT) & CELL_WIDTH_MASK;
      const dirtyBit = cell & CELL_DIRTY_BIT;

      let newCharIdx = remapping.chars.get(oldCharIdx);
      if (newCharIdx === undefined) {
        if (isDev) {
          // eslint-disable-next-line no-console
          console.warn(
            `poolMigration.applyRemapping: missing char remap for id ${oldCharIdx} at cell ${i}; falling back to 0`,
          );
        }
        newCharIdx = 0;
      }

      let newStyleId = remapping.styles.get(oldStyleId);
      if (newStyleId === undefined) {
        if (isDev) {
          // eslint-disable-next-line no-console
          console.warn(
            `poolMigration.applyRemapping: missing style remap for id ${oldStyleId} at cell ${i}; falling back to 0`,
          );
        }
        newStyleId = 0;
      }

      const packed =
        (newCharIdx & CELL_CHAR_MASK) |
        ((newStyleId & CELL_STYLE_MASK) << CELL_STYLE_SHIFT) |
        ((width & CELL_WIDTH_MASK) << CELL_WIDTH_SHIFT) |
        dirtyBit;

      raw[i] = packed;
    }
  }

  const migrator: PoolMigrator = {
    captureSnapshot,
    rebase,
    applyRemapping,
  };
  return migrator;
}
