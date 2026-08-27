import { Text } from "../ink-custom";

// ============================================================================
// KeyboardShortcutHint — Platform-aware shortcut display
//
// Renders "Ctrl+P" on Linux/Windows, "Cmd+P" on macOS.
// Dimmed shortcut text with optional label after.
// ============================================================================

interface Props {
  keys: string;
  label?: string;
}

const IS_MAC = process.platform === "darwin";

export function formatKeys(raw: string): string {
  return raw
    .split("+")
    .map((part) => {
      const lower = part.toLowerCase();
      if (lower === "ctrl") return IS_MAC ? "\u2318" : "Ctrl";
      if (lower === "shift") return IS_MAC ? "\u21E7" : "Shift";
      if (lower === "alt") return IS_MAC ? "\u2325" : "Alt";
      if (lower === "meta" || lower === "cmd") return IS_MAC ? "\u2318" : "Win";
      if (lower === "enter" || lower === "return") return "\u23CE";
      if (lower === "escape" || lower === "esc") return "Esc";
      if (lower === "tab") return "Tab";
      if (lower === "backspace") return "\u232B";
      if (lower === "space") return "Space";
      if (lower === "type") return "type";
      return part.toUpperCase();
    })
    .join(IS_MAC ? "" : "+");
}

export function KeyboardShortcutHint({ keys, label }: Props) {
  const formatted = formatKeys(keys);

  return (
    <Text>
      <Text dimColor>{formatted}</Text>
      {label ? <Text dimColor> {label}</Text> : null}
    </Text>
  );
}
