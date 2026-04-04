// ============================================================================
// Keybinding Types — Context-aware, chord-supporting keybinding system
// ============================================================================

export enum KeyContext {
  Global = "Global",
  Chat = "Chat",
  Approval = "Approval",
  Scroll = "Scroll",
  Dialog = "Dialog",
  CommandPalette = "CommandPalette",
  OrderEntry = "OrderEntry",
  Monitoring = "Monitoring",
  HistorySearch = "HistorySearch",
  Settings = "Settings",
  Tabs = "Tabs",
}

export interface ParsedKeystroke {
  key: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
}

export type KeyChord = ParsedKeystroke[];

export interface KeyBinding {
  chord: KeyChord;
  action: KeybindingAction;
  context: KeyContext;
}

export type KeybindingAction =
  | "command-palette"
  | "global-search"
  | "history-search"
  | "emergency-halt"
  | "privacy-toggle"
  | "background-task"
  | "submit"
  | "cancel"
  | "approve"
  | "deny"
  | "always-allow"
  | "scroll-up"
  | "scroll-down"
  | "scroll-top"
  | "scroll-bottom"
  | "page-up"
  | "page-down"
  | "buy-market"
  | "sell-market"
  | "expand-collapse"
  | "undo-input"
  | "vim-toggle"
  | "copy-response"
  | "search-transcript"
  | "next-match"
  | "prev-match"
  | "toggle-help"
  | "next-tab"
  | "prev-tab";
