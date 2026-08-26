/**
 * Reconciler contracts — shared TypeScript interfaces for Phases 1-6.
 *
 * Every parallel module in src/tui/ink-custom/ codes against these types
 * so implementations can evolve independently without drift. None of these
 * modules are activated yet — they exist as Phase 0.5 scaffolding for the
 * eventual reconciler integration sprint.
 */

// ============================================================================
// Phase 1 — Packed cell buffer + pools
// ============================================================================

/**
 * Packed Int32 cell layout:
 *   bits 0-19  (20 bits): charPool index (max ~1M unique strings)
 *   bits 20-27 (8 bits):  stylePool id (max 256 pre-serialized ANSI combos)
 *   bits 28-29 (2 bits):  visual width — 0=single, 1=double, 2=zero, 3=reserved
 *   bit  30    (1 bit):   dirty flag (for incremental diff)
 *   bit  31    (1 bit):   reserved
 */
export const CELL_CHAR_MASK = 0xfffff;
export const CELL_STYLE_SHIFT = 20;
export const CELL_STYLE_MASK = 0xff;
export const CELL_WIDTH_SHIFT = 28;
export const CELL_WIDTH_MASK = 0x3;
export const CELL_DIRTY_BIT = 0x40000000;

export type CellWidth = 0 | 1 | 2;

export interface Cell {
  charIdx: number;
  styleId: number;
  width: CellWidth;
  dirty: boolean;
}

export interface CellBuffer {
  readonly width: number;
  readonly height: number;
  set(x: number, y: number, charIdx: number, styleId: number, width: CellWidth): void;
  get(x: number, y: number): Cell;
  /** Raw readonly view for diffing — do not mutate. */
  raw(): Int32Array;
  clear(): void;
  /** Copy cells from another buffer into this one. Throws on size mismatch. */
  copyFrom(other: CellBuffer): void;
}

export interface PoolStats {
  size: number;
  capacity: number;
  /** Optional: LRU evictions since creation, if the pool tracks them. */
  evictions?: number;
}

export interface StylePool {
  /** Intern a pre-serialized ANSI style sequence, return its integer ID. */
  intern(ansi: string): number;
  /** Look up the ANSI string for a style ID. */
  get(id: number): string | undefined;
  readonly size: number;
  readonly capacity: number;
  stats(): PoolStats;
  /** Reset to empty. Used by Phase 6 migration. */
  reset(): void;
}

export interface CharPool {
  /** Intern a character/grapheme or short substring, return its integer ID. */
  intern(s: string): number;
  get(id: number): string | undefined;
  readonly size: number;
  readonly capacity: number;
  stats(): PoolStats;
  reset(): void;
}

// ============================================================================
// Phase 2 — Double buffer + diff + ANSI patcher
// ============================================================================

export interface ChangedRegion {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Patch {
  x: number;
  y: number;
  /** Content to write — usually a character or short run. May include ANSI. */
  content: string;
  /** Visual width in cells (accounts for double-width chars). */
  visualWidth: number;
  /** Style ID for this patch, or -1 if the patch is style-neutral. */
  styleId: number;
}

export interface FrameBuffer {
  readonly width: number;
  readonly height: number;
  /** Cells being painted by the reconciler; becomes the new front on swap. */
  back: CellBuffer;
  /** Cells currently on screen. Reconciler diffs back vs front to emit patches. */
  front: CellBuffer;
  /** Atomically swap front/back. Returns the bounding boxes that changed. */
  swap(): ChangedRegion[];
  resize(width: number, height: number): void;
}

export interface PatchEmitter {
  /** Diff two buffers and return the minimal patch list. */
  diff(prev: CellBuffer, curr: CellBuffer, stylePool: StylePool, charPool: CharPool): Patch[];
}

export interface AnsiPatcher {
  /** Serialize patches into a single ANSI string ready for stdout.write(). */
  write(patches: readonly Patch[], stylePool: StylePool, charPool: CharPool): string;
}

// ============================================================================
// Phase 3 — Sync terminal capability detection + BSU/ESU
// ============================================================================

export interface TerminalCapability {
  supportsSyncUpdate: boolean;
  hasAlternateScreen: boolean;
  supportsHyperlink: boolean;
  /** Raw TERM / TERM_PROGRAM strings used for diagnostics. */
  detectedAs: string;
}

export interface SyncTerminal {
  readonly capability: TerminalCapability;
  /** Wrap a frame's ANSI string with BSU/ESU markers if supported. */
  wrapFrame(ansi: string): string;
}

// ============================================================================
// Phase 4 — Hyperlinks + selection + cursor declaration
// ============================================================================

export interface HyperlinkPool {
  /** Intern a URL, return a compact ID for embedding in cells. */
  intern(url: string): number;
  get(id: number): string | undefined;
  readonly size: number;
  readonly capacity: number;
  stats(): PoolStats;
  reset(): void;
}

export interface SelectionRange {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

export interface SelectionOverlay {
  current: SelectionRange | null;
  set(range: SelectionRange | null): void;
  clear(): void;
  /** Apply selection highlight (SGR 7 inverse) to a patch list. */
  applyTo(patches: readonly Patch[]): Patch[];
  /**
   * Materialize the selected cells from a painted frame as patches. This is
   * used after a full-frame rewrite: selection is a display concern and must
   * never mutate the framebuffer that subsequent content diffs compare.
   */
  patchesFor(frame: CellBuffer, charPool: CharPool): Patch[];
}

export interface CursorDeclaration {
  row: number;
  col: number;
}

export interface CursorDeclarationManager {
  current: CursorDeclaration | null;
  declare(row: number, col: number): void;
  clear(): void;
  /** ANSI sequence to append to a frame to park the physical cursor. */
  emit(): string;
}

// ============================================================================
// Phase 6 — Pool migration (long-session memory safety)
// ============================================================================

export interface PoolSnapshot {
  liveChars: Set<number>;
  liveStyles: Set<number>;
  liveHyperlinks: Set<number>;
}

export interface RemappingTable {
  chars: Map<number, number>;
  styles: Map<number, number>;
  hyperlinks: Map<number, number>;
}

export interface PoolMigrator {
  /** Walk the front frame + live hyperlinks, collect used IDs. */
  captureSnapshot(
    frontFrame: CellBuffer,
    hyperlinkPool: HyperlinkPool,
  ): PoolSnapshot;

  /**
   * Build fresh pools containing only live items from the snapshot,
   * and a remapping table for rewriting the front frame's cell IDs.
   */
  rebase(
    snapshot: PoolSnapshot,
    charPool: CharPool,
    stylePool: StylePool,
    hyperlinkPool: HyperlinkPool,
  ): {
    newCharPool: CharPool;
    newStylePool: StylePool;
    newHyperlinkPool: HyperlinkPool;
    remapping: RemappingTable;
  };

  /** Apply the remapping to a cell buffer in-place. */
  applyRemapping(frame: CellBuffer, remapping: RemappingTable): void;
}

export interface MigrationSchedulerHandle {
  stop(): void;
}

export interface MigrationScheduler {
  start(intervalMs: number): MigrationSchedulerHandle;
}
