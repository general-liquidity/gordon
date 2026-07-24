/**
 * Flag / setting resolver — the single accessor feature modules use instead
 * of reading `process.env.GORDON_*` directly.
 *
 * Precedence (highest wins):
 *   1. explicit env override  — `process.env.GORDON_X` (set in the shell / .env)
 *   2. settings.json `flags`  — the layered settings store (project/local/…)
 *   3. built-in default       — the reader module's own fallback (unchanged)
 *
 * Rationale: env vars were the operator interface. They are now the LOWEST
 * override layer — a fallback for CI / one-off shells — while the settings
 * layer (surfaced by /flags + the TUI panels) is the durable operator surface.
 * This module only changes HOW a flag is READ; the reader modules keep their
 * own parse semantics and defaults, so no default VALUES change.
 *
 * The `flags` section of the merged settings is a flat map of GORDON_* names
 * to values, e.g.  { "flags": { "GORDON_ACE_ENABLED": "true" } }.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GORDON_DIR } from "../storage/paths.ts";
import { loadLayeredSettings } from "./settingsLayers.ts";

/** Local settings file that `/flags set` and the TUI persist flag values to. */
const LOCAL_SETTINGS_PATH = join(GORDON_DIR, "settings.local.json");

let cachedFlags: Record<string, string> | null = null;

function loadSettingsFlags(): Record<string, string> {
  if (cachedFlags) return cachedFlags;
  const out: Record<string, string> = {};
  try {
    const { config } = loadLayeredSettings();
    const flags = config.flags;
    if (flags && typeof flags === "object" && !Array.isArray(flags)) {
      for (const [k, v] of Object.entries(flags as Record<string, unknown>)) {
        if (v === undefined || v === null) continue;
        out[k] = typeof v === "string" ? v : String(v);
      }
    }
  } catch {
    // Corrupt / unreadable settings must never break flag resolution — fall
    // back to env-only behavior.
  }
  cachedFlags = out;
  return out;
}

/**
 * Invalidate the cached settings-layer flags. Call after mutating the settings
 * file (e.g. `/flags set`) or in tests that write settings between assertions.
 * process.env is always read live, so this only affects the settings fallback.
 */
export function resetFlagCache(): void {
  cachedFlags = null;
}

/**
 * Resolve a single GORDON_* flag through the precedence chain. Returns the raw
 * string value (reader modules keep their own `=== "1"` / `=== "true"` parse),
 * or undefined when neither env nor settings define it.
 */
export function resolveFlag(name: string): string | undefined {
  const envVal = process.env[name];
  if (envVal !== undefined) return envVal;
  return loadSettingsFlags()[name];
}

/**
 * A `process.env`-shaped view whose reads resolve through {@link resolveFlag}.
 * Drop-in replacement for the `env: NodeJS.ProcessEnv = process.env` default
 * parameter that many reader functions already accept — the reader indexes
 * `env[FLAG]` exactly as before, but now sees the settings-layer fallback.
 *
 * Only string GORDON_* flag reads are intercepted; anything else falls through
 * to the real `process.env`.
 */
export function flagEnv(): NodeJS.ProcessEnv {
  return new Proxy(process.env, {
    get(target, prop) {
      if (typeof prop !== "string") {
        return (target as Record<string | symbol, unknown>)[prop as never];
      }
      const envVal = target[prop];
      if (envVal !== undefined) return envVal;
      return loadSettingsFlags()[prop];
    },
    has(target, prop) {
      if (typeof prop !== "string") return prop in target;
      return target[prop] !== undefined || prop in loadSettingsFlags();
    },
  });
}

/**
 * Persist a flag value to the local settings layer so it survives restart and
 * is picked up by the resolver (env still overrides it). Passing `undefined`
 * clears the stored value (falling back to the env override or built-in
 * default). Best-effort — never throws.
 */
export function writeFlagSetting(name: string, value: string | undefined): void {
  try {
    if (!existsSync(GORDON_DIR)) mkdirSync(GORDON_DIR, { recursive: true });
    let root: Record<string, unknown> = {};
    if (existsSync(LOCAL_SETTINGS_PATH)) {
      try {
        root = JSON.parse(readFileSync(LOCAL_SETTINGS_PATH, "utf-8")) as Record<string, unknown>;
      } catch {
        root = {};
      }
    }
    const flags =
      root.flags && typeof root.flags === "object" && !Array.isArray(root.flags)
        ? (root.flags as Record<string, unknown>)
        : {};
    if (value === undefined || value === "") {
      delete flags[name];
    } else {
      flags[name] = value;
    }
    root.flags = flags;
    writeFileSync(LOCAL_SETTINGS_PATH, JSON.stringify(root, null, 2), "utf-8");
  } catch {
    // Best-effort persistence.
  } finally {
    resetFlagCache();
  }
}

/** Read the current merged `flags` map (for display surfaces like /flags, TUI). */
export function readResolvedFlags(): Record<string, string> {
  return { ...loadSettingsFlags() };
}
