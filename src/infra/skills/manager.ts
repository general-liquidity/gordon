/**
 * Gordon Skill Manager
 *
 * Bridges the MCP plugin system with agent routing.
 * Reads skill.json manifests to determine which agent(s) should receive
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
import type { AgentAffinity, SkillManifest, ResolvedSkill } from "./types.ts";

// ============================================================================
// State
// ============================================================================

let _resolvedSkills: ResolvedSkill[] = [];
let _dynamicToolAgentMap: Record<string, string> = {};
let _toolsByAgent: Record<string, Record<string, Tool>> = {};
let _initialized = false;

// ============================================================================
// Skill Resolution
// ============================================================================

/**
 * Load skill.json for a plugin, returning null if not found.
 */
async function loadSkillManifest(
  pluginId: string,
): Promise<SkillManifest | null> {
  const skillPath = path.join(
    pluginInstaller.getPluginsDir(),
    pluginId,
    "skill.json",
  );
  try {
    const content = await fs.readFile(skillPath, "utf-8");
    return JSON.parse(content) as SkillManifest;
  } catch {
    return null; // No skill.json — plain MCP plugin
  }
}

/**
 * Build the default SkillManifest for a plain MCP plugin (no skill.json).
 * All tools go to Gordon (routing agent), matching current behavior.
 */
function buildDefaultSkillManifest(pluginId: string): SkillManifest {
  return {
    pluginId,
    defaultAgent: "Gordon",
    alsoOnGordon: true,
  };
}

/**
 * Rebuild the dynamic TOOL_AGENT_MAP and per-agent tool sets
 * from resolved skills and current MCP tools.
 */
function rebuildRoutingTables(): void {
  const mcpTools = getMCPTools();
  const mcpToolsByServer = getMCPToolsByServer();

  _dynamicToolAgentMap = {};
  _toolsByAgent = {};

  for (const skill of _resolvedSkills) {
    if (!skill.enabled) continue;

    const serverToolNames = mcpToolsByServer[skill.pluginId] ?? [];

    // Build a lookup from bare tool name to agent affinity
    const perToolMap = new Map<string, AgentAffinity>();
    if (skill.skillManifest.toolAgentMap) {
      for (const mapping of skill.skillManifest.toolAgentMap) {
        perToolMap.set(mapping.toolName, mapping.agent);
      }
    }

    // Track tool count for this skill
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
        perToolMap.get(bareToolName) ?? skill.skillManifest.defaultAgent;

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
        if (skill.skillManifest.alsoOnGordon && agent !== "Gordon") {
          if (!_toolsByAgent["Gordon"]) _toolsByAgent["Gordon"] = {};
          _toolsByAgent["Gordon"]![namespacedToolName] = tool;
        }
      }
    }

    // Update resolved skill tool count
    skill.toolCount = toolCount;
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Initialize the skill manager.
 * Must be called after initMCPTools() so MCP tools are available.
 */
export async function initSkills(): Promise<void> {
  if (_initialized) return;

  await pluginInstaller.initialize();
  const installed = pluginInstaller.getInstalled().filter((p) => p.enabled);

  _resolvedSkills = [];
  for (const plugin of installed) {
    const skillManifest =
      (await loadSkillManifest(plugin.id)) ??
      buildDefaultSkillManifest(plugin.id);
    _resolvedSkills.push({
      pluginId: plugin.id,
      skillManifest,
      enabled: plugin.enabled,
      toolCount: 0, // populated by rebuildRoutingTables
    });
  }

  rebuildRoutingTables();
  _initialized = true;

  const skillCount = _resolvedSkills.length;
  const routedCount = Object.keys(_dynamicToolAgentMap).length;
  if (skillCount > 0) {
    console.log(
      `[Skills] Loaded ${skillCount} skill(s), ${routedCount} tool(s) routed to sub-agents`,
    );
  }
}

/**
 * Get the dynamic TOOL_AGENT_MAP entries for MCP/skill tools.
 * Merged with the static map in orchestrator.ts.
 */
export function getDynamicToolAgentMap(): Record<string, string> {
  return _dynamicToolAgentMap;
}

/**
 * Get MCP/skill tools for a specific agent.
 * Spread these into the agent's tools at construction time.
 */
export function getSkillToolsForAgent(
  agentName: string,
): Record<string, Tool> {
  return { ...(_toolsByAgent[agentName] ?? {}) };
}

/**
 * Reload skills after plugin changes.
 * Full reconstruction chain:
 * 1. Reload MCP tools (disconnect + reconnect servers)
 * 2. Re-resolve skill manifests
 * 3. Rebuild routing tables
 * 4. Reset agent cache (forces reconstruction on next access)
 */
export async function reloadSkills(): Promise<void> {
  await reloadMCPTools();
  _initialized = false;
  await initSkills();
  resetAgents();
  console.log("[Skills] Reloaded — agents will reconstruct on next access");
}

/**
 * Get all resolved skills (for display/debugging).
 */
export function getResolvedSkills(): ResolvedSkill[] {
  return [..._resolvedSkills];
}

/**
 * Check if the skill manager is initialized.
 */
export function isSkillsInitialized(): boolean {
  return _initialized;
}

/**
 * Write a skill.json manifest to disk.
 */
export async function writeSkillManifest(
  manifest: SkillManifest,
): Promise<void> {
  const skillPath = path.join(
    pluginInstaller.getPluginsDir(),
    manifest.pluginId,
    "skill.json",
  );
  await fs.writeFile(skillPath, JSON.stringify(manifest, null, 2));
}
