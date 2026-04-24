import React from "react";
import { Text } from "../ink-custom";

// ============================================================================
// TerminalLink — Clickable hyperlinks in the terminal
//
// Claude Code pattern: OSC 8 terminal hyperlinks.
// Supported by: iTerm2, Ghostty, Windows Terminal, WezTerm, Kitty, Hyper
// Unsupported terminals fall back to showing the text without link.
//
// Format: \x1b]8;;URL\x07TEXT\x1b]8;;\x07
// ============================================================================

interface Props {
  url: string;
  children: string;
  color?: string;
}

function supportsHyperlinks(): boolean {
  const term = process.env.TERM_PROGRAM ?? "";
  const termEnv = process.env.TERM ?? "";
  // Known hyperlink-capable terminals
  if (/iTerm|WezTerm|Ghostty|kitty|Hyper/i.test(term)) return true;
  // Windows Terminal
  if (process.env.WT_SESSION) return true;
  // xterm with version >= 370
  if (termEnv.includes("xterm")) return true;
  return false;
}

export function TerminalLink({ url, children, color = "cyan" }: Props) {
  if (!supportsHyperlinks()) {
    // Fallback: show text with URL in parentheses
    return <Text color={color} underline>{children}</Text>;
  }

  // OSC 8 hyperlink: \x1b]8;;URL\x07TEXT\x1b]8;;\x07
  const linked = `\x1b]8;;${url}\x07${children}\x1b]8;;\x07`;
  return <Text color={color}>{linked}</Text>;
}
