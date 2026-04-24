/**
 * cursorDeclaration — Phase 4 reconciler module.
 *
 * Lets React components declare where the physical terminal cursor should
 * end up after a frame is painted (e.g. inside an <TextInput>). The
 * reconciler appends `emit()`'s output at the very end of the frame's ANSI
 * string so the cursor lands on the declared cell AFTER all cell writes.
 *
 * ANSI: `\x1b[<row>;<col>H` — Cursor Position (CUP), 1-indexed rows/cols.
 */

import type { CursorDeclaration, CursorDeclarationManager } from "./internal/contracts.ts";

export function createCursorDeclarationManager(): CursorDeclarationManager {
  const manager: CursorDeclarationManager = {
    current: null,

    declare(row: number, col: number): void {
      manager.current = { row, col };
    },

    clear(): void {
      manager.current = null;
    },

    emit(): string {
      const cursor = manager.current;
      if (cursor === null) return "";
      // ANSI CUP is 1-indexed; caller passes 0-indexed row/col.
      return `\x1b[${cursor.row + 1};${cursor.col + 1}H`;
    },
  };

  return manager;
}
