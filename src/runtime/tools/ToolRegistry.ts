import { EventEmitter } from "node:events";
import type { GordonContext } from "../../infra/agents/types.ts";
import type {
  RuntimeHistoryResult,
  RuntimeSessionContext,
  RuntimeToolSource,
  RuntimeToolSpec,
  RuntimeWorkerDefinition,
} from "../contracts/types.ts";
import { CapabilityRegistry } from "./CapabilityRegistry.ts";
import type { RuntimeSessionState } from "../state/SessionState.ts";
import type { TranscriptStore } from "../transcript/TranscriptStore.ts";
import type { ScratchpadStore } from "../workers/ScratchpadStore.ts";

export interface RuntimeToolExecutionContext {
  context: GordonContext;
  session: RuntimeSessionContext;
  runtimeState: RuntimeSessionState;
  signal?: AbortSignal;
  transcriptStore: TranscriptStore;
  scratchpadStore: ScratchpadStore;
  getWorkerDefinition: (worker: string) => RuntimeWorkerDefinition | undefined;
  getToolDefinition: (toolId: string) => RuntimeToolDefinition | undefined;
  listRegisteredTools: () => RuntimeToolSpec[];
  listRuntimeCommands: () => string[];
  refreshPlugins?: () => Promise<void>;
  reloadPlugins?: () => Promise<void>;
  searchHistory?: (query: string, options?: { limit?: number }) => RuntimeHistoryResult[];
}

export interface RuntimeToolDefinition {
  spec: RuntimeToolSpec;
  origin: RuntimeToolSource;
  execute?: (context: RuntimeToolExecutionContext) => Promise<unknown>;
}

export class ToolRegistry {
  private readonly emitter = new EventEmitter();
  private readonly definitions = new Map<string, RuntimeToolDefinition>();
  private readonly capabilityRegistry: CapabilityRegistry;

  constructor(capabilityRegistry: CapabilityRegistry = new CapabilityRegistry()) {
    this.capabilityRegistry = capabilityRegistry;
  }

  subscribe(listener: () => void): () => void {
    this.emitter.on("change", listener);
    return () => {
      this.emitter.off("change", listener);
    };
  }

  ensure(toolId: string): RuntimeToolSpec {
    const existing = this.definitions.get(toolId);
    if (existing) {
      return existing.spec;
    }
    const spec = this.capabilityRegistry.resolveToolSpec(toolId);
    this.registerDefinition({
      spec: {
        ...spec,
        origin: "builtin",
      },
      origin: "builtin",
    });
    return this.definitions.get(toolId)!.spec;
  }

  registerDefinition(definition: RuntimeToolDefinition): RuntimeToolDefinition {
    this.definitions.set(definition.spec.id, definition);
    this.emit();
    return definition;
  }

  registerExternalTools(definitions: Array<Pick<RuntimeToolDefinition, "spec" | "origin">>): void {
    let changed = false;
    for (const definition of definitions) {
      this.definitions.set(definition.spec.id, definition);
      changed = true;
    }
    if (changed) {
      this.emit();
    }
  }

  get(toolId: string): RuntimeToolSpec | undefined {
    return this.definitions.get(toolId)?.spec;
  }

  getDefinition(toolId: string): RuntimeToolDefinition | undefined {
    return this.definitions.get(toolId);
  }

  list(): RuntimeToolSpec[] {
    return this.listDefinitions().map((definition) => definition.spec);
  }

  listDefinitions(): RuntimeToolDefinition[] {
    return [...this.definitions.values()].sort((left, right) =>
      left.spec.id.localeCompare(right.spec.id),
    );
  }

  private emit(): void {
    this.emitter.emit("change");
  }
}
