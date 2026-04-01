import type { GordonContext } from "../../infra/agents/types.ts";
import type { RuntimeResolveContextOptions } from "../contracts/types.ts";
import { createDefaultRuntimeSessionState } from "../state/SessionState.ts";
import { RuntimeStore } from "../state/RuntimeStore.ts";
import { RuntimePersistence } from "../persistence/RuntimePersistence.ts";
import { RuntimeBridge } from "../bridge/RuntimeBridge.ts";
import { RuntimeHistoryManager } from "../history/RuntimeHistoryManager.ts";
import { PermissionEngine } from "../permissions/PermissionEngine.ts";
import { RuntimePluginManager } from "../plugins/RuntimePluginManager.ts";
import { CompactionManager } from "../transcript/CompactionManager.ts";
import { ReplayManager } from "../transcript/ReplayManager.ts";
import { TranscriptStore } from "../transcript/TranscriptStore.ts";
import { TranscriptProjector } from "../transcript/TranscriptProjector.ts";
import { CapabilityRegistry } from "../tools/CapabilityRegistry.ts";
import { ToolRegistry } from "../tools/ToolRegistry.ts";
import { ScratchpadStore } from "../workers/ScratchpadStore.ts";
import { WorkerRegistry } from "../workers/WorkerRegistry.ts";
import { SessionController } from "./SessionController.ts";
import { SessionRuntime } from "./SessionRuntime.ts";

export interface SessionRuntimeFactoryDeps {
  resolveContext: (options: RuntimeResolveContextOptions) => Promise<GordonContext>;
  capabilityRegistry?: CapabilityRegistry;
  workerRegistry?: WorkerRegistry;
  sessionController?: SessionController;
  persistence?: RuntimePersistence;
  pluginManager?: RuntimePluginManager;
}

export class SessionRuntimeFactory {
  private readonly resolveContext: SessionRuntimeFactoryDeps["resolveContext"];
  private readonly capabilityRegistry: CapabilityRegistry;
  private readonly workerRegistry: WorkerRegistry;
  private readonly sessionController: SessionController;
  private readonly persistence: RuntimePersistence;
  private readonly pluginManager: RuntimePluginManager;
  private readonly runtimes = new Map<string, SessionRuntime>();
  private readonly persistTimers = new Map<string, ReturnType<typeof setTimeout> | null>();
  private disposed = false;

  constructor(deps: SessionRuntimeFactoryDeps) {
    this.resolveContext = deps.resolveContext;
    this.capabilityRegistry = deps.capabilityRegistry ?? new CapabilityRegistry();
    this.workerRegistry = deps.workerRegistry ?? new WorkerRegistry();
    this.sessionController = deps.sessionController ?? new SessionController();
    this.persistence = deps.persistence ?? new RuntimePersistence();
    this.pluginManager = deps.pluginManager ?? new RuntimePluginManager();
  }

  get(runtimeId: string, options: { sessionId?: string } = {}): SessionRuntime {
    if (this.disposed) {
      throw new Error("SessionRuntimeFactory has been disposed.");
    }

    const existing = this.runtimes.get(runtimeId);
    if (existing) {
      return existing;
    }

    const runtimeStore = new RuntimeStore(createDefaultRuntimeSessionState(runtimeId, options.sessionId));
    const transcriptStore = new TranscriptStore();
    const scratchpadStore = new ScratchpadStore();
    const toolRegistry = new ToolRegistry(this.capabilityRegistry);
    const permissionEngine = new PermissionEngine(runtimeStore);
    const bridge = new RuntimeBridge(runtimeStore);
    const historyManager = new RuntimeHistoryManager(this.persistence);
    const runtime = new SessionRuntime({
      runtimeId,
      sessionId: options.sessionId,
      resolveContext: this.resolveContext,
      runtimeStore,
      transcriptStore,
      compactionManager: new CompactionManager(),
      replayManager: new ReplayManager(),
      transcriptProjector: new TranscriptProjector(),
      toolRegistry,
      scratchpadStore,
      workerRegistry: this.workerRegistry,
      sessionController: this.sessionController,
      persistence: this.persistence,
      historyManager,
      permissionEngine,
      pluginManager: this.pluginManager,
      bridge,
    });

    const persisted = this.persistence.load(runtimeId);
    if (persisted) {
      runtime.hydrate({
        runtimeState: persisted.runtimeState,
        transcript: persisted.transcript,
        scratchpad: persisted.scratchpad,
      });
    }

    const schedulePersist = () => {
      const existingTimer = this.persistTimers.get(runtimeId);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }
      const nextTimer = setTimeout(() => {
        this.persistTimers.set(runtimeId, null);
        if (this.disposed) {
          return;
        }
        this.persistence.save(runtimeId, {
          runtimeState: runtime.getState(),
          transcript: runtime.getTranscript(),
          scratchpad: {
            entries: runtime.getScratchpadEntries(),
            handoffs: runtime.getHandoffArtifacts(),
          },
        });
      }, 50);
      this.persistTimers.set(runtimeId, nextTimer);
    };

    runtimeStore.subscribe(schedulePersist);
    transcriptStore.subscribe(schedulePersist);
    scratchpadStore.subscribe(schedulePersist);
    toolRegistry.subscribe(schedulePersist);

    this.runtimes.set(runtimeId, runtime);
    return runtime;
  }

  dispose(): void {
    this.disposed = true;
    for (const timer of this.persistTimers.values()) {
      if (timer) {
        clearTimeout(timer);
      }
    }
    this.persistTimers.clear();
    this.runtimes.clear();
  }
}
