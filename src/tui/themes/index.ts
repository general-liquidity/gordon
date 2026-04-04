// ============================================================================
// Theme System — Barrel Export
// ============================================================================

export { type GordonTheme, THEMES, THEME_NAMES, DARK_THEME, LIGHT_THEME, DARK_DALTONIZED_THEME, LIGHT_DALTONIZED_THEME, DARK_HIGH_CONTRAST_THEME, LIGHT_HIGH_CONTRAST_THEME } from "./themes.js";
export { ThemeProvider, useTheme, useSetTheme, useThemeColor } from "./ThemeProvider.js";
export { detectSystemTheme } from "./systemThemeWatcher.js";
