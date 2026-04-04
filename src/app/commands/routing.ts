/**
 * Routing Commands
 * CLI commands for managing MCP tool-to-agent routing.
 * Higher-level wrapper over the existing MCP commands, adding
 * agent affinity (routing.json) and automatic agent reconstruction.
 */

import { pluginInstaller } from "../../infra/ai/mcp/marketplace/installer.ts";
import { marketplaceClient } from "../../infra/ai/mcp/marketplace/registry.ts";
import { credentialManager } from "../../infra/ai/mcp/credentials.ts";
import {
  reloadRouting,
  getResolvedRoutings,
  writeRoutingManifest,
} from "../../infra/runtime/routing/manager.ts";
import type {
  AgentAffinity,
  RoutingManifest,
} from "../../infra/runtime/routing/types.ts";

// ============================================================================
// Types
// ============================================================================

export interface RoutingCommandResult {
  success: boolean;
  message: string;
  data?: unknown;
}

const VALID_AGENTS: AgentAffinity[] = [
  "Scanner",
  "Analyst",
  "Planner",
  "Executor",
  "Monitor",
  "Teacher",
  "Backtester",
  "Gordon",
];

function isValidAgent(name: string): name is AgentAffinity {
  return VALID_AGENTS.includes(name as AgentAffinity);
}

// ============================================================================
// Commands
// ============================================================================

/**
 * /routing list — Show installed plugins with agent routing info
 */
export async function routingList(): Promise<RoutingCommandResult> {
  const routings = getResolvedRoutings();

  if (routings.length === 0) {
    return {
      success: true,
      message:
        'No routing configs installed.\nUse "/routing search <query>" to find plugins or "/routing help" for usage.',
    };
  }

  const lines: string[] = [`${routings.length} routing config(s) installed:\n`];
  for (const routing of routings) {
    const rm = routing.routingManifest;
    const status = routing.enabled ? "enabled" : "disabled";
    const routes =
      rm.toolAgentMap && rm.toolAgentMap.length > 0
        ? `${rm.toolAgentMap.length} custom route(s), default -> ${rm.defaultAgent}`
        : `all -> ${rm.defaultAgent}`;
    const gordonFlag = rm.alsoOnGordon ? " (+Gordon)" : "";

    lines.push(
      `  ${routing.pluginId} [${status}] — ${routing.toolCount} tool(s) [${routes}${gordonFlag}]`,
    );
  }

  return { success: true, message: lines.join("\n"), data: { routings } };
}

/**
 * /routing install <pluginId> [--agent <agentName>]
 */
export async function routingInstall(
  pluginId: string,
  defaultAgent: AgentAffinity = "Scanner",
): Promise<RoutingCommandResult> {
  // Fetch from marketplace
  const listing = await marketplaceClient.getPlugin(pluginId);
  if (!listing) {
    return {
      success: false,
      message: `Plugin "${pluginId}" not found in marketplace.`,
    };
  }

  if (pluginInstaller.isInstalled(pluginId)) {
    return {
      success: false,
      message: `Plugin "${pluginId}" is already installed. Use "/routing route ${pluginId} <agent>" to change routing.`,
    };
  }

  // Install via MCP installer
  await pluginInstaller.install(listing);

  // Write routing.json with agent affinity
  const routingManifest: RoutingManifest = {
    pluginId,
    defaultAgent,
    alsoOnGordon: false,
  };
  await writeRoutingManifest(routingManifest);

  // Reload routing → rebuild routing → reset agents
  await reloadRouting();

  // Check if credentials are needed
  const needsCredentials =
    listing.manifest.authentication.type !== "none" &&
    !credentialManager.hasRequiredCredentials(listing.manifest);

  let message = `Installed plugin "${listing.manifest.name}" -> ${defaultAgent} (${listing.manifest.tools.length} tools)`;
  if (needsCredentials) {
    message += `\nConfigure credentials: /routing configure ${pluginId}`;
  }

  return { success: true, message, data: { pluginId, defaultAgent } };
}

/**
 * /routing route <pluginId> <agentName> — Change where a plugin's tools go
 */
export async function routingRoute(
  pluginId: string,
  agentName: AgentAffinity,
): Promise<RoutingCommandResult> {
  if (!pluginInstaller.isInstalled(pluginId)) {
    return {
      success: false,
      message: `Plugin "${pluginId}" is not installed.`,
    };
  }

  if (!isValidAgent(agentName)) {
    return {
      success: false,
      message: `Invalid agent "${agentName}". Valid: ${VALID_AGENTS.join(", ")}`,
    };
  }

  // Read existing or create new routing manifest
  const routingManifest: RoutingManifest = {
    pluginId,
    defaultAgent: agentName,
    alsoOnGordon: false,
  };
  await writeRoutingManifest(routingManifest);

  await reloadRouting();

  return {
    success: true,
    message: `Plugin "${pluginId}" tools now route to ${agentName}.`,
  };
}

/**
 * /routing uninstall <pluginId>
 */
export async function routingUninstall(
  pluginId: string,
): Promise<RoutingCommandResult> {
  const plugin = pluginInstaller.getPlugin(pluginId);
  if (!plugin) {
    return {
      success: false,
      message: `Plugin "${pluginId}" is not installed.`,
    };
  }

  const name = plugin.manifest.name;
  await pluginInstaller.uninstall(pluginId);
  credentialManager.delete(pluginId);
  await reloadRouting();

  return { success: true, message: `Uninstalled plugin "${name}".` };
}

