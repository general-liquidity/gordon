// colorize — ANSI color/bg application via chalk.
//
// Status: Phase 1+ (behind GORDON_CUSTOM_RENDER flag). Mirrors Ink's
// `colorize.js` for foreground + background color strings. Accepts:
//   * Named chalk colors (red, green, ...)
//   * Hex (#ff00aa)
//   * ansi256(N)
//   * rgb(r,g,b)

import chalk from "chalk";

type ChalkLike = Record<string, (s: string) => string> & {
  hex: (c: string) => (s: string) => string;
  bgHex: (c: string) => (s: string) => string;
  ansi256: (n: number) => (s: string) => string;
  bgAnsi256: (n: number) => (s: string) => string;
  rgb: (r: number, g: number, b: number) => (s: string) => string;
  bgRgb: (r: number, g: number, b: number) => (s: string) => string;
};

const chalkAny = chalk as unknown as ChalkLike;

const rgbRegex = /^rgb\(\s?(\d+),\s?(\d+),\s?(\d+)\s?\)$/;
const ansiRegex = /^ansi256\(\s?(\d+)\s?\)$/;

function isNamedColor(color: string): boolean {
  return typeof (chalkAny as Record<string, unknown>)[color] === "function";
}

export function colorize(
  str: string,
  color: string | undefined,
  type: "foreground" | "background",
): string {
  if (!color) return str;
  if (isNamedColor(color)) {
    if (type === "foreground") {
      const fn = chalkAny[color];
      return fn ? fn(str) : str;
    }
    const methodName = `bg${color[0]!.toUpperCase() + color.slice(1)}`;
    const fn = chalkAny[methodName];
    return fn ? fn(str) : str;
  }
  if (color.startsWith("#")) {
    return type === "foreground" ? chalkAny.hex(color)(str) : chalkAny.bgHex(color)(str);
  }
  if (color.startsWith("ansi256")) {
    const m = ansiRegex.exec(color);
    if (!m) return str;
    const n = Number(m[1]);
    return type === "foreground" ? chalkAny.ansi256(n)(str) : chalkAny.bgAnsi256(n)(str);
  }
  if (color.startsWith("rgb")) {
    const m = rgbRegex.exec(color);
    if (!m) return str;
    const r = Number(m[1]);
    const g = Number(m[2]);
    const b = Number(m[3]);
    return type === "foreground" ? chalkAny.rgb(r, g, b)(str) : chalkAny.bgRgb(r, g, b)(str);
  }
  return str;
}

// ============================================================================
// Terminal color-fidelity level adjust
//
// Ported from Claude Code's colorize.ts (boostChalkLevelForXtermJs +
// clampChalkLevelForTmux). chalk auto-detects a color level, but two common
// environments need a nudge:
//   * xterm.js terminals (VS Code, Cursor, code-server) support truecolor but
//     often don't advertise COLORTERM, so chalk lands on level 2 and
//     downgrades rgb()/hex() to the nearest 256-cube color — Gordon orange
//     washes out to salmon. Boost to level 3.
//   * tmux only re-emits truecolor to the outer terminal when the user set
//     Tc/RGB overrides; by default the truecolor bg sequence is dropped. Clamp
//     to level 2 (256-color) which tmux passes through cleanly.
// ============================================================================

/** True if running inside an xterm.js-based terminal (VS Code, Cursor,
 *  code-server). TERM_PROGRAM=vscode covers desktop VS Code and Cursor; the
 *  VSCODE_ env prefix is set inside the integrated terminal (and by
 *  code-server) even when TERM_PROGRAM isn't set/forwarded. */
export function isXtermJsTerminal(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.TERM_PROGRAM === "vscode") return true;
  for (const key in env) {
    if (key.startsWith("VSCODE_")) return true;
  }
  return false;
}

/**
 * Given the current chalk color level and an env bag, return the level that
 * best matches the host terminal. Pure — `applyTerminalColorLevel` applies it
 * to the chalk singleton. Boost runs before the tmux clamp so tmux-inside-VS
 * -Code still ends at level 2 (tmux's passthrough limitation wins).
 */
export function targetChalkLevel(
  currentLevel: number,
  env: NodeJS.ProcessEnv = process.env,
): number {
  let level = currentLevel;
  // Boost only from level 2 — level 0/1 means NO_COLOR / FORCE_COLOR set an
  // explicit low ceiling we must respect.
  if (level === 2 && isXtermJsTerminal(env)) level = 3;
  if (env.TMUX && level > 2) level = 2;
  return level;
}

/**
 * Apply the terminal-aware color level to the chalk singleton. Call once at
 * TUI startup. Idempotent — terminal/tmux env doesn't change mid-session.
 */
export function applyTerminalColorLevel(): void {
  const current = (chalk as { level: number }).level ?? 0;
  const target = targetChalkLevel(current);
  if (target !== current) {
    (chalk as { level: number }).level = target;
  }
}

export default colorize;
