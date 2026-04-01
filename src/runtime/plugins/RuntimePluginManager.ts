import {
  disableMCPHotReload,
  enableMCPHotReload,
  getMCPServerSummary,
  getMCPToolsByServer,
  initMCPTools,
} from "../../infra/mcp/client.ts";
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

function getIntegrationCommands(category: string | undefined): string[] {
  const integrations: Record<string, string[]> = {
    "data-provider": ["/scan", "/analyze", "/compare", "/history"],
    analytics: ["/scan", "/analyze", "/signals"],
    execution: ["/trade", "/order", "/position"],
    exchange: ["/trade", "/order", "/balance"],
    infrastructure: ["/scan", "/analyze"],
    portfolio: ["/portfolio", "/pnl", "/balance"],
    research: ["/analyze", "/research", "/sentiment"],
    utility: ["/alert", "/notify"],
  };
  return category ? [...(integrations[category] ?? [])] : [];
}

function buildDefaultInventory(): RuntimePluginInventory {
  const installedPlugins = pluginInstaller.getInstalled();
  const toolsByServer = getMCPToolsByServer();
  const routings = getResolvedRoutings();
  const routingByPlugin = new Map(routings.map((routing) => [routing.pluginId, routing]));
  const commands = new Set<string>();

  const plugins = installedPlugins.map((plugin) => {
    const integrationCommands = getIntegrationCommands(plugin.manifest.category);
    for (const command of integrationCommands) {
      commands.add(command);
    }

    const routing = routingByPlugin.get(plugin.id);
    return {
      id: plugin.id,
      name: plugin.manifest.name ?? plugin.id,
      enabled: plugin.enabled,
      category: plugin.manifest.category,
      version: plugin.version,
      toolCount: toolsByServer[plugin.id]?.length ?? plugin.manifest.tools.length,
      commandCount: integrationCommands.length,
      integrationCommands,
      defaultAgent: routing?.routingManifest.defaultAgent,
      alsoOnGordon: routing?.routingManifest.alsoOnGordon,
      routedToolCount: routing?.toolCount,
    } satisfies RuntimePluginSummary;
  });

  return {
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

  constructor(deps: RuntimePluginManagerDeps = {}) {
    this.deps = {
      initializePlugins: deps.initializePlugins ?? (async () => {
        await pluginInstaller.initialize();
        await initMCPTools();
        await initRouting();
      }),
      listPlugins: deps.listPlugins ?? (() => buildDefaultInventory().plugins),
      listMcpServers: deps.listMcpServers ?? (() => buildDefaultInventory().mcpServers),
      listTools: deps.listTools ?? (() => buildDefaultInventory().tools),
      listCommands: deps.listCommands ?? (() => buildDefaultInventory().commands),
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
    const inventory: RuntimePluginInventory = {
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
    return this.sync(runtime);
  }

  startHotReload(runtime: SessionRuntime, intervalMs: number = 5000): void {
    this.stopHotReloadFn?.();
    this.deps.enableHotReload(intervalMs);
    this.stopHotReloadFn = () => {
      this.deps.disableHotReload();
      this.stopHotReloadFn = null;
    };
    void this.sync(runtime);
  }

  stopHotReload(): void {
    this.stopHotReloadFn?.();
  }
}
