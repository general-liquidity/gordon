import { z } from "zod";
import {
  processMessage,
  processMessageStream,
  processStructuredMessage,
  quickCheckPositions,
  quickScan,
  type StreamEvent,
} from "../../infra/agents/orchestrator.ts";
import type { GordonContext } from "../../infra/agents/types.ts";
import type { RuntimeQueryExecutionOptions, RuntimeResolveContextOptions, RuntimeSessionContext } from "../contracts/types.ts";
import { RuntimeStore } from "../state/RuntimeStore.ts";
import { ToolInvoker } from "../tools/ToolInvoker.ts";
import { TranscriptStore } from "../transcript/TranscriptStore.ts";
import { ToolRegistry } from "../tools/ToolRegistry.ts";
import { ScratchpadStore } from "../workers/ScratchpadStore.ts";
import { WorkerRegistry } from "../workers/WorkerRegistry.ts";
import { PermissionEngine } from "../permissions/PermissionEngine.ts";

export interface QueryRuntimeDeps {
  resolveContext: (options: RuntimeResolveContextOptions) => Promise<GordonContext>;
  enrichContext?: (
    context: GordonContext,
    session: RuntimeSessionContext,
  ) => GordonContext;
  runtimeStore: RuntimeStore;
  transcriptStore: TranscriptStore;
  toolRegistry: ToolRegistry;
  scratchpadStore: ScratchpadStore;
  workerRegistry: WorkerRegistry;
  permissionEngine: PermissionEngine;
}

function bindSessionContext(context: GordonContext, session: RuntimeSessionContext): GordonContext {
  return {
    ...context,
    userId: session.resourceId ?? context.userId,
    threadId: session.threadId ?? context.threadId,
  };
}

export class QueryRuntime {
  private readonly deps: QueryRuntimeDeps;
  private readonly toolInvoker: ToolInvoker;

  constructor(deps: QueryRuntimeDeps) {
    this.deps = deps;
    this.toolInvoker = new ToolInvoker(deps.toolRegistry, deps.permissionEngine);
    this.registerBuiltInRuntimeTools();
  }

  async *streamMessage(
    userMessage: string,
    session: RuntimeSessionContext,
    options: RuntimeQueryExecutionOptions = {},
  ): AsyncGenerator<StreamEvent, void> {
    const context = await this.resolveContext(session, options);
    const runtimeQueryTool = this.deps.toolRegistry.ensure("runtime_query_stream");
    await this.toolInvoker.prepare("runtime_query_stream", context, this.buildInvocationInput(session, options));
    this.deps.runtimeStore.setPermissionScopes([
      ...this.deps.runtimeStore.getState().permissionScopes,
      runtimeQueryTool.permissionScope,
    ]);
    this.deps.runtimeStore.startStream({ session, userMessage });
    this.deps.transcriptStore.append({
      role: "user",
      content: userMessage,
      metadata: {
        threadId: session.threadId,
        resourceId: session.resourceId,
        uiVariant: "user",
      },
    });

    let fullResponse = "";
    try {
      const stream = processMessageStream(
        userMessage,
        context,
        session.threadId,
        session.resourceId,
        { signal: options.signal },
      );
      for await (const event of stream) {
        this.applyStreamEvent(session, event);
        if (event.type === "text_delta" && event.content) {
          fullResponse += event.content;
        }
        yield event;
      }
      if (fullResponse.trim().length > 0) {
        this.deps.transcriptStore.append({
          role: "assistant",
          content: fullResponse,
          metadata: {
            activeAgent: this.deps.runtimeStore.getState().stream.activeAgent,
            uiVariant: "gordon",
          },
        });
      }
      this.deps.runtimeStore.completeStream(fullResponse);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.transcriptStore.append({
        role: "system",
        content: message,
        metadata: {
          failed: true,
          uiVariant: "system",
        },
      });
      this.deps.runtimeStore.failStream(message);
      throw error;
    }
  }

