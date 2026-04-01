import { EventEmitter } from "node:events";
import type {
  RuntimeApprovalState,
  RuntimeBridgeState,
  RuntimePermissionScope,
  RuntimeRemoteState,
  RuntimeSessionContext,
  RuntimeToolingState,
} from "../contracts/types.ts";
import type { RuntimeSessionState } from "./SessionState.ts";

type RuntimeStoreListener = (state: RuntimeSessionState) => void;

export class RuntimeStore {
  private readonly emitter = new EventEmitter();
  private state: RuntimeSessionState;

  constructor(initialState: RuntimeSessionState) {
    this.state = initialState;
  }

  getState(): RuntimeSessionState {
    return this.state;
  }

  subscribe(listener: RuntimeStoreListener): () => void {
    this.emitter.on("change", listener);
    return () => {
      this.emitter.off("change", listener);
    };
  }

  replace(nextState: RuntimeSessionState): RuntimeSessionState {
    this.state = nextState;
    this.emit();
    return this.state;
  }

  patch(patch: Partial<RuntimeSessionState>): RuntimeSessionState {
    this.state = {
      ...this.state,
      ...patch,
      lastUpdatedAt: new Date().toISOString(),
    };
    this.emit();
    return this.state;
  }

  setSession(session: RuntimeSessionContext, snapshot?: RuntimeSessionState["session"]["snapshot"]): RuntimeSessionState {
    return this.patch({
      session: {
        ...session,
        snapshot,
      },
    });
  }

  setPermissionScopes(scopes: RuntimePermissionScope[]): RuntimeSessionState {
    return this.patch({
      permissionScopes: [...new Set(scopes)].sort(),
    });
  }

  startStream(input: { session: RuntimeSessionContext; userMessage: string }): RuntimeSessionState {
    return this.patch({
      session: {
        ...input.session,
        snapshot: this.state.session.snapshot,
      },
      lastUserMessage: input.userMessage,
      stream: {
        status: "running",
        startedAt: new Date().toISOString(),
      },
      lastError: undefined,
    });
  }

  markAgentSwitch(agentName: string): RuntimeSessionState {
    return this.patch({
      stream: {
        ...this.state.stream,
        activeAgent: agentName,
        lastEventType: "agent_switch",
      },
    });
  }

  markToolEvent(eventType: string): RuntimeSessionState {
    return this.patch({
      stream: {
        ...this.state.stream,
        lastEventType: eventType,
      },
    });
  }

  setBackgroundTasks(tasks: RuntimeSessionState["background"]["tasks"]): RuntimeSessionState {
    return this.patch({
      background: {
        lastRefreshAt: new Date().toISOString(),
        tasks,
      },
    });
  }

  setToolingState(tooling: Partial<RuntimeToolingState>): RuntimeSessionState {
    return this.patch({
      tooling: {
        ...this.state.tooling,
        ...tooling,
        lastReloadAt: tooling.lastReloadAt ?? this.state.tooling.lastReloadAt,
        hotReloadEnabled: tooling.hotReloadEnabled ?? this.state.tooling.hotReloadEnabled,
        routingCount: tooling.routingCount ?? this.state.tooling.routingCount,
        plugins: tooling.plugins ? [...tooling.plugins] : this.state.tooling.plugins,
        mcpServers: tooling.mcpServers ? [...tooling.mcpServers] : this.state.tooling.mcpServers,
        tools: tooling.tools ? [...tooling.tools] : this.state.tooling.tools,
        commands: tooling.commands ? [...tooling.commands] : this.state.tooling.commands,
        lastSyncedAt: tooling.lastSyncedAt ?? new Date().toISOString(),
      },
    });
  }

  setRemoteState(remote: Partial<RuntimeRemoteState>): RuntimeSessionState {
    return this.patch({
      remote: {
        ...this.state.remote,
        ...remote,
        updatedAt: remote.updatedAt ?? new Date().toISOString(),
      },
    });
  }

  setApprovalState(approvals: Partial<RuntimeApprovalState>): RuntimeSessionState {
    return this.patch({
      approvals: {
        ...this.state.approvals,
        ...approvals,
        pending: approvals.pending ? [...approvals.pending] : this.state.approvals.pending,
        recent: approvals.recent ? [...approvals.recent] : this.state.approvals.recent,
        rules: approvals.rules ? [...approvals.rules] : this.state.approvals.rules,
        lastUpdatedAt: approvals.lastUpdatedAt ?? new Date().toISOString(),
      },
    });
  }

  setBridgeState(bridge: Partial<RuntimeBridgeState>): RuntimeSessionState {
    return this.patch({
      bridge: {
        ...this.state.bridge,
        ...bridge,
        active: bridge.active ? [...bridge.active] : this.state.bridge.active,
        recent: bridge.recent ? [...bridge.recent] : this.state.bridge.recent,
        lastUpdatedAt: bridge.lastUpdatedAt ?? new Date().toISOString(),
      },
    });
  }

  completeStream(assistantMessage?: string): RuntimeSessionState {
    return this.patch({
      lastAssistantMessage: assistantMessage ?? this.state.lastAssistantMessage,
      stream: {
        ...this.state.stream,
        status: "completed",
        completedAt: new Date().toISOString(),
        lastEventType: "done",
      },
    });
  }

  failStream(error: string): RuntimeSessionState {
    return this.patch({
      lastError: error,
      stream: {
        ...this.state.stream,
        status: "failed",
        completedAt: new Date().toISOString(),
        lastEventType: "error",
        lastError: error,
      },
    });
  }

  private emit(): void {
    this.emitter.emit("change", this.state);
  }
}
