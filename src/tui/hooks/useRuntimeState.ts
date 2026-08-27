/**
 * useRuntimeState — Subscribe to RuntimeStore with a selector
 *
 * Bridges the RuntimeStore (non-React, EventEmitter-based) into React
 * by subscribing to store changes and re-rendering only when the
 * selected slice changes (via Object.is comparison).
 *
 * Phase 3 of the 100% parity plan.
 */

import { useRef, useCallback, useSyncExternalStore } from "react";
import { getRuntime } from "../bridge/runtime.js";
import type { RuntimeSessionState } from "../../runtime/state/SessionState.ts";

// ============================================================================
// Default state — returned when no runtime is initialized yet
// ============================================================================

const DEFAULT_STATE: RuntimeSessionState = {
  runtimeId: "",
  session: { runtimeId: "" },
  stream: { status: "idle" },
  background: { lastRefreshAt: null, tasks: [] },
  tooling: {
    lastSyncedAt: null,
    lastReloadAt: null,
    hotReloadEnabled: false,
    routingCount: 0,
    plugins: [],
    mcpServers: [],
    tools: [],
    commands: [],
  },
  remote: { connectionStatus: "offline", reachable: false, updatedAt: null },
  approvals: { pending: [], recent: [], rules: [], lastUpdatedAt: null },
  bridge: { active: [], recent: [], lastUpdatedAt: null },
  permissionScopes: [],
  lastUpdatedAt: new Date().toISOString(),
};

// ============================================================================
// useRuntimeState — selector-based subscription
// ============================================================================

/**
 * Subscribe to a slice of the RuntimeStore state. Re-renders only when
 * the selected value changes according to Object.is.
 *
 * @param selector  Function that extracts the desired slice from RuntimeSessionState
 * @returns         The selected slice value
 *
 * @example
 *   const streamStatus = useRuntimeState((s) => s.stream.status);
 *   const toolCount = useRuntimeState((s) => s.tooling.tools.length);
 */
export function useRuntimeState<T>(selector: (state: RuntimeSessionState) => T): T {
  const selectorRef = useRef(selector);
  selectorRef.current = selector;

  const subscribe = useCallback((onStoreChange: () => void): (() => void) => {
    const runtime = getRuntime();
    if (!runtime) {
      // No runtime yet — nothing to subscribe to
      return () => {};
    }
    // RuntimeStore listener receives state, but useSyncExternalStore needs () => void
    return runtime.subscribe(() => onStoreChange());
  }, []);

  const getSnapshot = useCallback((): T => {
    const runtime = getRuntime();
    if (!runtime) {
      return selectorRef.current(DEFAULT_STATE);
    }
    return selectorRef.current(runtime.getState());
  }, []);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Get the full runtime state (non-reactive, imperative read).
 * Useful inside event handlers where you need a one-time snapshot.
 */
export function getRuntimeStateSnapshot(): RuntimeSessionState {
  const runtime = getRuntime();
  return runtime ? runtime.getState() : DEFAULT_STATE;
}