  async processMessage(
    userMessage: string,
    session: RuntimeSessionContext,
    options: RuntimeQueryExecutionOptions = {},
  ): Promise<Awaited<ReturnType<typeof processMessage>>> {
    const context = await this.resolveContext(session, options);
    const runtimeQueryTool = this.deps.toolRegistry.ensure("runtime_query_message");
    this.deps.runtimeStore.setPermissionScopes([
      ...this.deps.runtimeStore.getState().permissionScopes,
      runtimeQueryTool.permissionScope,
    ]);
    this.deps.runtimeStore.startStream({ session, userMessage });
    this.deps.transcriptStore.append({
      role: "user",
      content: userMessage,
      metadata: {
        uiVariant: "user",
      },
    });
    try {
      const invocation = await this.toolInvoker.invoke<Awaited<ReturnType<typeof processMessage>>>(
        "runtime_query_message",
        context,
        {
          ...this.buildInvocationInput(session, options),
          executor: async () => processMessage(userMessage, context, session.threadId, session.resourceId),
        },
      );
      const result = invocation.result;
      this.deps.transcriptStore.append({
        role: "assistant",
        content: result.response,
        metadata: {
          usage: result.usage,
          uiVariant: "gordon",
        },
      });
      this.deps.runtimeStore.completeStream(result.response);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.runtimeStore.failStream(message);
      throw error;
    }
  }

  async processStructuredMessage<T extends Record<string, unknown>>(
    userMessage: string,
    schema: z.ZodSchema<T>,
    session: RuntimeSessionContext,
    options: RuntimeQueryExecutionOptions = {},
  ): Promise<{
    data: T;
    usage: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
  }> {
    const context = await this.resolveContext(session, options);
    const runtimeQueryTool = this.deps.toolRegistry.ensure("runtime_query_structured");
    this.deps.runtimeStore.setPermissionScopes([
      ...this.deps.runtimeStore.getState().permissionScopes,
      runtimeQueryTool.permissionScope,
    ]);
    this.deps.runtimeStore.startStream({ session, userMessage });
    this.deps.transcriptStore.append({
      role: "user",
      content: userMessage,
      metadata: {
        structured: true,
        uiVariant: "user",
      },
    });
    try {
      const invocation = await this.toolInvoker.invoke<{
        data: T;
        usage: {
          promptTokens: number;
          completionTokens: number;
          totalTokens: number;
        };
      }>(
        "runtime_query_structured",
        context,
        {
          ...this.buildInvocationInput(session, options),
          executor: async () => processStructuredMessage(userMessage, schema, context, session.threadId, session.resourceId),
        },
      );
      const result = invocation.result;
      this.deps.transcriptStore.append({
        role: "assistant",
        content: JSON.stringify(result.data),
        metadata: {
          structured: true,
          usage: result.usage,
          uiVariant: "tool",
        },
      });
      this.deps.runtimeStore.completeStream(JSON.stringify(result.data));
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.runtimeStore.failStream(message);
      throw error;
    }
  }

  async quickScan(
    session: RuntimeSessionContext,
    options: RuntimeQueryExecutionOptions = {},
  ): Promise<Awaited<ReturnType<typeof quickScan>>> {
    const context = await this.resolveContext(session, options);
    const tool = this.deps.toolRegistry.ensure("quick_scan");
    this.deps.runtimeStore.setPermissionScopes([
      ...this.deps.runtimeStore.getState().permissionScopes,
      tool.permissionScope,
    ]);
    const invocation = await this.toolInvoker.invoke<Awaited<ReturnType<typeof quickScan>>>("quick_scan", context, {
      ...this.buildInvocationInput(session, options),
    });
    return invocation.result;
  }

  async quickCheckPositions(
    session: RuntimeSessionContext,
    options: RuntimeQueryExecutionOptions = {},
  ): Promise<Awaited<ReturnType<typeof quickCheckPositions>>> {
    const context = await this.resolveContext(session, options);
    const tool = this.deps.toolRegistry.ensure("quick_check_positions");
    this.deps.runtimeStore.setPermissionScopes([
      ...this.deps.runtimeStore.getState().permissionScopes,
      tool.permissionScope,
    ]);
    const invocation = await this.toolInvoker.invoke<Awaited<ReturnType<typeof quickCheckPositions>>>("quick_check_positions", context, {
      ...this.buildInvocationInput(session, options),
    });
    return invocation.result;
  }

