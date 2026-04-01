import type { GordonContext } from "../../infra/agents/types.ts";
import { evaluateRuntimeToolPolicy, type RuntimeToolPolicyDecision } from "./ToolPolicy.ts";
import type { RuntimeSessionContext } from "../contracts/types.ts";
import type { RuntimeSessionState } from "../state/SessionState.ts";
import type { TranscriptStore } from "../transcript/TranscriptStore.ts";
import type { ScratchpadStore } from "../workers/ScratchpadStore.ts";
import type { WorkerRegistry } from "../workers/WorkerRegistry.ts";
import type { RuntimeToolExecutionContext, ToolRegistry } from "./ToolRegistry.ts";
import { PermissionEngine, ToolApprovalRequiredError } from "../permissions/PermissionEngine.ts";
import type { RuntimeHistoryResult } from "../contracts/types.ts";

export interface ToolInvocationResult<T> {
  result: T;
  policy: RuntimeToolPolicyDecision;
}

export interface PreparedToolInvocation {
  policy: RuntimeToolPolicyDecision;
  definition?: ReturnType<ToolRegistry["getDefinition"]>;
  executionContext: RuntimeToolExecutionContext;
}

export class ToolInvoker {
  private readonly toolRegistry: ToolRegistry;
  private readonly permissionEngine: PermissionEngine;

  constructor(toolRegistry: ToolRegistry, permissionEngine: PermissionEngine) {
    this.toolRegistry = toolRegistry;
    this.permissionEngine = permissionEngine;
  }

  async prepare(
    toolName: string,
    context: GordonContext,
    input: {
      session: RuntimeSessionContext;
      runtimeState: RuntimeSessionState;
      transcriptStore: TranscriptStore;
      scratchpadStore: ScratchpadStore;
      workerRegistry: WorkerRegistry;
      signal?: AbortSignal;
      listRuntimeCommands?: () => string[];
      refreshPlugins?: () => Promise<void>;
      reloadPlugins?: () => Promise<void>;
      searchHistory?: (query: string, options?: { limit?: number }) => RuntimeHistoryResult[];
    },
  ): Promise<PreparedToolInvocation> {
    const definition = this.toolRegistry.getDefinition(toolName);
    const policy = await evaluateRuntimeToolPolicy(toolName, context, undefined, definition?.spec);
    if (!policy.allowed) {
      throw new Error(policy.reason || `Tool ${toolName} blocked by runtime policy.`);
    }

    const permission = await this.permissionEngine.evaluate(toolName, context, policy);
    if (permission.status === "blocked") {
      throw new Error(permission.reason || `Tool ${toolName} blocked by permission engine.`);
    }
    if (permission.status === "pending" && permission.request) {
      throw new ToolApprovalRequiredError(permission.request);
    }

    const executionContext: RuntimeToolExecutionContext = {
      context,
      session: input.session,
      runtimeState: input.runtimeState,
      signal: input.signal,
      transcriptStore: input.transcriptStore,
      scratchpadStore: input.scratchpadStore,
      getWorkerDefinition: (worker) => input.workerRegistry.get(worker),
      getToolDefinition: (toolId) => this.toolRegistry.getDefinition(toolId),
      listRegisteredTools: () => this.toolRegistry.list(),
      listRuntimeCommands: () => input.listRuntimeCommands?.() ?? [],
      refreshPlugins: input.refreshPlugins,
      reloadPlugins: input.reloadPlugins,
      searchHistory: input.searchHistory,
    };

    return {
      policy,
      definition,
      executionContext,
    };
  }

  async invoke<T>(
    toolName: string,
    context: GordonContext,
    input: {
      session: RuntimeSessionContext;
      runtimeState: RuntimeSessionState;
      transcriptStore: TranscriptStore;
      scratchpadStore: ScratchpadStore;
      workerRegistry: WorkerRegistry;
      signal?: AbortSignal;
      executor?: () => Promise<T>;
      listRuntimeCommands?: () => string[];
      refreshPlugins?: () => Promise<void>;
      reloadPlugins?: () => Promise<void>;
      searchHistory?: (query: string, options?: { limit?: number }) => RuntimeHistoryResult[];
    },
  ): Promise<ToolInvocationResult<T>> {
    const prepared = await this.prepare(toolName, context, input);

    const definition = prepared.definition;
    const executor = definition?.execute
      ? async () => definition.execute!(prepared.executionContext) as T
      : input.executor;
    if (!executor) {
      throw new Error(`Tool ${toolName} has no registered runtime executor.`);
    }

    const result = await executor();
    return { result, policy: prepared.policy };
  }
}
