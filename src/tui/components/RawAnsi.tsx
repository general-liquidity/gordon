/**
 * RawAnsi — Renders raw ANSI escape sequences directly to stdout.
 *
 * Used for ASCII charts, sparklines, and other content that requires
 * precise terminal control beyond what Ink's layout engine supports.
 *
 * Implementation: Best-effort passthrough via process.stdout.write in
 * a useEffect. Returns an empty Box as the Ink placeholder so the
 * virtual DOM stays consistent. Ink intercepts stdout during rendering
 * so this write happens outside the render cycle (after paint).
 */

import React, { useEffect, useRef } from "react";
import { Box } from "ink";

interface Props {
  /** Raw ANSI string to write directly to stdout. */
  children: string;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Basic sanity check: returns true if the string contains at least one
 * ANSI escape sequence (ESC [ ... m  or  ESC ] ... BEL).
 * Strips any non-ANSI-safe control characters other than ESC sequences
 * to avoid corrupting the terminal.
 */
function sanitizeAnsi(raw: string): string {
  // Allow printable ASCII, newline, carriage return, tab, and valid ANSI escapes.
  // Remove lone control characters (U+0000–U+001F) except ESC (\x1b), \n, \r, \t.
  return raw.replace(/[\x00-\x08\x0b\x0c\x0e-\x1a\x1c-\x1f]/g, "");
}

// ============================================================================
// Component
// ============================================================================

export function RawAnsi({ children }: Props): React.JSX.Element {
  const prevRef = useRef<string>("");

  useEffect(() => {
    if (!process.stdout.isTTY) return;
    if (children === prevRef.current) return;
    prevRef.current = children;

    const safe = sanitizeAnsi(children);
    if (!safe) return;

    try {
      process.stdout.write(safe);
    } catch {
      // Non-critical — terminal may not be writable
    }
  }, [children]);

  // Empty placeholder so Ink's layout engine has something to render.
  return <Box />;
}
