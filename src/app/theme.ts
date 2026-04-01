/**
 * Gordon CLI color theme system
 * Supports dark and light themes with terminal-safe palettes.
 * Gordon is neutral-first with a green-led brand accent and semantic task colors.
 */

export interface Theme {
  name: "dark" | "light";
  colors: {
    primary: string;
    secondary: string;
    text: string;
    textDim: string;
    background: string;
    success: string;
    error: string;
    warning: string;
    info: string;
    border: string;
    userMessage: string;
    assistantMessage: string;
    highlight: string;
    accent: string;
    accentDim: string;
  };
}

export const DESK_PALETTE = {
  INK_BLACK: "#06070a",
  INK_ELEVATED: "#10131a",
  INK_PANEL: "#151922",
  PAPER: "#f2eee4",
  PAPER_DIM: "#c8c0b0",
  SMOKE: "#7d7567",
  ASH: "#4f4a42",
  BRASS: "#c7a56a",
  BRASS_DIM: "#6f5d3d",
  MONEY: "#3fcb79",
  MONEY_DIM: "#1d7a46",
  RISK: "#d96868",
  RISK_DIM: "#7d3434",
  AMBER: "#d9a441",
  AMBER_DIM: "#7d5d1e",
  ICE: "#79bfd2",
  ICE_DIM: "#3d6670",
  VIOLET: "#9385d1",
  VIOLET_DIM: "#584f8d",
  ORANGE: "#d98552",
  ORANGE_DIM: "#875233",
} as const;

export const darkTheme: Theme = {
  name: "dark",
  colors: {
    primary: DESK_PALETTE.PAPER,
    secondary: DESK_PALETTE.PAPER_DIM,
    text: DESK_PALETTE.PAPER,
    textDim: DESK_PALETTE.SMOKE,
    background: DESK_PALETTE.INK_BLACK,
    success: DESK_PALETTE.MONEY,
    error: DESK_PALETTE.RISK,
    warning: DESK_PALETTE.AMBER,
    info: DESK_PALETTE.ICE,
    border: DESK_PALETTE.BRASS_DIM,
    userMessage: DESK_PALETTE.INK_ELEVATED,
    assistantMessage: DESK_PALETTE.PAPER,
    highlight: DESK_PALETTE.MONEY,
    accent: DESK_PALETTE.BRASS,
    accentDim: DESK_PALETTE.BRASS_DIM,
  },
};

export const lightTheme: Theme = {
  name: "light",
  colors: {
    primary: "#09090b",
    secondary: "#52525b",
    text: "#09090b",
    textDim: "#71717a",
    background: "#fafafa",
    success: "#16a34a",
    error: "#dc2626",
    warning: "#d97706",
    info: "#0891b2",
    border: "#a1a1aa",
    userMessage: "#166534",
    assistantMessage: "#7c3aed",
    highlight: "#16a34a",
    accent: "#166534",
    accentDim: "#4d7c57",
  },
};

/**
 * Static COLORS object for backward compatibility
 * Components should migrate to useTheme() for dynamic theming
 */
export const COLORS = {
  // Primary text colors
  WHITE: DESK_PALETTE.PAPER,
  SECONDARY: DESK_PALETTE.PAPER_DIM,
  MUTED: DESK_PALETTE.ASH,

  // Accent (replacing old TAN)
  ACCENT: DESK_PALETTE.BRASS,
  ACCENT_DIM: DESK_PALETTE.BRASS_DIM,

  // Legacy aliases for backward compatibility
  TAN: DESK_PALETTE.BRASS,
  TAN_DIM: DESK_PALETTE.BRASS_DIM,
  DIM: DESK_PALETTE.SMOKE,

  // Semantic colors
  ERROR: DESK_PALETTE.RISK,
  WARNING: DESK_PALETTE.AMBER,
  SUCCESS: DESK_PALETTE.MONEY,

  // Status colors (legacy aliases)
  RED: DESK_PALETTE.RISK,
  YELLOW: DESK_PALETTE.AMBER,
  GREEN: DESK_PALETTE.MONEY,
  BLUE: DESK_PALETTE.ICE,
  CYAN: DESK_PALETTE.ICE,
  PURPLE: DESK_PALETTE.VIOLET,
  ORANGE: DESK_PALETTE.ORANGE,
  ORANGE_DIM: DESK_PALETTE.ORANGE_DIM,
  HIGHLIGHT: DESK_PALETTE.MONEY,
  DISCOVER: DESK_PALETTE.ICE,
  ANALYZE: DESK_PALETTE.VIOLET,
  TRADE: DESK_PALETTE.MONEY,
  RUN: DESK_PALETTE.AMBER,
  RAILS: DESK_PALETTE.ICE,
  OPERATE: DESK_PALETTE.ORANGE,

  // Desk-specific tones
  BRASS: DESK_PALETTE.BRASS,
  BRASS_DIM: DESK_PALETTE.BRASS_DIM,
  MONEY: DESK_PALETTE.MONEY,
  MONEY_DIM: DESK_PALETTE.MONEY_DIM,
  RISK: DESK_PALETTE.RISK,
  RISK_DIM: DESK_PALETTE.RISK_DIM,
  AMBER: DESK_PALETTE.AMBER,
  AMBER_DIM: DESK_PALETTE.AMBER_DIM,
  ICE: DESK_PALETTE.ICE,
  ICE_DIM: DESK_PALETTE.ICE_DIM,
  VIOLET: DESK_PALETTE.VIOLET,
  VIOLET_DIM: DESK_PALETTE.VIOLET_DIM,

  // Background hints (for reference, Ink uses terminal bg)
  BG: DESK_PALETTE.INK_BLACK,
  BG_ELEVATED: DESK_PALETTE.INK_ELEVATED,
  BG_PANEL: DESK_PALETTE.INK_PANEL,

  // Chat backgrounds
  USER_BG: DESK_PALETTE.INK_ELEVATED,
  GORDON_BG: DESK_PALETTE.INK_PANEL,
} as const;

export type ColorKey = keyof typeof COLORS;
export type ThemeName = "dark" | "light";
