import { detectTerminalCapability } from "../ink-custom/syncTerminal.ts";

const ALT_ENTER = "\x1b[?1049h\x1b[H\x1b[2J";
const ALT_LEAVE = "\x1b[?1049l";

// Refcounted ownership: in fullscreen screen-mode the app itself owns the
// alt screen (depth 1) for the whole session, and overlays that also call
// enterAltScreen/leaveAltScreen nest on top (depth 2). Closing an overlay
// decrements back to 1 WITHOUT writing ALT_LEAVE — so an overlay close can
// never dump the user back to the main buffer mid-session. Only the final
// leave (depth 1 → 0) restores the main screen.
let depth = 0;
let activeOut: NodeJS.WriteStream | null = null;
let exitHookRegistered = false;

export function enterAltScreen(out: NodeJS.WriteStream = process.stdout): boolean {
  if (depth > 0) {
    depth += 1;
    return true;
  }
  if (!out.isTTY) return false;
  if (!detectTerminalCapability().hasAlternateScreen) return false;

  out.write(ALT_ENTER);
  depth = 1;
  activeOut = out;
  registerExitHook();
  return true;
}

export function leaveAltScreen(out: NodeJS.WriteStream = process.stdout): void {
  if (depth === 0) return;
  depth -= 1;
  if (depth > 0) return;
  const target = activeOut ?? out;
  target.write(ALT_LEAVE);
  activeOut = null;
}

/** True while anyone (app or overlay) holds the alt screen. */
export function isAltScreenActive(): boolean {
  return depth > 0;
}

/**
 * Restore the main screen unconditionally, ignoring refcount depth.
 * For process-exit paths only (normal unmount, signal handlers,
 * uncaughtException) — a missed restore leaves the user's terminal
 * trashed, so exit paths must not depend on balanced leave calls.
 */
export function forceLeaveAltScreen(): void {
  if (depth === 0) return;
  if (activeOut) activeOut.write(ALT_LEAVE);
  depth = 0;
  activeOut = null;
}

function registerExitHook(): void {
  if (exitHookRegistered) return;
  exitHookRegistered = true;
  process.once("exit", () => {
    forceLeaveAltScreen();
  });
}
