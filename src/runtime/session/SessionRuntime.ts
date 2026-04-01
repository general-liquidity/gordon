import { z } from "zod";
import type {
  GordonContext,
  GordonRuntimeAccess,
  GordonRuntimeToolAccessResult,
} from "../../infra/agents/types.ts";
import type { StreamEvent } from "../../infra/agents/orchestrator.ts";
import type { SessionInfo } from "../../infra/storage/session.ts";
import type {
  RuntimeApprovalRequest,
  RuntimeHistoryResult,
  RuntimeHistorySessionSummary,
  RuntimeMcpServerSummary,
  RuntimePluginSummary,
  RuntimeQueryExecutionOptions,
  RuntimeRemoteState,
  RuntimeResolveContextOptions,
  RuntimeSessionContext,
  RuntimeSessionSnapshot,
  RuntimeToolSpec,
  RuntimeToolSummary,
} from "../contracts/types.ts";
import { RuntimeBridge } from "../bridge/RuntimeBridge.ts";
import { RuntimeHistoryManager } from "../history/RuntimeHistoryManager.ts";
import { RuntimePersistence } from "../persistence/RuntimePersistence.ts";
import { PermissionEngine } from "../permissions/PermissionEngine.ts";
import { RuntimePluginManager } from "../plugins/RuntimePluginManager.ts";
import { QueryRuntime } from "../query/QueryRuntime.ts";
import { RuntimeStore } from "../state/RuntimeStore.ts";
import { CompactionManager } from "../transcript/CompactionManager.ts";
import { ReplayManager, type ReplayFrame } from "../transcript/ReplayManager.ts";
import { TranscriptStore } from "../transcript/TranscriptStore.ts";
import { TranscriptProjector } from "../transcript/TranscriptProjector.ts";
import { evaluateRuntimeToolPolicy } from "../tools/ToolPolicy.ts";
import { ToolRegistry } from "../tools/ToolRegistry.ts";
import { ScratchpadStore } from "../workers/ScratchpadStore.ts";
import { WorkerRegistry } from "../workers/WorkerRegistry.ts";
import { createRuntimeSessionContext } from "./SessionContext.ts";
import { SessionController } from "./SessionController.ts";

export interface SessionRuntimeDeps {
  runtimeId: string;
  sessionId?: string;
  resolveContext: (options: RuntimeResolveContextOptions) => Promise<GordonContext>;
  runtimeStore: RuntimeStore;
  transcriptStore: TranscriptStore;
  compactionManager: CompactionManager;
  replayManager: ReplayManager;
  transcriptProjector: TranscriptProjector;
  toolRegistry: ToolRegistry;
  scratchpadStore: ScratchpadStore;
  workerRegistry: WorkerRegistry;
  sessionController?: SessionController;
  persistence: RuntimePersistence;
  historyManager: RuntimeHistoryManager;
  permissionEngine: PermissionEngine;
  pluginManager: RuntimePluginManager;
  bridge: RuntimeBridge;
}

export class SessionRuntime {
  private readonly runtimeId: string;
  private readonly sessionId?: string;
  private readonly runtimeStore: RuntimeStore;
  private readonly transcriptStore: TranscriptStore;
  private readonly compactionManager: CompactionManager;
  private readonly replayManager: ReplayManager;
  private readonly transcriptProjector: TranscriptProjector;
  private readonly toolRegistry: ToolRegistry;
  private readonly scratchpadStore: ScratchpadStore;
  private readonly workerRegistry: WorkerRegistry;
  private readonly sessionController: SessionController;
  private readonly persistence: RuntimePersistence;
  private readonly historyManager: RuntimeHistoryManager;
  private readonly permissionEngine: PermissionEngine;
  private readonly pluginManager: RuntimePluginManager;
  private readonly bridge: RuntimeBridge;
  private readonly queryRuntime: QueryRuntime;

