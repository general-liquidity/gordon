/**
 * Gordon Routing Manager
 *
 * Bridges the MCP plugin system with agent routing.
 * Reads routing.json manifests to determine which agent(s) should receive
 * each plugin's tools, builds dynamic TOOL_AGENT_MAP entries,
 * and triggers agent reconstruction on changes.
 */

import * as fs from "fs/promises";
import * as path from "path";
import type { Tool } from "@mastra/core/tools";

import { pluginInstaller } from "../mcp/marketplace/installer.ts";
import {
  getMCPTools,
  getMCPToolsByServer,
  reloadMCPTools,
} from "../mcp/client.ts";
import { resetAgents } from "../agents/agents.ts";
import type { AgentAffinity, RoutingManifest, ResolvedRouting } from "./types.ts";

// ============================================================================
// State
// ============================================================================

let _resolvedRoutings: ResolvedRouting[] = [];
let _dynamicToolAgentMap: Record<string, string> = {};
let _toolsByAgent: Record<string, Record<string, Tool>> = {};
let _initialized = false;

// ============================================================================
// Routing Resolution
// ============================================================================

/**
 * Load routing.json for a plugin, returning null if not found.
 * Falls back to skill.json for backward compatibility with existing installs.
 */
async function loadRoutingManifest(
  pluginId: string,
): Promise<RoutingManifest | null> {
  const pluginDir = pluginInstaller.getPluginsDir();

  // Try routing.json first (new name)
  const routingPath = path.join(pluginDir, pluginId, "routing.json");
  try {
    const content = await fs.readFile(routingPath, "utf-8");
    return JSON.parse(content) as RoutingManifest;
  } catch {
    // Fall through to legacy name
  }

  // Fallback: try skill.json (legacy name)
  const skillPath = path.join(pluginDir, pluginId, "skill.json");
  try {
    const content = await fs.readFile(skillPath, "utf-8");
    return JSON.parse(content) as RoutingManifest;
  } catch {
    return null; // No routing config — plain MCP plugin
  }
}

/**
 * Build the default RoutingManifest for a plain MCP plugin (no routing.json).
 * All tools go to Gordon (routing agent), matching current behavior.
 */
function buildDefaultRoutingManifest(pluginId: string): RoutingManifest {
  return {
    pluginId,
    defaultAgent: "Gordon",
    alsoOnGordon: true,
  };
}

/**
 * Rebuild the dynamic TOOL_AGENT_MAP and per-agent tool sets
 * from resolved routings and current MCP tools.
 */
function rebuildRoutingTables(): void {
  const mcpTools = getMCPTools();
  const mcpToolsByServer = getMCPToolsByServer();

  _dynamicToolAgentMap = {};
  _toolsByAgent = {};

  for (const routing of _resolvedRoutings) {
    if (!routing.enabled) continue;

    const serverToolNames = mcpToolsByServer[routing.pluginId] ?? [];

    // Build a lookup from bare tool name to agent affinity
    const perToolMap = new Map<string, AgentAffinity>();
    if (routing.routingManifest.toolAgentMap) {
      for (const mapping of routing.routingManifest.toolAgentMap) {
        perToolMap.set(mapping.toolName, mapping.agent);
      }
    }

    // Track tool count for this routing
    let toolCount = 0;

    for (const namespacedToolName of serverToolNames) {
      // MCPClient namespaces as serverId_toolName
      const underscoreIdx = namespacedToolName.indexOf("_");
      const bareToolName =
        underscoreIdx > 0
          ? namespacedToolName.substring(underscoreIdx + 1)
          : namespacedToolName;

      // Determine agent: per-tool override > default agent
      const agent =
        perToolMap.get(bareToolName) ?? routing.routingManifest.defaultAgent;

      // Add to dynamic TOOL_AGENT_MAP (skip Gordon — those don't need handoff detection)
      if (agent !== "Gordon") {
        _dynamicToolAgentMap[namespacedToolName] = agent;
      }

      // Add to per-agent tool sets
      const tool = mcpTools[namespacedToolName];
      if (tool) {
        toolCount++;

        // Add to the target agent
        if (!_toolsByAgent[agent]) _toolsByAgent[agent] = {};
        _toolsByAgent[agent]![namespacedToolName] = tool;

        // Also add to Gordon if requested
        if (routing.routingManifest.alsoOnGordon && agent !== "Gordon") {
          if (!_toolsByAgent["Gordon"]) _toolsByAgent["Gordon"] = {};
          _toolsByAgent["Gordon"]![namespacedToolName] = tool;
        }
      }
    }

    // Update resolved routing tool count
    routing.toolCount = toolCount;
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Initialize the routing manager.
 * Must be called after initMCPTools() so MCP tools are available.
 */
export async function initRouting(): Promise<void> {
  if (_initialized) return;

  await pluginInstaller.initialize();
  const installed = pluginInstaller.getInstalled().filter((p) => p.enabled);

  _resolvedRoutings = [];
  for (const plugin of installed) {
    const routingManifest =
      (await loadRoutingManifest(plugin.id)) ??
      buildDefaultRoutingManifest(plugin.id);
    _resolvedRoutings.push({
      pluginId: plugin.id,
      routingManifest,
      enabled: plugin.enabled,
      toolCount: 0, // populated by rebuildRoutingTables
    });
  }

  rebuildRoutingTables();
  _initialized = true;

  const routingCount = _resolvedRoutings.length;
  const routedCount = Object.keys(_dynamicToolAgentMap).length;
  if (routingCount > 0) {
    console.log(
      `[Routing] Loaded ${routingCount} config(s), ${routedCount} tool(s) routed to sub-agents`,
    );
  }
}

/**
 * Get the dynamic TOOL_AGENT_MAP entries for MCP/routing tools.
 * Merged with the static map in orchestrator.ts.
 */
export function getDynamicToolAgentMap(): Record<string, string> {
  return _dynamicToolAgentMap;
}

/**
 * Get MCP/routing tools for a specific agent.
 * Spread these into the agent's tools at construction time.
 */
export function getRoutingToolsForAgent(
  agentName: string,
): Record<string, Tool> {
  return { ...(_toolsByAgent[agentName] ?? {}) };
}

/**
 * Reload routings after plugin changes.
 * Full reconstruction chain:
 * 1. Reload MCP tools (disconnect + reconnect servers)
 * 2. Re-resolve routing manifests
 * 3. Rebuild routing tables
 * 4. Reset agent cache (forces reconstruction on next access)
 */
export async function reloadRouting(): Promise<void> {
  await reloadMCPTools();
  _initialized = false;
  await initRouting();
  resetAgents();
  console.log("[Routing] Reloaded — agents will reconstruct on next access");
}

/**
 * Get all resolved routings (for display/debugging).
 */
export function getResolvedRoutings(): ResolvedRouting[] {
  return [..._resolvedRoutings];
}

/**
 * Check if the routing manager is initialized.
 */
export function isRoutingInitialized(): boolean {
  return _initialized;
}

/**
 * Write a routing.json manifest to disk.
 */
export async function writeRoutingManifest(
  manifest: RoutingManifest,
): Promise<void> {
  const routingPath = path.join(
    pluginInstaller.getPluginsDir(),
    manifest.pluginId,
    "routing.json",
  );
  await fs.writeFile(routingPath, JSON.stringify(manifest, null, 2));
}
