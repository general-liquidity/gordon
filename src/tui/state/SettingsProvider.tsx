/**
 * SettingsProvider — Persistent settings context
 *
 * Loads from ~/.gordon/settings.json on mount. Saves on change.
 * Provides useSettings() hook for consuming components.
 *
 * Phase 16 of the TUI rebuild.
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ============================================================================
// Settings Shape
// ============================================================================

export type PermissionModeSetting = "auto" | "ask" | "strict";
export type RiskLevel = "conservative" | "moderate" | "aggressive";
export type ThemeSetting = "dark" | "light" | "system";

export interface GordonSettings {
  permissionMode: PermissionModeSetting;
  riskLevel: RiskLevel;
  cashReservePercent: number;
  maxPositionSizePct: number;
  maxConcurrentTrades: number;
  defaultExchange: string;
  defaultBroker: string;
  theme: ThemeSetting;
  keybindings: Record<string, string>;
}

export const DEFAULT_SETTINGS: GordonSettings = {
  permissionMode: "ask",
  riskLevel: "moderate",
  cashReservePercent: 20,
  maxPositionSizePct: 5,
  maxConcurrentTrades: 3,
  defaultExchange: "",
  defaultBroker: "",
  theme: "dark",
  keybindings: {},
};

// ============================================================================
// File path
// ============================================================================

const SETTINGS_DIR = path.join(os.homedir(), ".gordon");
const SETTINGS_PATH = path.join(SETTINGS_DIR, "settings.json");

// ============================================================================
// IO helpers
// ============================================================================

function loadSettings(): GordonSettings {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const raw = fs.readFileSync(SETTINGS_PATH, "utf-8");
      const parsed = JSON.parse(raw) as Partial<GordonSettings>;
      return { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch {
    // Corrupt or unreadable — fall back to defaults
  }
  return { ...DEFAULT_SETTINGS };
}

function persistSettings(settings: GordonSettings): void {
  try {
    if (!fs.existsSync(SETTINGS_DIR)) {
      fs.mkdirSync(SETTINGS_DIR, { recursive: true });
    }
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), "utf-8");
  } catch {
    // Silently fail — settings are best-effort
  }
}

// ============================================================================
// Context
// ============================================================================

interface SettingsContextValue {
  settings: GordonSettings;
  update: <K extends keyof GordonSettings>(key: K, value: GordonSettings[K]) => void;
  updateMany: (patch: Partial<GordonSettings>) => void;
  reload: () => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

// ============================================================================
// Provider
// ============================================================================

interface Props {
  children: ReactNode;
  /** Override initial settings (useful for tests) */
  initialSettings?: Partial<GordonSettings>;
}

export function SettingsProvider({ children, initialSettings }: Props) {
  const [settings, setSettings] = useState<GordonSettings>(() => {
    const loaded = loadSettings();
    return initialSettings ? { ...loaded, ...initialSettings } : loaded;
  });

  // Persist whenever settings change (skip initial mount)
  const mountedRef = React.useRef(false);
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    persistSettings(settings);
  }, [settings]);

  const update = useCallback(
    <K extends keyof GordonSettings>(key: K, value: GordonSettings[K]) => {
      setSettings((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const updateMany = useCallback((patch: Partial<GordonSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const reload = useCallback(() => {
    setSettings(loadSettings());
  }, []);

  return (
    <SettingsContext.Provider value={{ settings, update, updateMany, reload }}>
      {children}
    </SettingsContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Access the settings context. Must be used within <SettingsProvider>.
 *
 * @example
 *   const { settings, update } = useSettings();
 *   update("riskLevel", "aggressive");
 */
export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) {
    throw new Error("useSettings must be used within <SettingsProvider>");
  }
  return ctx;
}

/** Re-export the settings file path for watchers */
export { SETTINGS_PATH };