  constructor(deps: SessionRuntimeDeps) {
    this.runtimeId = deps.runtimeId;
    this.sessionId = deps.sessionId;
    this.runtimeStore = deps.runtimeStore;
    this.transcriptStore = deps.transcriptStore;
    this.compactionManager = deps.compactionManager;
    this.replayManager = deps.replayManager;
    this.transcriptProjector = deps.transcriptProjector;
    this.toolRegistry = deps.toolRegistry;
    this.scratchpadStore = deps.scratchpadStore;
    this.workerRegistry = deps.workerRegistry;
    this.sessionController = deps.sessionController ?? new SessionController();
    this.persistence = deps.persistence;
    this.historyManager = deps.historyManager;
    this.permissionEngine = deps.permissionEngine;
    this.pluginManager = deps.pluginManager;
    this.bridge = deps.bridge;
    this.queryRuntime = new QueryRuntime({
      resolveContext: deps.resolveContext,
      enrichContext: (context, session) => ({
        ...context,
        runtime: this.createRuntimeAccess(session),
      }),
      runtimeStore: deps.runtimeStore,
      transcriptStore: deps.transcriptStore,
      toolRegistry: deps.toolRegistry,
      scratchpadStore: deps.scratchpadStore,
      workerRegistry: deps.workerRegistry,
      permissionEngine: deps.permissionEngine,
    });
  }

  subscribe(listener: (state: ReturnType<RuntimeStore["getState"]>) => void): () => void {
    return this.runtimeStore.subscribe(listener);
  }

  getState(): ReturnType<RuntimeStore["getState"]> {
    return this.runtimeStore.getState();
  }

  getTranscript(): ReturnType<TranscriptStore["list"]> {
    return this.transcriptStore.list();
  }

  getTranscriptStore(): TranscriptStore {
    return this.transcriptStore;
  }

  getRegisteredTools(): RuntimeToolSpec[] {
    return this.toolRegistry.list();
  }

  getToolDefinitions() {
    return this.toolRegistry.listDefinitions();
  }

  getWorkerRegistry(): WorkerRegistry {
    return this.workerRegistry;
  }

  getScratchpadStore(): ScratchpadStore {
    return this.scratchpadStore;
  }

  getScratchpadEntries(worker?: string) {
    return this.scratchpadStore.listEntries(worker);
  }

  getHandoffArtifacts() {
    return this.scratchpadStore.listHandoffs();
  }

  getReplayFrames(): ReplayFrame[] {
    return this.replayManager.buildFrames(this.transcriptStore.list());
  }

  getProjectedTranscript(): string {
    return this.transcriptProjector.toPlainText(this.transcriptStore.list());
  }

  async evaluateToolAccess(toolName: string, context: GordonContext): Promise<GordonRuntimeToolAccessResult> {
    const definition = this.toolRegistry.getDefinition(toolName);
    const policy = await evaluateRuntimeToolPolicy(toolName, context, undefined, definition?.spec);
    if (!policy.allowed) {
      return {
        status: "blocked",
        reason: policy.reason,
      };
    }

    const permission = await this.permissionEngine.evaluate(toolName, context, policy);
    if (permission.status === "allowed") {
      return {
        status: "allowed",
        reason: permission.reason,
      };
    }

    return {
      status: permission.status,
      reason: permission.reason,
      requestId: permission.request?.id,
    };
  }

  getPendingApprovals(): RuntimeApprovalRequest[] {
    return this.permissionEngine.listPending();
  }

  getRecentApprovals(limit?: number): RuntimeApprovalRequest[] {
    return this.permissionEngine.listRecent(limit);
  }

  approvePendingRequest(
    requestId: string,
    options?: { actor?: string; persist?: boolean; scope?: "session" | "persistent" },
  ): RuntimeApprovalRequest | null {
    return this.permissionEngine.approve(requestId, options);
  }

  denyPendingRequest(
    requestId: string,
    options?: { actor?: string; persist?: boolean; scope?: "session" | "persistent"; reason?: string },
  ): RuntimeApprovalRequest | null {
    return this.permissionEngine.deny(requestId, options);
  }

  getBridgeSessions(): ReturnType<RuntimeStore["getState"]>["bridge"] {
    return this.runtimeStore.getState().bridge;
  }

  beginBridgeIngress(input: {
    source: string;
    commandType: string;
    correlationId?: string;
    requestId?: string;
    detail?: string;
  }) {
    return this.bridge.begin({
      runtimeId: this.runtimeId,
      sessionId: this.sessionId,
      ...input,
    });
  }

  completeBridgeIngress(id: string, detail?: string) {
    return this.bridge.complete(id, detail);
  }

  failBridgeIngress(id: string, detail?: string) {
    return this.bridge.fail(id, detail);
  }

  compactTranscript(maxEntries: number = 120) {
    return this.compactionManager.compactStore(this.transcriptStore, maxEntries);
  }

  async initializeTooling(options: { intervalMs?: number; enableHotReload?: boolean } = {}) {
    return this.pluginManager.initialize(this, options);
  }

  async refreshPlugins() {
    return this.pluginManager.sync(this);
  }

  async reloadPlugins() {
    return this.pluginManager.reload(this);
  }

