// ============================================================================
// System Theme Watcher — Detect terminal dark/light mode
// ============================================================================

export function detectSystemTheme(): "dark" | "light" | "unknown" {
  const colorFgBg = process.env.COLORFGBG;
  if (colorFgBg) {
    const parts = colorFgBg.split(";");
    const bg = parseInt(parts[parts.length - 1] ?? "0", 10);
    if (!Number.isNaN(bg)) {
      return bg > 8 ? "light" : "dark";
    }
  }
  // Most terminals default to dark
  return "dark";
}
