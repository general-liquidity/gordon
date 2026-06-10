import { createDefaultRuntimeSessionState } from "../state/SessionState.ts";
import { RuntimeStore } from "../state/RuntimeStore.ts";
import { PermissionEngine } from "./PermissionEngine.ts";
import { buildTrustTrajectoryHook, getDefaultTrustTrajectory } from "./trustTrajectory.ts";

let defaultEngine: PermissionEngine | null = null;

function createDefaultEngine(): PermissionEngine {
  const store = new RuntimeStore(createDefaultRuntimeSessionState("default-permission-engine"));
  const engine = new PermissionEngine(store);
  engine.prependHook(buildTrustTrajectoryHook(getDefaultTrustTrajectory()));
  return engine;
}

/** Process-singleton used by ACP and other surfaces without a SessionRuntime. */
export function getDefaultPermissionEngine(): PermissionEngine {
  if (!defaultEngine) {
    defaultEngine = createDefaultEngine();
  }
  return defaultEngine;
}

/** SessionRuntimeFactory registers its per-runtime engine as the process default. */
export function registerPermissionEngine(engine: PermissionEngine): void {
  defaultEngine = engine;
}

/** Tests only. */
export function resetDefaultPermissionEngineForTesting(): void {
  defaultEngine = null;
}