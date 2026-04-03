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
 * @example
 *   const { columns, rows } = useTerminalSize();
 *   const isNarrow = columns < 80;
 */
export function useTerminalSize(): TerminalSize {
  const [size, setSize] = useState<TerminalSize>(getTerminalSize);

  useEffect(() => {
    const onResize = () => {
      setSize(getTerminalSize());
    };

    process.stdout.on("resize", onResize);

    return () => {
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
