/**
 * useTerminalSize — Responsive terminal dimensions
 *
 * Returns the current terminal {columns, rows} and updates on resize.
 * Falls back to 80x24 when stdout dimensions are unavailable (e.g. in
 * piped or CI environments).
 *
 * Phase 3 of the 100% parity plan.
 */

import { useState, useEffect } from "react";
import { resetLineDiffCache } from "../../rendering/LineDiffRenderer.js";

export interface TerminalSize {
  /** Terminal width in columns */
  columns: number;
  /** Terminal height in rows */
  rows: number;
}

const DEFAULT_COLUMNS = 80;
const DEFAULT_ROWS = 24;

function getTerminalSize(): TerminalSize {
  return {
    columns: process.stdout.columns ?? DEFAULT_COLUMNS,
    rows: process.stdout.rows ?? DEFAULT_ROWS,
  };
}

/**
 * Subscribe to terminal resize events. Returns {columns, rows} that
 * update whenever the terminal window is resized.
 *
 * Resize is debounced by 80ms to prevent layout thrash during window
 * drag — SIGWINCH can fire 10+ times within 100ms, and each call would
 * trigger a full-tree Yoga layout recomputation. 80ms is fast enough to
 * feel instant but slow enough to coalesce drag events.
 *
 * @example
 *   const { columns, rows } = useTerminalSize();
 *   const isNarrow = columns < 80;
 */
const RESIZE_DEBOUNCE_MS = 80;

export function useTerminalSize(): TerminalSize {
  const [size, setSize] = useState<TerminalSize>(getTerminalSize);

  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const onResize = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        // Clear stale line diffs before layout recomputes — without this,
        // incrementalRendering may skip rewriting lines whose content
        // hasn't changed but whose position has shifted after resize.
        resetLineDiffCache();
        setSize(getTerminalSize());
        debounceTimer = null;
      }, RESIZE_DEBOUNCE_MS);
    };

    process.stdout.on("resize", onResize);

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      process.stdout.off("resize", onResize);
    };
  }, []);

  return size;
}

/**
 * Get terminal size as a one-time snapshot (non-reactive).
 */
export function getTerminalSizeSnapshot(): TerminalSize {
  return getTerminalSize();
}
