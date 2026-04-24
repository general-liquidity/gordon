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

export function colorize(str: string, color: string | undefined, type: "foreground" | "background"): string {
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

export default colorize;
