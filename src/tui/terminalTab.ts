/**
 * Terminal Tab Integration
 *
 * Set terminal tab titles showing Gordon state (model, permissionMode,
 * active agent). Support iTerm2/Ghostty/kitty tab status protocols.
 *
 * Claude Code pattern: Terminal tab shows current activity, model name,
 * and session state. Users with multiple tabs can see at a glance which
 * session is doing what.
 *
 * Protocols:
 *   - xterm title: ESC ] 0 ; title BEL (universal)
 *   - iTerm2 badge: ESC ] 1337 ; SetBadgeFormat=base64 BEL
 *   - iTerm2 tab color: ESC ] 6 ; 1 ; bg ; red ; brightness ; N BEL
 *   - Ghostty: similar xterm sequences
 *   - kitty: ESC ] 30 ; title ESC \
 */

// ============================================================================
// Terminal Detection
// ============================================================================

type TerminalType = "iterm2" | "ghostty" | "kitty" | "wezterm" | "generic";

function detectTerminal(): TerminalType {
  const termProgram = process.env.TERM_PROGRAM?.toLowerCase() ?? "";
  const lcTerminal = process.env.LC_TERMINAL?.toLowerCase() ?? "";

  if (termProgram.includes("iterm")) return "iterm2";
  if (termProgram.includes("ghostty") || lcTerminal.includes("ghostty")) return "ghostty";
  if (termProgram.includes("kitty")) return "kitty";
  if (termProgram.includes("wezterm")) return "wezterm";
  return "generic";
}

// ============================================================================
// OSC Escape Sequences
// ============================================================================

function writeOSC(sequence: string): void {
  if (!process.stdout.isTTY) return;
  try {
    process.stdout.write(sequence);
  } catch {
    // Non-critical — terminal may not support
  }
}

/** Set window/tab title (universal). */
function setTitle(title: string): void {
  writeOSC(`\x1b]0;${title}\x07`);
}

/** Set iTerm2 badge text. */
function setIterm2Badge(text: string): void {
  const encoded = Buffer.from(text).toString("base64");
  writeOSC(`\x1b]1337;SetBadgeFormat=${encoded}\x07`);
}

/** Set iTerm2 tab color based on state. */
function setIterm2TabColor(r: number, g: number, b: number): void {
  writeOSC(`\x1b]6;1;bg;red;brightness;${r}\x07`);
  writeOSC(`\x1b]6;1;bg;green;brightness;${g}\x07`);
  writeOSC(`\x1b]6;1;bg;blue;brightness;${b}\x07`);
}

/** Reset iTerm2 tab color. */
function resetIterm2TabColor(): void {
  writeOSC(`\x1b]6;1;bg;*;default\x07`);
}

// ============================================================================
// State Colors
// ============================================================================

interface StateColor {
  r: number;
  g: number;
  b: number;
}

const STATE_COLORS: Record<string, StateColor> = {
  idle:       { r: 40, g: 40, b: 40 },      // Dark gray
  streaming:  { r: 30, g: 80, b: 180 },     // Blue
  approving:  { r: 200, g: 150, b: 30 },    // Amber
  executing:  { r: 200, g: 50, b: 50 },     // Red (trade in progress)
  auto:       { r: 50, g: 180, b: 80 },     // Green (auto mode)
  strict:     { r: 100, g: 100, b: 100 },   // Gray (read-only)
};

// ============================================================================
// Public API
// ============================================================================

export interface TabState {
  /** Gordon's current activity. */
  activity: "idle" | "streaming" | "approving" | "executing";
  /** Active agent name. */
  agent?: string;
  /** Current symbol being analyzed/traded. */
  symbol?: string;
  /** Permission mode. */
  permissionMode?: "auto" | "ask" | "strict" | "paper" | "observe" | "plan";
  /** Model name (short). */
  model?: string;
}

let terminal: TerminalType | null = null;

/**
 * Update the terminal tab to reflect Gordon's current state.
 * Safe to call frequently — only writes if state changed.
 */
let lastTitle = "";

export function updateTerminalTab(state: TabState): void {
  if (!terminal) terminal = detectTerminal();

  // Build title
  const parts: string[] = ["Gordon"];
  if (state.model) parts.push(`(${state.model})`);
  if (state.agent && state.agent !== "Gordon") parts.push(`→ ${state.agent}`);
  if (state.symbol) parts.push(`[${state.symbol}]`);

  const activitySuffix =
    state.activity === "streaming" ? " ..." :
    state.activity === "approving" ? " ⚠" :
    state.activity === "executing" ? " ⚡" :
    "";

  const title = parts.join(" ") + activitySuffix;

  // Only write if changed
  if (title === lastTitle) return;
  lastTitle = title;

  setTitle(title);

  // iTerm2-specific enhancements
  if (terminal === "iterm2") {
    // Badge shows permission mode
    const badge = state.permissionMode === "auto" ? "AUTO"
      : state.permissionMode === "strict" ? "STRICT"
      : state.permissionMode === "paper" ? "PAPER"
      : state.permissionMode === "observe" ? "OBS"
      : state.permissionMode === "plan" ? "PLAN"
      : "ASK";
    setIterm2Badge(badge);

    // Tab color reflects state
    const colorKey = state.permissionMode === "auto" ? "auto"
      : state.permissionMode === "strict" ? "strict"
      : state.activity;
    const color = STATE_COLORS[colorKey] ?? STATE_COLORS.idle!;
    setIterm2TabColor(color.r, color.g, color.b);
  }
}

/**
 * Reset terminal tab to clean state (call on exit).
 */
export function resetTerminalTab(): void {
  setTitle("Terminal");
  if (terminal === "iterm2") {
    setIterm2Badge("");
    resetIterm2TabColor();
  }
  lastTitle = "";
}
