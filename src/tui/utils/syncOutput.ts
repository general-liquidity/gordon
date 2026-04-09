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
// Unsupported terminals silently ignore these sequences.
// ============================================================================

const BSU = "\x1b[?2026h";
const ESU = "\x1b[?2026l";

let syncOutputEnabled = true;

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
