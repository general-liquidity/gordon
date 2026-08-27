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

/**
 * Flags that halt trading, gate money movement, set risk limits, or point a
 * safety gate at its state file.
 *
 * The `project` layer is `<cwd>/.gordon/settings.json` — a file a repository
 * can carry. Once flag reads fall through to the settings layers, a cloned repo
 * that ships one of these values governs the halt it is supposed to be subject
 * to: `GORDON_KILL_SWITCHES: "0"` disables the firm-wide halt at every venue,
 * and the `GORDON_RISK_*` values widen the kernel that gates order size. So
 * these resolve from env, the operator's own home-directory settings, and the
 * signed policy layer only. Every other flag keeps the full chain.
 */
const SAFETY_CRITICAL_FLAGS = new Set([
  "GORDON_KILL_SWITCHES",
  "GORDON_KILL_SWITCH_STATE_PATH",
  "GORDON_ALLOW_LIVE",
  "GORDON_PRODUCTION",
  "GORDON_GUARDS",
  "GORDON_DISABLE_GUARDS",
  "GORDON_SAFETY_CONFIG_GUARD",
  "GORDON_PROCESS_HARDENING",
  "GORDON_SANDBOX_SUBPROCESS",
  "GORDON_EXTERNAL_HOOK_RUNNER",
  "GORDON_EXTERNAL_HOOKS_PATH",
  "GORDON_PERMISSION_PROFILE",
  "GORDON_TRUST_LEDGER_PATH",
  "GORDON_CONSENT_PATH",
  "GORDON_CONSTITUTION_HALT_PATH",
  "GORDON_RISK_ACK",
  "GORDON_RISK_MODE",
  "GORDON_RISK_AUTO_ADJUST",
  "GORDON_RISK_REQUIRE_APPROVAL",
  "GORDON_RISK_MAX_LEVERAGE",
  "GORDON_RISK_MAX_POSITION_USD",
  "GORDON_RISK_MAX_POSITION_PERCENT",
  "GORDON_RISK_MAX_OPEN_POSITIONS",
  "GORDON_RISK_MAX_DRAWDOWN_PERCENT",
  "GORDON_RISK_MAX_SINGLE_ASSET_EXPOSURE",
  "GORDON_RISK_MAX_CORRELATED_EXPOSURE",
  "GORDON_RISK_DAILY_LOSS_USD",
  "GORDON_RISK_DAILY_LOSS_PERCENT",
  "GORDON_ABSORBING_BARRIER",
  "GORDON_INCEPTION_LOSS_FRACTION",
  "GORDON_INCEPTION_EQUITY_USD",
  "GORDON_TRAILING_DD_FRACTION",
  "GORDON_PRETRADE_RATE_CONTROLS",
  "GORDON_PRETRADE_RATE_CONTROLS_DISABLE",
  "GORDON_NETWORK_ALLOWLIST",
  "GORDON_NETWORK_ALLOWLIST_MODE",
  "GORDON_FILESYSTEM_WRITE_GUARD",
  "GORDON_FILESYSTEM_WRITE_GUARD_MODE",
  "GORDON_CLEAN_STATE_GATE",
  "GORDON_CLEAN_STATE_GATE_OVERRIDE",
  "GORDON_WIP_LIMIT",
  "GORDON_WIP_LIMIT_ENABLED",
  "GORDON_WIP_LIMIT_GLOBAL",
  "GORDON_WIP_LIMIT_PER_STRATEGY",
  "GORDON_WIP_LIMIT_PER_SYMBOL",
]);

/** Layers a repository can supply, and therefore an attacker who ships one. */
const UNTRUSTED_SAFETY_LAYERS = new Set(["project"]);

function loadSettingsFlags(): Record<string, string> {
  if (cachedFlags) return cachedFlags;
  const out: Record<string, string> = {};
  try {
    // Walked per layer rather than off the merged config: the merge is what
    // erases which file a given flag came from, and that is exactly what
    // decides whether a safety-critical value is allowed to apply. The array
    // is already sorted low-to-high priority by loadLayeredSettings.
    const { layers } = loadLayeredSettings();
    for (const layer of layers) {
      const flags = (layer.values as Record<string, unknown>).flags;
      if (!flags || typeof flags !== "object" || Array.isArray(flags)) continue;
      const untrusted = UNTRUSTED_SAFETY_LAYERS.has(layer.layer);
      for (const [k, v] of Object.entries(flags as Record<string, unknown>)) {
        if (v === undefined || v === null) continue;
        if (untrusted && SAFETY_CRITICAL_FLAGS.has(k)) continue;
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
