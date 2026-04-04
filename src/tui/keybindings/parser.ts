import type { ParsedKeystroke, KeyChord } from "./types.js";

// ============================================================================
// Keybinding Parser — Parses "ctrl+shift+f" into structured keystroke
// ============================================================================

export function parseKeystroke(raw: string): ParsedKeystroke {
  const parts = raw.toLowerCase().split("+");
  const modifiers = new Set(parts.slice(0, -1));
  const key = parts[parts.length - 1] ?? "";

  return {
    key: key === "space" ? " " : key === "plus" ? "+" : key,
    ctrl: modifiers.has("ctrl") || modifiers.has("control"),
    shift: modifiers.has("shift"),
    alt: modifiers.has("alt") || modifiers.has("option"),
    meta: modifiers.has("meta") || modifiers.has("cmd") || modifiers.has("command"),
  };
}

export function parseChord(raw: string): KeyChord {
  return raw.trim().split(/\s+/).map(parseKeystroke);
}

export function keystrokeToString(ks: ParsedKeystroke): string {
  const parts: string[] = [];
  if (ks.ctrl) parts.push("ctrl");
  if (ks.shift) parts.push("shift");
  if (ks.alt) parts.push("alt");
  if (ks.meta) parts.push("meta");
  parts.push(ks.key === " " ? "space" : ks.key);
  return parts.join("+");
}

export function keystrokesEqual(a: ParsedKeystroke, b: ParsedKeystroke): boolean {
  return (
    a.key === b.key &&
    a.ctrl === b.ctrl &&
    a.shift === b.shift &&
    a.alt === b.alt &&
    a.meta === b.meta
  );
}
