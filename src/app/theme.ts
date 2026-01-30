/**
 * Gordon CLI color theme system
 * Supports dark and light themes with monochromatic palettes
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
    warning: "#ca8a04",
    info: "#60a5fa",
    border: "#52525b",
    userMessage: "#27272a",
    assistantMessage: "#e5e5e5",
    highlight: "#fbbf24",
    accent: "#e5e5e5",
    accentDim: "#a3a3a3",
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
    warning: "#ca8a04",
    info: "#2563eb",
    border: "#a1a1aa",
    userMessage: "#2563eb",
    assistantMessage: "#7c3aed",
    highlight: "#d97706",
    accent: "#27272a",
    accentDim: "#52525b",
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
  ACCENT: "#e5e5e5",
  ACCENT_DIM: "#a3a3a3",

  // Legacy aliases for backward compatibility
  TAN: "#e5e5e5",
  TAN_DIM: "#a3a3a3",
  DIM: "#52525b",

  // Semantic colors
  ERROR: "#ef4444",
  WARNING: "#ca8a04",
  SUCCESS: "#22c55e",

  // Status colors (legacy aliases)
  RED: "#ef4444",
  YELLOW: "#facc15",
  GREEN: "#22c55e",
  BLUE: "#60a5fa",
  HIGHLIGHT: "#fbbf24",

  // Background hints (for reference, Ink uses terminal bg)
  BG: "#09090b",
  BG_ELEVATED: "#18181b",

  // Chat backgrounds
  USER_BG: "#27272a",
  GORDON_BG: "#18181b",
} as const;

export type ColorKey = keyof typeof COLORS;
export type ThemeName = "dark" | "light";
