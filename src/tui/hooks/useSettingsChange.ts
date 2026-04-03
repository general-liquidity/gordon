/**
 * useSettingsChange — Watch ~/.gordon/settings.json for external changes
 *
 * Uses fs.watch to detect modifications and triggers reload on the
 * SettingsProvider when the file changes.
 *
 * Phase 16 of the TUI rebuild.
 */

import { useEffect, useRef } from "react";
import * as fs from "node:fs";
import * as path from "node:path";
import { SETTINGS_PATH, useSettings } from "../state/SettingsProvider.js";

/**
 * Watches the settings file for external changes. When modified,
 * calls reload() on the SettingsProvider to pick up the new values.
 *
 * Should be called once near the root of the component tree.
 *
 * @example
 *   function App() {
 *     useSettingsChange();
 *     return <ChatView />;
 *   }
 */
export function useSettingsChange(): void {
  const { reload } = useSettings();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const dir = path.dirname(SETTINGS_PATH);
    const basename = path.basename(SETTINGS_PATH);

    // Ensure directory exists before watching
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch {
        return;
      }
    }

    let watcher: fs.FSWatcher | null = null;

    try {
      watcher = fs.watch(dir, (eventType, filename) => {
        if (filename !== basename) return;
        if (eventType !== "change" && eventType !== "rename") return;

        // Debounce rapid writes (e.g. editor save)
        if (debounceRef.current) {
          clearTimeout(debounceRef.current);
        }
        debounceRef.current = setTimeout(() => {
          reload();
          debounceRef.current = null;
        }, 200);
      });
    } catch {
      // fs.watch may not be available on all platforms
    }

    return () => {
      if (watcher) {
        watcher.close();
      }
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [reload]);
}
