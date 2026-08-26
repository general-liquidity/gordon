import { createDefaultRuntimeSessionState } from "../state/SessionState.ts";
import { RuntimeStore } from "../state/RuntimeStore.ts";
import { PermissionEngine } from "./PermissionEngine.ts";
import { buildTrustTrajectoryHook, getDefaultTrustTrajectory } from "./trustTrajectory.ts";
import { buildPermissionProfileHook } from "./profiles.ts";

let defaultEngine: PermissionEngine | null = null;

export function createPermissionEngine(
  runtimeId: string,
  sessionId?: string,
): PermissionEngine {
  const store = new RuntimeStore(createDefaultRuntimeSessionState(runtimeId, sessionId));
  const engine = new PermissionEngine(store);
  engine.prependHook(buildTrustTrajectoryHook(getDefaultTrustTrajectory()));
  // Profile hook: abstains entirely when no profile is selected
  // (GORDON_PERMISSION_PROFILE unset) → default gating behavior is unchanged.
  engine.prependHook(buildPermissionProfileHook());
  return engine;
}

/** Process-singleton used by ACP and other surfaces without a SessionRuntime. */
export function getDefaultPermissionEngine(): PermissionEngine {
  if (!defaultEngine) {
    defaultEngine = createPermissionEngine("default-permission-engine");
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
