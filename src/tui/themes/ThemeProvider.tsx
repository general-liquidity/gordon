import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { DARK_THEME, THEMES, type GordonTheme } from "./themes.js";

// ============================================================================
// Theme Provider — React context for the active Gordon theme
// ============================================================================

const ThemeContext = createContext<{ theme: GordonTheme; setTheme: (name: string) => void }>({
  theme: DARK_THEME,
  setTheme: () => {},
});

export function ThemeProvider({
  children,
  initialTheme,
}: {
  children: ReactNode;
  initialTheme?: string;
}) {
  const [theme, setThemeState] = useState<GordonTheme>(
    (initialTheme ? THEMES[initialTheme] : undefined) ?? DARK_THEME,
  );

  const setTheme = useCallback((name: string) => {
    const t = THEMES[name];
    if (t) setThemeState(t);
  }, []);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): GordonTheme {
  return useContext(ThemeContext).theme;
}

export function useSetTheme(): (name: string) => void {
  return useContext(ThemeContext).setTheme;
}

export function useThemeColor(token: keyof GordonTheme): string {
  const theme = useTheme();
  return theme[token] as string;
}
