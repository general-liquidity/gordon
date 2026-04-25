import { KeyContext, type KeyBinding } from "./types.js";
import { parseChord } from "./parser.js";

// ============================================================================
// Default Keybindings — Trading-specific defaults for all contexts
// ============================================================================

function bind(chord: string, action: any, context: KeyContext): KeyBinding {
  return { chord: parseChord(chord), action, context };
}

export const DEFAULT_BINDINGS: KeyBinding[] = [
  // Global
  bind("ctrl+p", "command-palette", KeyContext.Global),
  bind("ctrl+shift+f", "global-search", KeyContext.Global),
  bind("ctrl+r", "history-search", KeyContext.Global),
  bind("ctrl+b", "background-task", KeyContext.Global),
  bind("ctrl+shift+x", "emergency-halt", KeyContext.Global),
  bind("ctrl+shift+p", "privacy-toggle", KeyContext.Global),
  bind("ctrl+e", "expand-collapse", KeyContext.Global),

  // Chat
  bind("enter", "submit", KeyContext.Chat),
  bind("escape", "cancel", KeyContext.Chat),
  bind("ctrl+z", "undo-input", KeyContext.Chat),

  // Approval
  bind("y", "approve", KeyContext.Approval),
  bind("n", "deny", KeyContext.Approval),
  bind("a", "always-allow", KeyContext.Approval),

  // Scroll
  bind("j", "scroll-down", KeyContext.Scroll),
  bind("k", "scroll-up", KeyContext.Scroll),
  bind("g", "scroll-top", KeyContext.Scroll),
  bind("shift+g", "scroll-bottom", KeyContext.Scroll),
  bind("ctrl+d", "page-down", KeyContext.Scroll),
  bind("ctrl+u", "page-up", KeyContext.Scroll),

  // Order Entry
  bind("ctrl+shift+b", "buy-market", KeyContext.OrderEntry),
  bind("ctrl+shift+s", "sell-market", KeyContext.OrderEntry),

  // Dialog
  bind("escape", "cancel", KeyContext.Dialog),
  bind("enter", "submit", KeyContext.Dialog),

  // Settings
  bind("escape", "cancel", KeyContext.Settings),

  // Tabs
  bind("tab", "next-tab", KeyContext.Tabs),
  bind("shift+tab", "prev-tab", KeyContext.Tabs),
];
