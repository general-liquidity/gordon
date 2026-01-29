/**
 * Gordon CLI color theme
 * Monochromatic palette matching the website design
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
