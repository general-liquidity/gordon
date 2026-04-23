/**
 * useTerminalTitle — Sets the terminal tab title via OSC escape sequence.
 *
 * Uses the universal xterm OSC 0 sequence: ESC ] 0 ; {title} BEL
 * Only runs when stdout is a TTY. Safe to call from any component.
 */

import { useEffect } from "react";

/**
 * Sets the terminal tab title whenever `title` changes.
 *
 * @param title - e.g. "Gordon | BTC +2.3% | 3 positions"
 */
export function useTerminalTitle(title: string): void {
  useEffect(() => {
    if (!process.stdout.isTTY) return;

    try {
      process.stdout.write(`\x1b]0;${title}\x07`);
    } catch {
      // Non-critical — terminal may not support OSC sequences
    }
  }, [title]);
}
