/**
 * useTabStatus — Sets terminal tab status using OSC escape sequences.
 *
 * Supports:
 *   - iTerm2 badge (user-defined variable): label text
 *   - Windows Terminal progress indicator: 0-100
 *   - iTerm2 tab color: hex color string (#rrggbb)
 *
 * Guards against non-TTY. All errors are caught silently.
 */

import { useEffect } from "react";

interface TabStatusOpts {
  /** Tab label / iTerm2 badge text. */
  label?: string;
  /** Progress 0-100 for Windows Terminal progress indicator. */
  progress?: number;
  /** Tab color as hex string, e.g. "#ff0000". */
  color?: string;
}

// ============================================================================
// Helpers
// ============================================================================

function writeOSC(seq: string): void {
  if (!process.stdout.isTTY) return;
  try {
    process.stdout.write(seq);
  } catch {
    // Silent — non-critical
  }
}

/** iTerm2 badge via SetBadgeFormat (base64-encoded label). */
function setIterm2Badge(label: string): void {
  const encoded = Buffer.from(label).toString("base64");
  writeOSC(`\x1b]1337;SetBadgeFormat=${encoded}\x07`);
}

/**
 * Windows Terminal progress indicator.
 * State 1 = normal progress, progress = 0-100.
 * See: https://github.com/microsoft/terminal/issues/6700
 */
function setWTProgress(progress: number): void {
  const clamped = Math.max(0, Math.min(100, Math.round(progress)));
  writeOSC(`\x1b]9;4;1;${clamped}\x07`);
}

/** Clear Windows Terminal progress indicator. */
function clearWTProgress(): void {
  writeOSC(`\x1b]9;4;0;0\x07`);
}

/** Parse a #rrggbb hex color into { r, g, b } (0-255). */
function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return null;
  return {
    r: parseInt(m[1]!, 16),
    g: parseInt(m[2]!, 16),
    b: parseInt(m[3]!, 16),
  };
}

/** iTerm2 tab color via OSC 6. */
function setIterm2TabColor(r: number, g: number, b: number): void {
  writeOSC(`\x1b]6;1;bg;red;brightness;${r}\x07`);
  writeOSC(`\x1b]6;1;bg;green;brightness;${g}\x07`);
  writeOSC(`\x1b]6;1;bg;blue;brightness;${b}\x07`);
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Sets terminal tab status (badge, progress, color) using OSC sequences.
 * Omit any option to leave it unchanged / skip that sequence.
 */
export function useTabStatus(opts: TabStatusOpts): void {
  const { label, progress, color } = opts;

  // iTerm2 badge
  useEffect(() => {
    if (label == null) return;
    setIterm2Badge(label);
  }, [label]);

  // Windows Terminal progress
  useEffect(() => {
    if (progress == null) return;
    setWTProgress(progress);
    return () => {
      clearWTProgress();
    };
  }, [progress]);

  // iTerm2 tab color
  useEffect(() => {
    if (!color) return;
    const rgb = parseHex(color);
    if (!rgb) return;
    setIterm2TabColor(rgb.r, rgb.g, rgb.b);
    return () => {
      // Reset to default on unmount
      writeOSC(`\x1b]6;1;bg;*;default\x07`);
    };
  }, [color]);
}
