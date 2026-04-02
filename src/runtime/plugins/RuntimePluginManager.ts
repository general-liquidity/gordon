import {
  disableMCPHotReload,
  enableMCPHotReload,
  getMCPServerSummary,
  getMCPToolsByServer,
  initMCPTools,
} from "../../infra/mcp/client.ts";
import { getCanonicalActions } from "../../infra/actions/registry.ts";
import { pluginInstaller } from "../../infra/mcp/marketplace/installer.ts";
import {
  getResolvedRoutings,
  initRouting,
  reloadRouting,
} from "../../infra/routing/manager.ts";
import type {
  RuntimeMcpServerSummary,
  RuntimePluginSummary,
  RuntimeToolSummary,
} from "../contracts/types.ts";
import type { SessionRuntime } from "../session/SessionRuntime.ts";

export interface RuntimePluginInventory {
  lastSyncedAt?: string | null;
  lastReloadAt?: string | null;
  hotReloadEnabled?: boolean;
  routingCount?: number;
  plugins: RuntimePluginSummary[];
  mcpServers: RuntimeMcpServerSummary[];
  tools: RuntimeToolSummary[];
  commands: string[];
}

export interface RuntimePluginManagerDeps {
  initializePlugins?: () => Promise<void>;
  listPlugins?: () => RuntimePluginSummary[];
  listMcpServers?: () => RuntimeMcpServerSummary[];
  listTools?: () => RuntimeToolSummary[];
  listCommands?: () => string[];
  reloadPlugins?: () => Promise<void>;
  enableHotReload?: (intervalMs?: number) => void;
  disableHotReload?: () => void;
}

function buildToolCommandLookup(): Map<string, string[]> {
  const lookup = new Map<string, Set<string>>();

  for (const action of getCanonicalActions()) {
    if (!action.tool || !action.slash) {
      continue;
    }

    const existing = lookup.get(action.tool.toolName) ?? new Set<string>();
    existing.add(`/${action.slash.name}`);
    lookup.set(action.tool.toolName, existing);
  }

  return new Map(
    [...lookup.entries()].map(([toolName, commands]) => [toolName, [...commands].sort()]),
  );
}

function deriveIntegrationCommands(
  pluginId: string,
  toolIds: string[],
  manifestToolNames: string[],
  toolCommandLookup: Map<string, string[]>,
): string[] {
  const commands = new Set<string>();
  const toolNames = new Set<string>(manifestToolNames);

  for (const toolId of toolIds) {
    const underscoreIndex = toolId.indexOf("_");
    toolNames.add(underscoreIndex > 0 ? toolId.slice(underscoreIndex + 1) : toolId);
  }

  for (const toolName of toolNames) {
    for (const command of toolCommandLookup.get(toolName) ?? []) {
      commands.add(command);
    }
  }

  if (toolIds.length > 0 || manifestToolNames.length > 0) {
    commands.add("/mcp");
    commands.add("/runtime-plugins");
  }

  if (pluginId) {
    commands.add("/routing");
  }

  return [...commands].sort();
}

function buildDefaultInventory(state: {
  hotReloadEnabled: boolean;
  lastReloadAt: string | null;
}): RuntimePluginInventory {
  const installedPlugins = pluginInstaller.getInstalled();
  const toolsByServer = getMCPToolsByServer();
  const routings = getResolvedRoutings();
  const routingByPlugin = new Map(routings.map((routing) => [routing.pluginId, routing]));
  const toolCommandLookup = buildToolCommandLookup();
  const commands = new Set<string>();

  const plugins = installedPlugins.map((plugin) => {
    const serverToolIds = toolsByServer[plugin.id] ?? [];
    const integrationCommands = deriveIntegrationCommands(
      plugin.id,
      serverToolIds,
      plugin.manifest.tools.map((tool) => tool.name),
      toolCommandLookup,
    );
    for (const command of integrationCommands) {
      commands.add(command);
    }

    const routing = routingByPlugin.get(plugin.id);
    const routed = Boolean(
      routing
      && (
        routing.routingManifest.defaultAgent !== "Gordon"
        || (routing.routingManifest.toolAgentMap?.length ?? 0) > 0
      ),
    );
    const toolCount = serverToolIds.length > 0 ? serverToolIds.length : plugin.manifest.tools.length;
    const attentionReasons: string[] = [];
    if (!plugin.enabled) {
      attentionReasons.push("disabled");
    }
    if (toolCount === 0) {
      attentionReasons.push("no tools exposed");
    }
    if (toolCount > 0 && integrationCommands.length === 0) {
      attentionReasons.push("no commands surfaced");
    }
    if (routed && !routing?.routingManifest.alsoOnGordon) {
      attentionReasons.push("agent-routed only");
    }
    const status = !plugin.enabled
      ? "disabled"
      : toolCount > 0
        ? "ready"
        : "degraded";
    const attentionLevel = status === "degraded" || attentionReasons.includes("no commands surfaced")
      ? "warning"
      : attentionReasons.length > 0
        ? "info"
        : "none";
    return {
      id: plugin.id,
      name: plugin.manifest.name ?? plugin.id,
      enabled: plugin.enabled,
      category: plugin.manifest.category,
      version: plugin.version,
      status,
      lifecycle: routed ? "routed" : "mcp",
      toolCount,
      commandCount: integrationCommands.length,
      surfacedCommandCount: integrationCommands.length,
      integrationCommands,
      defaultAgent: routing?.routingManifest.defaultAgent,
      alsoOnGordon: routing?.routingManifest.alsoOnGordon,
      routedToolCount: routing?.toolCount,
      reloadRecommended: status === "degraded" || attentionReasons.includes("no commands surfaced"),
      attentionLevel,
      attentionReasons,
      lastReloadAt: state.lastReloadAt,
    } satisfies RuntimePluginSummary;
  });

  return {
    lastReloadAt: state.lastReloadAt,
    hotReloadEnabled: state.hotReloadEnabled,
    routingCount: routings.filter((routing) => routing.enabled).length,
    plugins,
    mcpServers: getMCPServerSummary(),
    tools: Object.entries(toolsByServer).flatMap(([serverId, toolIds]) => {
      const routing = routingByPlugin.get(serverId);
      const toolAgentMap = new Map(
        (routing?.routingManifest.toolAgentMap ?? []).map((mapping) => [mapping.toolName, mapping.agent]),
      );
      return toolIds.map((toolId) => {
        const underscoreIndex = toolId.indexOf("_");
        const bareToolName = underscoreIndex > 0 ? toolId.slice(underscoreIndex + 1) : toolId;
        const routedToAgent = toolAgentMap.get(bareToolName) ?? routing?.routingManifest.defaultAgent;
        return {
          id: toolId,
          origin: "mcp" as const,
          pluginId: serverId,
          serverId,
          displayName: toolId,
          routedToAgent,
          exposedOnGordon: Boolean(routing?.routingManifest.alsoOnGordon && routedToAgent && routedToAgent !== "Gordon"),
        } satisfies RuntimeToolSummary;
      });
    }),
    commands: [...commands].sort(),
  };
}

