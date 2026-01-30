/**
 * Theme Provider Component
 * Provides theme context for dark/light mode switching
 */

import React, { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import type { Theme, ThemeName } from "../theme.ts";
import { darkTheme, lightTheme } from "../theme.ts";

interface ThemeContextType {
  theme: Theme;
  themeName: ThemeName;
  toggleTheme: () => void;
  setTheme: (name: ThemeName) => void;
}

const ThemeContext = createContext<ThemeContextType | null>(null);

const THEME_STORAGE_KEY = "gordon-theme";

function loadSavedTheme(): ThemeName {
  // Try to load from environment or localStorage equivalent
  // For CLI, we use a simple in-memory default with potential file-based persistence
  const envTheme = process.env.GORDON_THEME;
  if (envTheme === "light" || envTheme === "dark") {
    return envTheme;
  }
  return "dark";
}

interface ThemeProviderProps {
  children: ReactNode;
  initialTheme?: ThemeName;
}

export function ThemeProvider({ children, initialTheme }: ThemeProviderProps): React.ReactElement {
  const [themeName, setThemeName] = useState<ThemeName>(initialTheme ?? loadSavedTheme());

  const theme = themeName === "dark" ? darkTheme : lightTheme;

  const toggleTheme = useCallback((): void => {
    setThemeName((prev) => (prev === "dark" ? "light" : "dark"));
  }, []);

  const setTheme = useCallback((name: ThemeName): void => {
    setThemeName(name);
  }, []);

  const value: ThemeContextType = {
    theme,
    themeName,
    toggleTheme,
    setTheme,
  };

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextType {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}

/**
 * Hook that returns true if the current theme is dark
 */
export function useIsDarkTheme(): boolean {
  const { themeName } = useTheme();
  return themeName === "dark";
}

/**
 * Hook that returns the current theme colors
 */
export function useThemeColors(): Theme["colors"] {
  const { theme } = useTheme();
  return theme.colors;
}

export default ThemeProvider;
