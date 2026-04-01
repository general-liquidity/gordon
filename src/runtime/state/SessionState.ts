import type {
  RuntimeApprovalState,
  RuntimeBridgeState,
  RuntimePermissionScope,
  RuntimeRemoteState,
  RuntimeSessionContext,
  RuntimeSessionSnapshot,
  RuntimeToolingState,
} from "../contracts/types.ts";
import type { RuntimeBackgroundState } from "./BackgroundState.ts";
import type { RuntimeStreamState } from "./StreamState.ts";

export interface RuntimeSessionState {
  runtimeId: string;
  sessionId?: string;
  session: RuntimeSessionContext & {
    snapshot?: RuntimeSessionSnapshot;
  };
  stream: RuntimeStreamState;
  background: RuntimeBackgroundState;
  tooling: RuntimeToolingState;
  remote: RuntimeRemoteState;
  approvals: RuntimeApprovalState;
  bridge: RuntimeBridgeState;
  permissionScopes: RuntimePermissionScope[];
  lastUserMessage?: string;
  lastAssistantMessage?: string;
  lastError?: string;
  lastUpdatedAt: string;
}

export function createDefaultRuntimeSessionState(runtimeId: string, sessionId?: string): RuntimeSessionState {
  return {
    runtimeId,
    sessionId,
    session: {
      runtimeId,
      sessionId,
    },
    stream: {
      status: "idle",
    },
    background: {
      lastRefreshAt: null,
      tasks: [],
    },
    tooling: {
      lastSyncedAt: null,
      plugins: [],
      mcpServers: [],
      tools: [],
      commands: [],
    },
    remote: {
      connectionStatus: "offline",
      reachable: false,
      updatedAt: null,
    },
    approvals: {
      pending: [],
      recent: [],
      rules: [],
      lastUpdatedAt: null,
    },
    bridge: {
      active: [],
      recent: [],
      lastUpdatedAt: null,
    },
    permissionScopes: [],
    lastUpdatedAt: new Date().toISOString(),
  };
}
