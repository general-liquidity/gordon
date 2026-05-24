/**
 * FW7 — In-process subagent profile registry.
 *
 * Loaded once at startup; the registry is the source of truth for what
 * profile-defined subagents are available during this Gordon session.
 *
 * Why singleton: profile content is operator-authored, immutable across
 * the process lifetime (changing requires a restart, same as
 * Mastra Agent construction). Live mutation is intentionally not
 * supported — operators who want hot-reload can re-export the registry
 * for tests but production code uses the singleton.
 */

import { loadSubagentProfiles } from "./subagentProfileLoader.ts";
import type { SubagentProfile } from "./subagentProfile.ts";
import { applyGeneralPurposeFallback } from "./generalPurposeProfile.ts";

let cachedRegistry: ReadonlyMap<string, SubagentProfile> | undefined;

/**
 * Initialize the registry from disk. Idempotent — subsequent calls
 * return the cached set. Tests use `_resetSubagentProfileRegistry`.
 *
 * Applies the general-purpose fallback (Patch 2) when operator profiles
 * are empty and the fallback isn't opt-out via env.
 */
export function getSubagentProfileRegistry(): ReadonlyMap<string, SubagentProfile> {
  if (cachedRegistry) return cachedRegistry;
  const loaded = loadSubagentProfiles();
  cachedRegistry = applyGeneralPurposeFallback(loaded.profiles);
  return cachedRegistry;
}

/**
 * Replace the registry contents. Production callers use this only at
 * startup if they want to inject a pre-loaded set (e.g. an alternative
 * config source). Tests use it freely.
 */
export function setSubagentProfileRegistry(
  registry: ReadonlyMap<string, SubagentProfile>,
): void {
  cachedRegistry = registry;
}

/** Test helper — reset to "uninitialized" so the next get re-reads from disk. */
export function _resetSubagentProfileRegistryForTests(): void {
  cachedRegistry = undefined;
}