/**
 * /routing enable <pluginId>
 */
export async function routingEnable(
  pluginId: string,
): Promise<RoutingCommandResult> {
  if (!pluginInstaller.isInstalled(pluginId)) {
    return {
      success: false,
      message: `Plugin "${pluginId}" is not installed.`,
    };
  }

  await pluginInstaller.enable(pluginId);
  await reloadRouting();

  return { success: true, message: `Enabled plugin "${pluginId}".` };
}

/**
 * /routing disable <pluginId>
 */
export async function routingDisable(
  pluginId: string,
): Promise<RoutingCommandResult> {
  if (!pluginInstaller.isInstalled(pluginId)) {
    return {
      success: false,
      message: `Plugin "${pluginId}" is not installed.`,
    };
  }

  await pluginInstaller.disable(pluginId);
  await reloadRouting();

  return { success: true, message: `Disabled plugin "${pluginId}".` };
}

// ============================================================================
// Command Router
// ============================================================================

/**
 * Handle /routing command routing
 */
export async function handleRoutingCommand(
  args: string[],
): Promise<RoutingCommandResult> {
  const subcommand = args[0]?.toLowerCase() ?? "list";
  const subArgs = args.slice(1);

  switch (subcommand) {
    case "list":
    case "ls":
      return routingList();

    case "install":
    case "add": {
      if (!subArgs[0]) {
        return {
          success: false,
          message: 'Usage: /routing install <id> [--agent <name>]',
        };
      }
      const agentIdx = subArgs.indexOf("--agent");
      let agent: AgentAffinity = "Scanner";
      if (agentIdx >= 0 && subArgs[agentIdx + 1]) {
        const candidate = subArgs[agentIdx + 1]!;
        if (!isValidAgent(candidate)) {
          return {
            success: false,
            message: `Invalid agent "${candidate}". Valid: ${VALID_AGENTS.join(", ")}`,
          };
        }
        agent = candidate;
      }
      return routingInstall(subArgs[0], agent);
    }

    case "route":
    case "assign": {
      if (!subArgs[0] || !subArgs[1]) {
        return {
          success: false,
          message: `Usage: /routing route <id> <agent>\nAgents: ${VALID_AGENTS.join(", ")}`,
        };
      }
      return routingRoute(subArgs[0], subArgs[1] as AgentAffinity);
    }

    case "uninstall":
    case "remove":
    case "rm":
      if (!subArgs[0]) {
        return {
          success: false,
          message: "Usage: /routing uninstall <id>",
        };
      }
      return routingUninstall(subArgs[0]);

    case "enable":
      if (!subArgs[0]) {
        return { success: false, message: "Usage: /routing enable <id>" };
      }
      return routingEnable(subArgs[0]);

    case "disable":
      if (!subArgs[0]) {
        return { success: false, message: "Usage: /routing disable <id>" };
      }
      return routingDisable(subArgs[0]);

    // Delegate to MCP commands for search/configure/info
    case "search":
    case "find": {
      const { mcpSearch } = await import("./mcp.ts");
      return mcpSearch(subArgs.join(" "));
    }

    case "configure":
    case "config": {
      if (!subArgs[0]) {
        return {
          success: false,
          message: "Usage: /routing configure <id>",
        };
      }
      const { mcpConfigure } = await import("./mcp.ts");
      return mcpConfigure(subArgs[0]);
    }

    case "info": {
      if (!subArgs[0]) {
        return { success: false, message: "Usage: /routing info <id>" };
      }
      const { mcpInfo } = await import("./mcp.ts");
      const infoResult = await mcpInfo(subArgs[0]);

      // Append routing info if it's an installed plugin
      const routings = getResolvedRoutings();
      const routing = routings.find((r) => r.pluginId === subArgs[0]);
      if (routing) {
        const rm = routing.routingManifest;
        const routes =
          rm.toolAgentMap && rm.toolAgentMap.length > 0
            ? rm.toolAgentMap
                .map((m) => `  ${m.toolName} -> ${m.agent}`)
                .join("\n")
            : `  all -> ${rm.defaultAgent}`;
        infoResult.message += `\n\nRouting:\n${routes}`;
        if (rm.alsoOnGordon) {
          infoResult.message += "\n  (also available on Gordon)";
        }
      }

      return infoResult;
    }

    case "help":
      return {
        success: true,
        message: `Routing Commands:
  /routing list                          — List installed plugins with routing
  /routing search <query>                — Search marketplace
  /routing install <id> [--agent <name>] — Install and route to agent
  /routing uninstall <id>                — Remove a plugin
  /routing route <id> <agent>            — Change agent routing
  /routing configure <id>                — Set up credentials
  /routing enable <id>                   — Enable a plugin
  /routing disable <id>                  — Disable a plugin
  /routing info <id>                     — Show plugin details

Agents: ${VALID_AGENTS.join(", ")}`,
      };

    default:
      return {
        success: false,
        message: `Unknown subcommand "${subcommand}". Use "/routing help" for usage.`,
      };
  }
}
