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
import { loadOperatorSettings } from "../permissions/settingsLoader.ts";
import { createModuleLogger } from "../../infra/logger/logger.ts";

const factoryLogger = createModuleLogger("session-runtime-factory");

/**
 * FW5b — Feature flag controlling whether operator-authored .claude/settings.json
 * interruptOn rules are loaded at runtime construction. Default off; flip on
 * once the operator's settings.json has been authored and reviewed.
 */
const OPERATOR_SETTINGS_FLAG = "GORDON_OPERATOR_SETTINGS";

function isOperatorSettingsEnabled(): boolean {
  return (
    process.env[OPERATOR_SETTINGS_FLAG] === "1" ||
    process.env[OPERATOR_SETTINGS_FLAG] === "true"
  );
}

/**
 * FW5b — Apply operator-authored interruptOn rules from .claude/settings.json
 * to a freshly-constructed runtime store. Called after hydration so persisted
 * approval state stays intact; settings rules are appended (not replaced) on
 * top, letting PermissionEngine's specificity ranking resolve overlaps.
 *
 * No-op when the OPERATOR_SETTINGS flag is off. Failures are logged but
 * non-fatal — runtime construction never blocks on settings loading.
 */
function applyOperatorSettings(runtimeStore: RuntimeStore, runtimeId: string): void {
  if (!isOperatorSettingsEnabled()) return;
  try {
    const result = loadOperatorSettings();
    if (result.rules.length === 0 && result.warnings.length === 0) {
      return;
    }
    if (result.warnings.length > 0) {
      factoryLogger.warn("Operator settings load warnings", {
        runtimeId,
        warnings: result.warnings,
        sources: result.sources,
      });
    }
    if (result.rules.length > 0) {
      const existing = runtimeStore.getState().approvals.rules;
      runtimeStore.setApprovalState({
        rules: [...existing, ...result.rules],
      });
      factoryLogger.info("Applied operator interruptOn rules", {
        runtimeId,
        added: result.rules.length,
        sources: result.sources
          .filter((s) => s.found && s.parsed && s.hadInterruptOn)
          .map((s) => `${s.origin}:${s.accepted}`),
      });
    }
  } catch (err) {
    factoryLogger.error("Failed to apply operator settings", {
      runtimeId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

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

    // FW5b — apply operator-authored interruptOn rules from
    // .claude/settings.json on top of hydrated state. Behind
    // GORDON_OPERATOR_SETTINGS flag; no-op until enabled.
    applyOperatorSettings(runtimeStore, runtimeId);

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
