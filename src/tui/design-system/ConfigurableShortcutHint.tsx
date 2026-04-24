import React, { useEffect, useState } from "react";
import { Text } from "../ink-custom";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { getBinding, type BindableAction } from "../keybindings/keybindings.js";

// ============================================================================
// ConfigurableShortcutHint — Shows keybinding from user config or defaults
//
// Reads ~/.gordon/keybindings.json at render time (async, cached per mount).
// Falls back to DEFAULT_BINDINGS, then to the `fallback` prop.
//
// Renders: [Ctrl+P] Command palette   (dimColor)
// ============================================================================

interface Props {
  /** Action name from BindableAction, e.g. "togglePalette" */
  action: string;
  /** Displayed when action not found in any binding, e.g. "Ctrl+P" */
  fallback?: string;
  /** Human-readable label, e.g. "Command palette" */
  label: string;
}

const KEYBINDINGS_PATH = join(homedir(), ".gordon", "keybindings.json");

function formatKey(raw: string): string {
  return raw
    .split("+")
    .map((part) => {
      const lower = part.toLowerCase();
      if (lower === "ctrl") return "Ctrl";
      if (lower === "shift") return "Shift";
      if (lower === "alt") return "Alt";
      if (lower === "meta" || lower === "cmd") return "Cmd";
      if (lower === "return" || lower === "enter") return "Enter";
      if (lower === "escape" || lower === "esc") return "Esc";
      if (lower === "space") return "Space";
      if (lower === "tab") return "Tab";
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join("+");
}

export function ConfigurableShortcutHint({ action, fallback, label }: Props) {
  const [keyDisplay, setKeyDisplay] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function resolve() {
      // 1. Try user's ~/.gordon/keybindings.json
      try {
        const raw = await readFile(KEYBINDINGS_PATH, "utf-8");
        const parsed = JSON.parse(raw) as Record<
          string,
          | string
          | { action?: string; context?: string }
          | { bindings?: Array<{ key: string; action: string }> }
        >;

        // Support old format: { bindings: [...] } from keybindings.ts
        if (parsed["bindings"] && Array.isArray((parsed as any)["bindings"])) {
          const bindings: Array<{ key: string; action: string }> = (parsed as any)["bindings"];
          const match = bindings.find((b) => b.action === action);
          if (match && !cancelled) {
            setKeyDisplay(formatKey(match.key));
            return;
          }
        }

        // Support new format: { "ctrl+p": "command-palette", ... }
        for (const [key, val] of Object.entries(parsed)) {
          if (typeof val === "string" && val === action) {
            if (!cancelled) setKeyDisplay(formatKey(key));
            return;
          }
          if (typeof val === "object" && val !== null && "action" in val) {
            if ((val as { action?: string }).action === action) {
              if (!cancelled) setKeyDisplay(formatKey(key));
              return;
            }
          }
        }
      } catch {
        // file missing or parse error — fall through
      }

      // 2. Try DEFAULT_BINDINGS from keybindings.ts (BindableAction-based)
      const binding = getBinding(action as BindableAction);
      if (binding) {
        if (!cancelled) setKeyDisplay(formatKey(binding.key));
        return;
      }

      // 3. Use fallback prop
      if (!cancelled) setKeyDisplay(fallback ?? null);
    }

    void resolve();
    return () => {
      cancelled = true;
    };
  }, [action, fallback]);

  if (!keyDisplay) return null;

  return (
    <Text dimColor>
      [{keyDisplay}] {label}
    </Text>
  );
}