  searchHistory(query: string, options: { limit?: number } = {}): RuntimeHistoryResult[] {
    return this.historyManager.search(query, {
      ...options,
      runtimeId: this.runtimeId,
    });
  }

  listRecentHistory(limit: number = 12): RuntimeHistorySessionSummary[] {
    return this.historyManager.listRecentSessions(limit);
  }

  syncToolingState(input: {
    plugins?: RuntimePluginSummary[];
    mcpServers?: RuntimeMcpServerSummary[];
    tools?: RuntimeToolSummary[];
    commands?: string[];
  }): void {
    if (input.tools?.length) {
      this.toolRegistry.registerExternalTools(
        input.tools.map((tool) => ({
          origin: tool.origin,
          spec: {
            ...this.toolRegistry.ensure(tool.id),
            origin: tool.origin,
            pluginId: tool.pluginId,
            serverId: tool.serverId,
            displayName: tool.displayName,
          },
        })),
      );
    }

    const incomingToolSummaries = input.tools ?? this.runtimeStore.getState().tooling.tools;
    const incomingToolMap = new Map(incomingToolSummaries.map((tool) => [tool.id, tool]));
    const definitions = this.toolRegistry.listDefinitions();
    const toolSummaries = definitions.map((definition) => ({
      ...incomingToolMap.get(definition.spec.id),
      id: definition.spec.id,
      origin: definition.origin,
      pluginId: incomingToolMap.get(definition.spec.id)?.pluginId ?? definition.spec.pluginId,
      serverId: incomingToolMap.get(definition.spec.id)?.serverId ?? definition.spec.serverId,
      displayName: incomingToolMap.get(definition.spec.id)?.displayName ?? definition.spec.displayName,
    }));
    this.runtimeStore.setToolingState({
      ...input,
      tools: toolSummaries,
      commands: input.commands ?? this.runtimeStore.getState().tooling.commands,
      plugins: input.plugins ?? this.runtimeStore.getState().tooling.plugins,
      mcpServers: input.mcpServers ?? this.runtimeStore.getState().tooling.mcpServers,
      lastSyncedAt: new Date().toISOString(),
    });
  }

  setRemoteState(remote: Partial<RuntimeRemoteState>): void {
    this.runtimeStore.setRemoteState(remote);
  }

  setBackgroundTasks(tasks: Array<{ id: string; label: string; status: "idle" | "running" | "completed" | "failed"; updatedAt: string }>): void {
    this.runtimeStore.setBackgroundTasks(tasks);
  }

  hydrate(options: {
    runtimeState?: ReturnType<RuntimeStore["getState"]>;
    transcript?: ReturnType<TranscriptStore["list"]>;
    scratchpad?: {
      entries?: ReturnType<ScratchpadStore["listEntries"]>;
      handoffs?: ReturnType<ScratchpadStore["listHandoffs"]>;
    };
  }): void {
    if (options.runtimeState) {
      if (options.runtimeState.tooling.tools.length > 0) {
        this.toolRegistry.registerExternalTools(
          options.runtimeState.tooling.tools.map((tool) => ({
            origin: tool.origin,
            spec: {
              ...this.toolRegistry.ensure(tool.id),
              origin: tool.origin,
              pluginId: tool.pluginId,
              serverId: tool.serverId,
              displayName: tool.displayName,
            },
          })),
        );
      }
      this.runtimeStore.replace(options.runtimeState);
    }
    if (options.transcript) {
      this.transcriptStore.replace(options.transcript);
    }
    if (options.scratchpad) {
      this.scratchpadStore.replaceState(options.scratchpad);
    }
  }

  persistNow(): void {
    this.persistence.save(this.runtimeId, {
      runtimeState: this.getState(),
      transcript: this.getTranscript(),
      scratchpad: {
        entries: this.getScratchpadEntries(),
        handoffs: this.getHandoffArtifacts(),
      },
    });
  }

  async initializeSession(options: { autoResume?: boolean; forceNewThread?: boolean } = {}): Promise<SessionInfo> {
    const session = await this.sessionController.initializeSession(options);
    const snapshot = await this.sessionController.getCurrentSession();
    this.runtimeStore.setSession(
      {
        runtimeId: this.runtimeId,
        sessionId: this.sessionId,
        resourceId: session.resourceId,
        threadId: session.threadId,
      },
      snapshot,
    );
    return session;
  }

