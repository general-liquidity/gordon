import type React from "react";
import { Box, Text } from "../../ink-custom";
import { getBinding, type BindableAction } from "../../keybindings/keybindings.ts";

// ============================================================================
// PromptInputHelpMenu — at-rest keyboard-affordance hints under the composer.
//
// Claude Code parity: components/PromptInput/PromptInputHelpMenu.tsx. Trimmed
// for a trading agent: no "!" bash mode, no "@" file-path completion. Every
// entry below maps to a binding Gordon actually handles — the modifier chords
// (command palette, interrupt) are read from the live keybinding registry so a
// user rebind is reflected here; the inline composer keys ("/", shift+enter,
// esc, arrows, tab, "?") are handled directly in PromptInput.
// ============================================================================

export interface HelpMenuEntry {
  keys: string;
  label: string;
}

function formatChord(key: string): string {
  return key.split("+").join(" + ");
}

function bindingChord(action: BindableAction, fallback: string): string {
  return formatChord(getBinding(action)?.key ?? fallback);
}

/**
 * The live composer affordances. Pure so it can be asserted in tests without
 * rendering. Order roughly follows discovery value.
 */
export function buildHelpMenuEntries(): HelpMenuEntry[] {
  return [
    { keys: "/", label: "for commands" },
    { keys: bindingChord("togglePalette", "ctrl+p"), label: "command palette" },
    { keys: "shift + enter", label: "newline" },
    { keys: "↑ ↓", label: "history" },
    { keys: "tab", label: "complete command" },
    { keys: "esc", label: "clear input" },
    { keys: bindingChord("interruptStream", "ctrl+c"), label: "interrupt" },
    { keys: "?", label: "keyboard shortcuts" },
  ];
}

const KEY_COL_WIDTH = 13;

export function PromptInputHelpMenu(): React.ReactElement {
  const entries = buildHelpMenuEntries();
  const rows: HelpMenuEntry[][] = [];
  for (let i = 0; i < entries.length; i += 2) {
    rows.push(entries.slice(i, i + 2));
  }

  return (
    <Box flexDirection="column" marginTop={1} paddingX={1}>
      {rows.map((row, rowIdx) => (
        <Box key={`help-row-${rowIdx}`}>
          {row.map((entry) => (
            <Box key={entry.label} width={34}>
              <Text dimColor>
                {entry.keys.padStart(KEY_COL_WIDTH)}
                {"  "}
                {entry.label}
              </Text>
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  );
}