  private buildInvocationInput(
    session: RuntimeSessionContext,
    options: RuntimeQueryExecutionOptions,
  ): {
    session: RuntimeSessionContext;
    runtimeState: ReturnType<RuntimeStore["getState"]>;
    transcriptStore: TranscriptStore;
    scratchpadStore: ScratchpadStore;
    workerRegistry: WorkerRegistry;
    signal?: AbortSignal;
    listRuntimeCommands: () => string[];
  } {
    return {
      session,
      runtimeState: this.deps.runtimeStore.getState(),
      transcriptStore: this.deps.transcriptStore,
      scratchpadStore: this.deps.scratchpadStore,
      workerRegistry: this.deps.workerRegistry,
      signal: options.signal,
      listRuntimeCommands: () => this.deps.runtimeStore.getState().tooling.commands,
    };
  }

  private async resolveContext(
    session: RuntimeSessionContext,
    options: RuntimeQueryExecutionOptions,
  ): Promise<GordonContext> {
    const resolved = options.contextOverride
      ? options.contextOverride
      : await this.deps.resolveContext({
          session,
          contextOverride: options.contextOverride,
        });
    const bound = bindSessionContext(resolved, session);
    return this.deps.enrichContext ? this.deps.enrichContext(bound, session) : bound;
  }

  private applyStreamEvent(session: RuntimeSessionContext, event: StreamEvent): void {
    switch (event.type) {
      case "agent_switch":
        if (event.agentName) {
          const previousAgent = this.deps.runtimeStore.getState().stream.activeAgent || "Gordon";
          this.deps.runtimeStore.markAgentSwitch(event.agentName);
          this.deps.scratchpadStore.recordHandoff({
            fromWorker: previousAgent as Parameters<ScratchpadStore["recordHandoff"]>[0]["fromWorker"],
            toWorker: event.agentName as Parameters<ScratchpadStore["recordHandoff"]>[0]["toWorker"],
            reason: "Agent switch during query execution",
          });
          this.deps.transcriptStore.append({
            role: "agent",
            content: `Agent switched to ${event.agentName}`,
            metadata: {
              sessionId: session.sessionId,
              handoffValid: this.deps.workerRegistry.has(event.agentName),
              uiVariant: "handoff",
            },
          });
        }
        break;
      case "tool_call_start":
      case "tool_call_end":
        if (event.toolName) {
          const tool = this.deps.toolRegistry.ensure(event.toolName);
          const activeAgent = this.deps.runtimeStore.getState().stream.activeAgent || tool.workerRole;
          this.deps.runtimeStore.setPermissionScopes([
            ...this.deps.runtimeStore.getState().permissionScopes,
            tool.permissionScope,
          ]);
          this.deps.runtimeStore.markToolEvent(event.type);
          this.deps.scratchpadStore.appendEntry({
            worker: activeAgent as Parameters<ScratchpadStore["appendEntry"]>[0]["worker"],
            kind: "tool_call",
            content: `${event.type} ${event.toolName}`,
            metadata: {
              toolArgs: event.toolArgs,
              toolResult: event.toolResult,
              toolSpec: tool,
            },
          });
          this.deps.transcriptStore.append({
            role: "tool",
            content: `${event.type}:${event.toolName}`,
            metadata: {
              toolArgs: event.toolArgs,
              toolResult: event.toolResult,
              toolSpec: tool,
              uiVariant: "tool",
            },
          });
        }
        break;
      case "done":
        this.deps.runtimeStore.markToolEvent("done");
        break;
      case "error":
      case "cancelled":
        this.deps.runtimeStore.failStream(event.error ?? "Stream failed");
        break;
      default:
        this.deps.runtimeStore.markToolEvent(event.type);
        break;
    }
  }

  private registerBuiltInRuntimeTools(): void {
    for (const toolId of ["runtime_query_stream", "runtime_query_message", "runtime_query_structured"] as const) {
      const spec = this.deps.toolRegistry.ensure(toolId);
      this.deps.toolRegistry.registerDefinition({
        spec: {
          ...spec,
          origin: "builtin",
        },
        origin: "builtin",
      });
    }

    const quickScanSpec = this.deps.toolRegistry.ensure("quick_scan");
    this.deps.toolRegistry.registerDefinition({
      spec: {
        ...quickScanSpec,
        origin: "builtin",
      },
      origin: "builtin",
      execute: async ({ context }) => quickScan(context),
    });

    const quickCheckSpec = this.deps.toolRegistry.ensure("quick_check_positions");
    this.deps.toolRegistry.registerDefinition({
      spec: {
        ...quickCheckSpec,
        origin: "builtin",
      },
      origin: "builtin",
      execute: async ({ context }) => quickCheckPositions(context),
    });
  }
}
