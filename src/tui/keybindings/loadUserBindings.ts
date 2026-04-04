import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { KeyContext, type KeyBinding } from "./types.js";
import { parseChord } from "./parser.js";
import { isReserved } from "./reservedShortcuts.js";

// ============================================================================
// Load User Bindings — Reads ~/.gordon/keybindings.json
//
// Format: { "ctrl+p": "command-palette", "ctrl+shift+b": { action: "buy-market", context: "OrderEntry" } }
// Validates against known actions, filters reserved shortcuts.
// ============================================================================

const KEYBINDINGS_PATH = join(homedir(), ".gordon", "keybindings.json");

export function loadUserBindings(): KeyBinding[] {
  if (!existsSync(KEYBINDINGS_PATH)) {
    return [];
  }

  try {
    const raw = readFileSync(KEYBINDINGS_PATH, "utf-8");
    const parsed = JSON.parse(raw);

    if (typeof parsed !== "object" || parsed === null) {
      return [];
    }

    const bindings: KeyBinding[] = [];

    for (const [keystroke, value] of Object.entries(parsed)) {
      if (isReserved(keystroke)) {
        continue;
      }

      const chord = parseChord(keystroke);

      if (typeof value === "string") {
        bindings.push({ chord, action: value as any, context: KeyContext.Global });
      } else if (typeof value === "object" && value !== null) {
        const obj = value as { action?: string; context?: string };
        if (obj.action) {
          const context =
            (obj.context && obj.context in KeyContext
              ? KeyContext[obj.context as keyof typeof KeyContext]
              : KeyContext.Global);
          bindings.push({ chord, action: obj.action as any, context });
        }
      }
    }

    return bindings;
  } catch {
    return [];
  }
}
