// syncTerminal — Phase 3 terminal capability detection + BSU/ESU frame wrapping.
//
// Status: NOT WIRED. Detects whether the host terminal supports the Sync
// Update Mode DEC private mode (CSI ?2026 h / CSI ?2026 l) plus related
// capabilities (alternate screen buffer, OSC 8 hyperlinks) from environment
// variables. When supported, wrapFrame() brackets a frame's ANSI payload
// with BSU/ESU so the terminal treats the repaint as a single atomic update
// and avoids mid-frame tearing.
//
// Detection is env-only — we never probe the TTY with a DA-style query at
// import time, since a blocking probe on startup is worse than a wrong
// default. Multiplexers (tmux, GNU screen) are assumed to strip the DEC
// private mode sequence unless the user has opted in, so we default them
// to unsupported.

import type { SyncTerminal, TerminalCapability } from "./internal/contracts.ts";

// Begin/End Synchronized Update — DEC private mode 2026.
// See: https://gitlab.freedesktop.org/terminal-wg/specifications/-/merge_requests/2
const BSU = "\x1b[?2026h";
const ESU = "\x1b[?2026l";

// Terminals with first-class BSU/ESU support. Matched case-insensitively
// against $TERM_PROGRAM.
const SYNC_TERM_PROGRAMS = /iTerm|WezTerm|Ghostty|kitty/i;

// Terminals with OSC 8 hyperlink support. Broadly the same set as
// BSU-capable terminals plus modern xterm (gated on version).
const HYPERLINK_TERM_PROGRAMS = /iTerm|WezTerm|Ghostty|kitty/i;

// xterm version that added OSC 8 hyperlink support.
const XTERM_HYPERLINK_MIN_VERSION = 370;

// TERM_PROGRAM_VERSION strings that indicate BSU was added. Most modern
// releases of the terminals in SYNC_TERM_PROGRAMS ship with BSU, so this
// is mainly a fallback when TERM_PROGRAM is missing or unrecognized but
// the version string hints at a recent xterm-compatible emulator.
// iTerm2 added BSU in 3.5; kitty in 0.21; WezTerm in 20220101; Ghostty from 1.0.
const SYNC_VERSION_HINT = /^(3\.[5-9]|[4-9]|\d{2,})/;

/**
 * Parse a numeric major from a TERM_PROGRAM_VERSION string. Returns NaN for
 * unparseable input so callers can treat it as "unknown" via Number.isFinite.
 */
function parseLeadingInt(version: string | undefined): number {
  if (!version) return Number.NaN;
  const match = version.match(/^(\d+)/);
  if (!match || match[1] === undefined) return Number.NaN;
  return Number.parseInt(match[1], 10);
}

/**
 * Detect terminal capabilities from environment variables. Never performs
 * blocking I/O — purely a function of the provided env bag. Pass a mock
 * env object from tests instead of mutating `process.env`.
 */
export function detectTerminalCapability(
  env: NodeJS.ProcessEnv = process.env,
): TerminalCapability {
  const term = (env.TERM ?? "").toLowerCase();
  const termProgram = env.TERM_PROGRAM ?? "";
  const termProgramVersion = env.TERM_PROGRAM_VERSION ?? "";
  const isDumb = term === "dumb";
  const inTmux = typeof env.TMUX === "string" && env.TMUX.length > 0;
  const inScreen = typeof env.STY === "string" && env.STY.length > 0;
  const inWindowsTerminal =
    typeof env.WT_SESSION === "string" && env.WT_SESSION.length > 0;

  // --- supportsSyncUpdate -------------------------------------------------
  let supportsSyncUpdate = false;
  let syncSource = "unknown";

  if (isDumb) {
    supportsSyncUpdate = false;
    syncSource = "dumb";
  } else if (inTmux) {
    // tmux strips DEC private modes it doesn't recognize. Users can opt in
    // with `set -g allow-passthrough on`, but we assume the default.
    supportsSyncUpdate = false;
    syncSource = "tmux(strip-sync)";
  } else if (inScreen) {
    supportsSyncUpdate = false;
    syncSource = "screen(strip-sync)";
  } else if (SYNC_TERM_PROGRAMS.test(termProgram)) {
    supportsSyncUpdate = true;
    syncSource = `${termProgram}+sync`;
  } else if (inWindowsTerminal) {
    supportsSyncUpdate = true;
    syncSource = "WindowsTerminal+sync";
  } else if (SYNC_VERSION_HINT.test(termProgramVersion)) {
    supportsSyncUpdate = true;
    syncSource = `version(${termProgramVersion})+sync`;
  } else {
    syncSource = termProgram || term || "unknown";
  }

  // --- hasAlternateScreen -------------------------------------------------
  // Practically every terminal emulator supports DECSET 1049 except TERM=dumb.
  const hasAlternateScreen = !isDumb;

  // --- supportsHyperlink --------------------------------------------------
  let supportsHyperlink = false;
  if (isDumb) {
    supportsHyperlink = false;
  } else if (HYPERLINK_TERM_PROGRAMS.test(termProgram)) {
    supportsHyperlink = true;
  } else if (inWindowsTerminal) {
    supportsHyperlink = true;
  } else if (termProgram.toLowerCase() === "xterm") {
    const xtermVersion = parseLeadingInt(termProgramVersion);
    supportsHyperlink =
      Number.isFinite(xtermVersion) && xtermVersion >= XTERM_HYPERLINK_MIN_VERSION;
  } else if (SYNC_VERSION_HINT.test(termProgramVersion)) {
    // Modern terminal of unknown brand — assume OSC 8 works.
    supportsHyperlink = true;
  }

  return {
    supportsSyncUpdate,
    hasAlternateScreen,
    supportsHyperlink,
    detectedAs: syncSource,
  };
}

/**
 * Create a SyncTerminal bound to the detected capabilities of the given
 * environment. `wrapFrame` brackets the ANSI payload with BSU/ESU when
 * supported; otherwise returns the payload unchanged so callers can use a
 * single code path regardless of the host.
 */
export function createSyncTerminal(
  env: NodeJS.ProcessEnv = process.env,
): SyncTerminal {
  const capability = detectTerminalCapability(env);
  return {
    capability,
    wrapFrame(ansi: string): string {
      if (!capability.supportsSyncUpdate) return ansi;
      return `${BSU}${ansi}${ESU}`;
    },
  };
}
