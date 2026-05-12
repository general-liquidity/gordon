/**
 * Tool-deferral wiring — at agent build time, filter the tools bundle
 * down to "core + currently-active-deferred". Mirrors ztk's pattern
 * of hiding non-core capabilities until the model explicitly searches
 * for them.
 *
 * Activation: `GORDON_TOOL_DEFERRAL` env flag. When off, the helper
 * returns the bundle unchanged so existing agent definitions behave
 * identically. When on, the bundle is filtered through the default
 * deferral registry's `filterActive()`, removing tools that are
 * classified as `deferred` and not currently active.
 *
 * Bootstrap: on first activation, the registry is seeded with
 * classifications from `classifyToolNames(Object.keys(bundle))`. This
 * means every tool in the bundle gets a default classification (core
 * vs deferred) based on the canonical-name heuristic in `toolDeferral.ts`.
 */

import {
  ToolDeferralRegistry,
  classifyToolNames,
  DEFAULT_CORE_TOOL_NAMES,
} from "../tooling/toolDeferral.ts";

const FLAG_ENV = "GORDON_TOOL_DEFERRAL";

let defaultRegistry: ToolDeferralRegistry | undefined;
let seededFromBundleHash: string | undefined;

function isEnabled(): boolean {
  return process.env[FLAG_ENV] === "1";
}

function getRegistry(): ToolDeferralRegistry {
  if (!defaultRegistry) defaultRegistry = new ToolDeferralRegistry();
  return defaultRegistry;
}

function hashBundle(bundle: Record<string, unknown>): string {
  return Object.keys(bundle).sort().join("|");
}

/**
 * Filter a tools bundle down to the active set. When `GORDON_TOOL_
 * DEFERRAL` is off, returns the bundle as-is. When on, deferred-and-
 * inactive tools are removed; core tools always pass through; unknown
 * tools pass through (default identity).
 */
export function filterBundleForDeferral<T extends Record<string, unknown>>(
  bundle: T,
): T {
  if (!isEnabled()) return bundle;
  const registry = getRegistry();
  const sig = hashBundle(bundle);
  if (seededFromBundleHash !== sig) {
    registry.setMany(classifyToolNames(Object.keys(bundle)));
    seededFromBundleHash = sig;
  }
  return registry.filterActive(bundle) as T;
}

/** Mark a deferred tool as active for this session. */
export function activateDeferred(toolName: string): void {
  getRegistry().activate(toolName);
}

/** Mark a deferred tool as inactive again. */
export function deactivateDeferred(toolName: string): void {
  getRegistry().deactivate(toolName);
}

/** Snapshot helper for /context output. */
export function snapshotDeferral(): {
  enabled: boolean;
  coreCount: number;
  deferredCount: number;
  activeDeferredCount: number;
} {
  const enabled = isEnabled();
  if (!enabled) {
    return { enabled, coreCount: 0, deferredCount: 0, activeDeferredCount: 0 };
  }
  const snap = getRegistry().snapshot();
  return {
    enabled,
    coreCount: snap.coreCount,
    deferredCount: snap.deferredCount,
    activeDeferredCount: snap.activeDeferredCount,
  };
}

/** Test helper. */
export function _resetDeferralWiringForTests(): void {
  defaultRegistry = undefined;
  seededFromBundleHash = undefined;
}

export { DEFAULT_CORE_TOOL_NAMES };
