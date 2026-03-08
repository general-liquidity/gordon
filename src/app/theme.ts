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

export const darkTheme: Theme = {
  name: "dark",
  colors: {
    primary: "#fafafa",
    secondary: "#a1a1aa",
    text: "#fafafa",
    textDim: "#52525b",
    background: "#09090b",
    success: "#22c55e",
    error: "#ef4444",
    warning: "#d97706",
    info: "#22d3ee",
    border: "#52525b",
    userMessage: "#27272a",
    assistantMessage: "#e5e5e5",
    highlight: "#22c55e",
    accent: "#bbf7d0",
    accentDim: "#6b8f71",
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
  WHITE: "#fafafa",
  SECONDARY: "#a1a1aa",
  MUTED: "#52525b",

  // Accent (replacing old TAN)
  ACCENT: "#bbf7d0",
  ACCENT_DIM: "#6b8f71",

  // Legacy aliases for backward compatibility
  TAN: "#bbf7d0",
  TAN_DIM: "#6b8f71",
  DIM: "#52525b",

  // Semantic colors
  ERROR: "#ef4444",
  WARNING: "#d97706",
  SUCCESS: "#22c55e",

  // Status colors (legacy aliases)
  RED: "#ef4444",
  YELLOW: "#f59e0b",
  GREEN: "#22c55e",
  BLUE: "#22d3ee",
  CYAN: "#22d3ee",
  PURPLE: "#c084fc",
  ORANGE: "#f97316",
  HIGHLIGHT: "#22c55e",
  DISCOVER: "#22d3ee",
  ANALYZE: "#c084fc",
  TRADE: "#22c55e",
  RUN: "#f59e0b",
  RAILS: "#c084fc",
  OPERATE: "#f97316",

  // Background hints (for reference, Ink uses terminal bg)
  BG: "#09090b",
  BG_ELEVATED: "#18181b",

  // Chat backgrounds
  USER_BG: "#27272a",
  GORDON_BG: "#18181b",
} as const;

export type ColorKey = keyof typeof COLORS;
export type ThemeName = "dark" | "light";