export class RuntimePluginManager {
  private readonly deps: Required<RuntimePluginManagerDeps>;
  private stopHotReloadFn: (() => void) | null = null;
  private hotReloadEnabled = false;
  private lastReloadAt: string | null = null;

  constructor(deps: RuntimePluginManagerDeps = {}) {
    this.deps = {
      initializePlugins: deps.initializePlugins ?? (async () => {
        await pluginInstaller.initialize();
        await initMCPTools();
        await initRouting();
      }),
      listPlugins: deps.listPlugins ?? (() => buildDefaultInventory({
        hotReloadEnabled: this.hotReloadEnabled,
        lastReloadAt: this.lastReloadAt,
      }).plugins),
      listMcpServers: deps.listMcpServers ?? (() => buildDefaultInventory({
        hotReloadEnabled: this.hotReloadEnabled,
        lastReloadAt: this.lastReloadAt,
      }).mcpServers),
      listTools: deps.listTools ?? (() => buildDefaultInventory({
        hotReloadEnabled: this.hotReloadEnabled,
        lastReloadAt: this.lastReloadAt,
      }).tools),
      listCommands: deps.listCommands ?? (() => buildDefaultInventory({
        hotReloadEnabled: this.hotReloadEnabled,
        lastReloadAt: this.lastReloadAt,
      }).commands),
      reloadPlugins: deps.reloadPlugins ?? (async () => {
        await reloadRouting();
      }),
      enableHotReload: deps.enableHotReload ?? ((intervalMs?: number) => enableMCPHotReload(intervalMs)),
      disableHotReload: deps.disableHotReload ?? (() => disableMCPHotReload()),
    };
  }

  async initialize(runtime: SessionRuntime, options: { intervalMs?: number; enableHotReload?: boolean } = {}): Promise<RuntimePluginInventory> {
    await this.deps.initializePlugins();
    const inventory = await this.sync(runtime);
    if (options.enableHotReload) {
      this.startHotReload(runtime, options.intervalMs);
    }
    return inventory;
  }

  async sync(runtime: SessionRuntime): Promise<RuntimePluginInventory> {
    const snapshot = buildDefaultInventory({
      hotReloadEnabled: this.hotReloadEnabled,
      lastReloadAt: this.lastReloadAt,
    });
    const inventory: RuntimePluginInventory = {
      lastSyncedAt: new Date().toISOString(),
      lastReloadAt: snapshot.lastReloadAt,
      hotReloadEnabled: snapshot.hotReloadEnabled,
      routingCount: snapshot.routingCount,
      plugins: this.deps.listPlugins(),
      mcpServers: this.deps.listMcpServers(),
      tools: this.deps.listTools(),
      commands: this.deps.listCommands(),
    };
    runtime.syncToolingState(inventory);
    return inventory;
  }

  async reload(runtime: SessionRuntime): Promise<RuntimePluginInventory> {
    await this.deps.reloadPlugins();
    this.lastReloadAt = new Date().toISOString();
    return this.sync(runtime);
  }

  startHotReload(runtime: SessionRuntime, intervalMs: number = 5000): void {
    this.stopHotReloadFn?.();
    this.hotReloadEnabled = true;
    this.deps.enableHotReload(intervalMs);
    this.stopHotReloadFn = () => {
      this.hotReloadEnabled = false;
      this.deps.disableHotReload();
      this.stopHotReloadFn = null;
    };
    void this.sync(runtime);
  }

  stopHotReload(): void {
    this.stopHotReloadFn?.();
  }
}
