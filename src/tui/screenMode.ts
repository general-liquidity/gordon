import { detectTerminalCapability } from "./ink-custom/syncTerminal.ts";

// ============================================================================
// screenMode — fullscreen (alt-screen) vs inline screen-model resolution
//
// "fullscreen": Gordon owns the terminal's alternate screen for the whole
// session — GORDON banner + session box + trading preflight pinned at the
// top, chat scrolling in a viewport below, input + status at the bottom
// (Hermes-style full-screen terminal app).
//
// "inline": the legacy hybrid model — pre-Ink banner/session boxes printed
// into normal scrollback, completed messages committed to <Static>, history
// read via terminal scrollback.
//
// The mode is resolved ONCE at startup and cannot change mid-session: the
// alt-screen is entered before Ink renders and <Static> usage is decided at
// mount. Consumers read it via a module-level const.
// ============================================================================

export type ScreenMode = "fullscreen" | "inline";

export interface ScreenModeInputs {
  env?: NodeJS.ProcessEnv;
  argv?: readonly string[];
  isTTY?: boolean;
  hasAltScreen?: boolean;
}

/**
 * Resolve the screen mode. Returns "fullscreen" when ALL of:
 *   - stdout is a TTY
 *   - the terminal supports the alternate screen buffer (TERM != dumb)
 *   - not running under ACP / headless / CI (those surfaces never own a
 *     screen; --headless and `bun acp` exit before the TUI, but we gate
 *     defensively on the argv flags + CI env anyway)
 *   - GORDON_SCREEN !== "inline" — the OPERATOR ESCAPE HATCH. Set
 *     GORDON_SCREEN=inline to force the legacy hybrid/inline model if the
 *     fullscreen layout misbehaves in a given terminal.
 *   - GORDON_ALT_SCREEN !== "false" — the pre-existing alt-screen kill
 *     switch (also disables overlay alt-screen) implies inline.
 *
 * Otherwise returns "inline".
 */
export function resolveScreenMode(inputs: ScreenModeInputs = {}): ScreenMode {
  const env = inputs.env ?? process.env;
  const argv = inputs.argv ?? process.argv;
  const isTTY = inputs.isTTY ?? process.stdout.isTTY === true;
  const hasAltScreen =
    inputs.hasAltScreen ?? detectTerminalCapability(env).hasAlternateScreen;

  if (env.GORDON_SCREEN === "inline") return "inline";
  if (env.GORDON_ALT_SCREEN === "false") return "inline";
  if (env.CI) return "inline";
  if (argv.includes("--headless") || argv.includes("--acp")) return "inline";
  if (!isTTY) return "inline";
  if (!hasAltScreen) return "inline";
  return "fullscreen";
}
