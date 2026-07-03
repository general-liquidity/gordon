// ============================================================================
// Synchronized Output — BSU/ESU for flicker-free terminal painting
//
// Claude Code pattern: wrap frame writes in Begin/End Synchronized Update
// blocks so the terminal composites atomically. Prevents visual tearing.
//
// BSU: \x1b[?2026h (DEC private mode 2026 — Begin Synchronized Update)
// ESU: \x1b[?2026l (End Synchronized Update)
//
// Supported by: iTerm2, Ghostty, WezTerm, Kitty, foot, Contour
// Unsupported terminals silently ignore these sequences. tmux is the
// exception — it parses DEC 2026 but doesn't implement it and has already
// broken atomicity by chunking, so we must NOT emit BSU/ESU there. Capability
// detection is delegated to the shared detectTerminalCapability so this path
// stays in sync with the rest of the TUI instead of hardcoding enabled=true.
// ============================================================================

import { detectTerminalCapability } from "../ink-custom/syncTerminal.ts";

const BSU = "\x1b[?2026h";
const ESU = "\x1b[?2026l";

let syncOutputEnabled = detectTerminalCapability().supportsSyncUpdate;

/** Recompute enablement from an env bag via the shared detector. Called once
 *  at module load; exposed so tests can drive it with a mock env. */
export function initSyncOutputFromEnv(env: NodeJS.ProcessEnv = process.env): void {
  syncOutputEnabled = detectTerminalCapability(env).supportsSyncUpdate;
}

/** Whether BSU/ESU will be emitted for the detected terminal. */
export function isSyncOutputEnabled(): boolean {
  return syncOutputEnabled;
}

export function enableSyncOutput(): void {
  syncOutputEnabled = true;
}

export function disableSyncOutput(): void {
  syncOutputEnabled = false;
}

/** Wrap a write in BSU/ESU for atomic terminal painting */
export function writeSynchronized(content: string): void {
  if (syncOutputEnabled) {
    process.stdout.write(BSU + content + ESU);
  } else {
    process.stdout.write(content);
  }
}

/** Begin synchronized update block */
export function beginSync(): void {
  if (syncOutputEnabled) process.stdout.write(BSU);
}

/** End synchronized update block */
export function endSync(): void {
  if (syncOutputEnabled) process.stdout.write(ESU);
}