  async resumeSession(): Promise<SessionInfo | null> {
    const session = await this.sessionController.resumeSession();
    const snapshot = await this.sessionController.getCurrentSession();
    this.runtimeStore.setSession(
      {
        runtimeId: this.runtimeId,
        sessionId: this.sessionId,
        resourceId: session?.resourceId ?? snapshot.resourceId,
        threadId: session?.threadId ?? snapshot.threadId ?? undefined,
      },
      snapshot,
    );
    return session;
  }

  async startNewSession(): Promise<SessionInfo> {
    const session = await this.sessionController.startNewSession();
    const snapshot = await this.sessionController.getCurrentSession();
    this.runtimeStore.setSession(
      {
        runtimeId: this.runtimeId,
        sessionId: this.sessionId,
        resourceId: session.resourceId,
        threadId: session.threadId,
      },
      snapshot,
    );
    return session;
  }

  async getCurrentSession(): Promise<RuntimeSessionSnapshot> {
    const snapshot = await this.sessionController.getCurrentSession();
    this.runtimeStore.setSession(
      {
        runtimeId: this.runtimeId,
        sessionId: this.sessionId,
        resourceId: snapshot.resourceId,
        threadId: snapshot.threadId ?? undefined,
      },
      snapshot,
    );
    return snapshot;
  }

  async *streamMessage(
    userMessage: string,
    options: RuntimeQueryExecutionOptions = {},
  ): AsyncGenerator<StreamEvent, void> {
    const session = await this.resolveActiveSession(options);
    yield* this.queryRuntime.streamMessage(userMessage, session, options);
  }

  async processMessage(
    userMessage: string,
    options: RuntimeQueryExecutionOptions = {},
  ): Promise<Awaited<ReturnType<QueryRuntime["processMessage"]>>> {
    const session = await this.resolveActiveSession(options);
    return this.queryRuntime.processMessage(userMessage, session, options);
  }

  async processStructuredMessage<T extends Record<string, unknown>>(
    userMessage: string,
    schema: z.ZodSchema<T>,
    options: RuntimeQueryExecutionOptions = {},
  ): Promise<{
    data: T;
    usage: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
  }> {
    const session = await this.resolveActiveSession(options);
    return this.queryRuntime.processStructuredMessage(userMessage, schema, session, options);
  }

  async quickScan(options: RuntimeQueryExecutionOptions = {}): Promise<Awaited<ReturnType<QueryRuntime["quickScan"]>>> {
    const session = await this.resolveActiveSession(options);
    return this.queryRuntime.quickScan(session, options);
  }

  async quickCheckPositions(
    options: RuntimeQueryExecutionOptions = {},
  ): Promise<Awaited<ReturnType<QueryRuntime["quickCheckPositions"]>>> {
    const session = await this.resolveActiveSession(options);
    return this.queryRuntime.quickCheckPositions(session, options);
  }

  private async resolveActiveSession(options: RuntimeQueryExecutionOptions): Promise<RuntimeSessionContext> {
    const snapshot = await this.sessionController.getCurrentSession();
    if (!snapshot.threadId && !options.threadId) {
      const initialized = await this.initializeSession({ autoResume: true });
      return createRuntimeSessionContext({
        runtimeId: this.runtimeId,
        sessionId: options.sessionId ?? this.sessionId,
        snapshot: await this.sessionController.getCurrentSession(),
        threadId: options.threadId ?? initialized.threadId,
        resourceId: options.resourceId ?? initialized.resourceId,
      });
    }

    const context = createRuntimeSessionContext({
      runtimeId: this.runtimeId,
      sessionId: options.sessionId ?? this.sessionId,
      snapshot,
      threadId: options.threadId,
      resourceId: options.resourceId,
    });
    this.runtimeStore.setSession(context, snapshot);
    return context;
  }

  private createRuntimeAccess(session: RuntimeSessionContext): GordonRuntimeAccess {
    return {
      runtimeId: session.runtimeId,
      sessionId: session.sessionId,
      resourceId: session.resourceId,
      threadId: session.threadId,
      evaluateToolAccess: (toolName, context) => this.evaluateToolAccess(toolName, context),
      refreshPlugins: async () => {
        await this.refreshPlugins();
      },
      reloadPlugins: async () => {
        await this.reloadPlugins();
      },
      listRuntimeCommands: () => [...this.runtimeStore.getState().tooling.commands],
      listRegisteredTools: () => this.toolRegistry.list().map((tool) => tool.id),
      searchHistory: (query, options) =>
        this.searchHistory(query, options).map((entry) => ({
          timestamp: entry.timestamp,
          source: entry.source,
          content: entry.content,
        })),
    };
  }
}
