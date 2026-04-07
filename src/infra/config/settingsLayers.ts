/**
 * 7-Level Settings Priority Chain
 *
 * Claude Code pattern: settings merge from 7 layers, higher priority wins.
 *   1. CLI flags (--permissionMode auto)          — highest
 *   2. Session overrides (in-memory, not persisted)
 *   3. Policy settings (organization rules)
 *   4. Local settings (~/.gordon/settings.local.json)
 *   5. Project settings (.gordon/settings.json)
 *   6. Profile settings (~/.gordon/profiles/{name}.json)
 *   7. Defaults (built-in)                        — lowest
 *
 * Each layer is a partial config. Merge is shallow per top-level key,
 * deep for nested objects (exchanges, risk, etc.).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GORDON_DIR } from "../storage/paths.ts";

// ============================================================================
// Types
// ============================================================================

export type SettingsLayer =
  | "cli"
  | "session"
  | "policy"
  | "local"
  | "project"
  | "profile"
  | "defaults";

export interface LayeredSettings {
  /** The layer this came from. */
  layer: SettingsLayer;
  /** Partial config — only keys present in this layer. */
  values: Record<string, unknown>;
  /** Source file path (if file-based). */
  source?: string;
}

export interface MergedSettings {
  /** Final merged config. */
  config: Record<string, unknown>;
  /** Which layer each key came from (for debugging). */
  provenance: Record<string, SettingsLayer>;
  /** All layers loaded (for inspection). */
  layers: LayeredSettings[];
}

// ============================================================================
// Layer Loading
// ============================================================================

const LAYER_PRIORITY: SettingsLayer[] = [
  "defaults",
  "profile",
  "project",
  "local",
  "policy",
  "session",
  "cli",
];

function loadJsonFile(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function loadDefaultsLayer(): LayeredSettings {
  return {
    layer: "defaults",
    values: {
      permissionMode: "ask",
      startupBannerMode: "full",
      onboardingComplete: false,
      useKeyring: false,
    },
  };
}

function loadProfileLayer(profileName?: string): LayeredSettings | null {
  const name = profileName ?? "default";
  const path = join(GORDON_DIR, "profiles", `${name}.json`);
  const values = loadJsonFile(path);
  if (!values) return null;
  return { layer: "profile", values, source: path };
}

function loadProjectLayer(cwd: string = process.cwd()): LayeredSettings | null {
  const path = join(cwd, ".gordon", "settings.json");
  const values = loadJsonFile(path);
  if (!values) return null;
  return { layer: "project", values, source: path };
}

function loadLocalLayer(): LayeredSettings | null {
  const path = join(GORDON_DIR, "settings.local.json");
  const values = loadJsonFile(path);
  if (!values) return null;
  return { layer: "local", values, source: path };
}

function loadPolicyLayer(): LayeredSettings | null {
  const path = join(GORDON_DIR, "policy.json");
  const values = loadJsonFile(path);
  if (!values) return null;
  return { layer: "policy", values, source: path };
}

// ============================================================================
// In-Memory Layers (CLI flags + session overrides)
// ============================================================================

let sessionOverrides: Record<string, unknown> = {};
let cliOverrides: Record<string, unknown> = {};

/** Set a session-scoped override (lost on restart). */
export function setSessionOverride(key: string, value: unknown): void {
  sessionOverrides[key] = value;
}

/** Clear all session overrides. */
export function clearSessionOverrides(): void {
  sessionOverrides = {};
}

/** Set CLI flag overrides (from argv parsing at startup). */
export function setCliOverrides(overrides: Record<string, unknown>): void {
  cliOverrides = { ...overrides };
}

// ============================================================================
// Deep Merge
// ============================================================================

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof result[key] === "object" &&
      result[key] !== null &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(
        result[key] as Record<string, unknown>,
        value as Record<string, unknown>,
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}

// ============================================================================
// Main: Load & Merge All Layers
// ============================================================================

export interface LoadSettingsOptions {
  profileName?: string;
  cwd?: string;
}

/**
 * Load all 7 layers and merge them in priority order.
 * Returns the final config + provenance tracking.
 */
export function loadLayeredSettings(options: LoadSettingsOptions = {}): MergedSettings {
  const layers: LayeredSettings[] = [];

  // Load all layers
  layers.push(loadDefaultsLayer());

  const profile = loadProfileLayer(options.profileName);
  if (profile) layers.push(profile);

  const project = loadProjectLayer(options.cwd);
  if (project) layers.push(project);

  const local = loadLocalLayer();
  if (local) layers.push(local);

  const policy = loadPolicyLayer();
  if (policy) layers.push(policy);

  if (Object.keys(sessionOverrides).length > 0) {
    layers.push({ layer: "session", values: { ...sessionOverrides } });
  }

  if (Object.keys(cliOverrides).length > 0) {
    layers.push({ layer: "cli", values: { ...cliOverrides } });
  }

  // Sort by priority (lowest first so higher overwrites)
  layers.sort(
    (a, b) => LAYER_PRIORITY.indexOf(a.layer) - LAYER_PRIORITY.indexOf(b.layer),
  );

  // Merge
  let config: Record<string, unknown> = {};
  const provenance: Record<string, SettingsLayer> = {};

  for (const layer of layers) {
    for (const key of Object.keys(layer.values)) {
      provenance[key] = layer.layer;
    }
    config = deepMerge(config, layer.values);
  }

  return { config, provenance, layers };
}

/**
 * Get which layer a specific setting came from.
 */
export function getSettingProvenance(key: string, options?: LoadSettingsOptions): SettingsLayer | null {
  const { provenance } = loadLayeredSettings(options);
  return provenance[key] ?? null;
}
