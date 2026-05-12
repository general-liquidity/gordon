import React, { useEffect, type ReactNode } from "react";

// ============================================================================
// AlternateScreen — Switches terminal to alternate screen buffer
//
// Claude Code pattern: immersive fullscreen UI that doesn't pollute
// the user's terminal scrollback. On unmount, restores the original buffer.
//
// Uses ANSI escape sequences:
//   \x1b[?1049h — Enter alternate screen
//   \x1b[?1049l — Leave alternate screen
// ============================================================================

interface Props {
  children: ReactNode;
  /** Whether to use alternate screen. Default true. */
  enabled?: boolean;
}

export function AlternateScreen({ children, enabled = true }: Props) {
  useEffect(() => {
    if (!enabled) return;
    // Enter alternate screen buffer
    process.stdout.write("\x1b[?1049h");
    // Move cursor to top-left
    process.stdout.write("\x1b[H");

    return () => {
      // Leave alternate screen buffer — restores original terminal content
      process.stdout.write("\x1b[?1049l");
    };
  }, [enabled]);

  return <>{children}</>;
}
