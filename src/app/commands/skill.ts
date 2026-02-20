/**
 * Skill Commands
 * CLI commands for managing skills (MCP plugins with agent routing).
 * Higher-level wrapper over the existing MCP commands, adding
 * agent affinity (skill.json) and automatic agent reconstruction.
 */

import { pluginInstaller } from "../../infra/mcp/marketplace/installer.ts";
import { marketplaceClient } from "../../infra/mcp/marketplace/registry.ts";
import { credentialManager } from "../../infra/mcp/credentials.ts";
import {
  reloadSkills,
  getResolvedSkills,
  writeSkillManifest,
} from "../../infra/skills/manager.ts";
import type {
  AgentAffinity,
  SkillManifest,
} from "../../infra/skills/types.ts";

// ============================================================================
// Types
// ============================================================================

export interface SkillCommandResult {
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
 * /skill list — Show installed skills with agent routing info
 */
export async function skillList(): Promise<SkillCommandResult> {
  const skills = getResolvedSkills();

  if (skills.length === 0) {
    return {
      success: true,
      message:
        'No skills installed.\nUse "/skill search <query>" to find skills or "/skill help" for usage.',
    };
  }

  const lines: string[] = [`${skills.length} skill(s) installed:\n`];
  for (const skill of skills) {
    const sm = skill.skillManifest;
    const status = skill.enabled ? "enabled" : "disabled";
    const routing =
      sm.toolAgentMap && sm.toolAgentMap.length > 0
        ? `${sm.toolAgentMap.length} custom route(s), default -> ${sm.defaultAgent}`
        : `all -> ${sm.defaultAgent}`;
    const gordonFlag = sm.alsoOnGordon ? " (+Gordon)" : "";

    lines.push(
      `  ${skill.pluginId} [${status}] — ${skill.toolCount} tool(s) [${routing}${gordonFlag}]`,
    );
  }

  return { success: true, message: lines.join("\n"), data: { skills } };
}

/**
 * /skill install <pluginId> [--agent <agentName>]
 */
export async function skillInstall(
  pluginId: string,
  defaultAgent: AgentAffinity = "Scanner",
): Promise<SkillCommandResult> {
  // Fetch from marketplace
  const listing = await marketplaceClient.getPlugin(pluginId);
  if (!listing) {
    return {
      success: false,
      message: `Skill "${pluginId}" not found in marketplace.`,
    };
  }

  if (pluginInstaller.isInstalled(pluginId)) {
    return {
      success: false,
      message: `Skill "${pluginId}" is already installed. Use "/skill route ${pluginId} <agent>" to change routing.`,
    };
  }

  // Install via MCP installer
  await pluginInstaller.install(listing);

  // Write skill.json with agent affinity
  const skillManifest: SkillManifest = {
    pluginId,
    defaultAgent,
    alsoOnGordon: false,
  };
  await writeSkillManifest(skillManifest);

  // Reload skills → rebuild routing → reset agents
  await reloadSkills();

  // Check if credentials are needed
  const needsCredentials =
    listing.manifest.authentication.type !== "none" &&
    !credentialManager.hasRequiredCredentials(listing.manifest);

  let message = `Installed skill "${listing.manifest.name}" -> ${defaultAgent} (${listing.manifest.tools.length} tools)`;
  if (needsCredentials) {
    message += `\nConfigure credentials: /skill configure ${pluginId}`;
  }

  return { success: true, message, data: { pluginId, defaultAgent } };
}

/**
 * /skill route <pluginId> <agentName> — Change where a skill's tools go
 */
export async function skillRoute(
  pluginId: string,
  agentName: AgentAffinity,
): Promise<SkillCommandResult> {
  if (!pluginInstaller.isInstalled(pluginId)) {
    return {
      success: false,
      message: `Skill "${pluginId}" is not installed.`,
    };
  }

  if (!isValidAgent(agentName)) {
    return {
      success: false,
      message: `Invalid agent "${agentName}". Valid: ${VALID_AGENTS.join(", ")}`,
    };
  }

  // Read existing or create new skill manifest
  const skillManifest: SkillManifest = {
    pluginId,
    defaultAgent: agentName,
    alsoOnGordon: false,
  };
  await writeSkillManifest(skillManifest);

  await reloadSkills();

  return {
    success: true,
    message: `Skill "${pluginId}" tools now route to ${agentName}.`,
  };
}

/**
 * /skill uninstall <pluginId>
 */
export async function skillUninstall(
  pluginId: string,
): Promise<SkillCommandResult> {
  const plugin = pluginInstaller.getPlugin(pluginId);
  if (!plugin) {
    return {
      success: false,
      message: `Skill "${pluginId}" is not installed.`,
    };
  }

  const name = plugin.manifest.name;
  await pluginInstaller.uninstall(pluginId);
  credentialManager.delete(pluginId);
  await reloadSkills();

  return { success: true, message: `Uninstalled skill "${name}".` };
}

/**
 * /skill enable <pluginId>
 */
export async function skillEnable(
  pluginId: string,
): Promise<SkillCommandResult> {
  if (!pluginInstaller.isInstalled(pluginId)) {
    return {
      success: false,
      message: `Skill "${pluginId}" is not installed.`,
    };
  }

  await pluginInstaller.enable(pluginId);
  await reloadSkills();

  return { success: true, message: `Enabled skill "${pluginId}".` };
}

/**
 * /skill disable <pluginId>
 */
export async function skillDisable(
  pluginId: string,
): Promise<SkillCommandResult> {
  if (!pluginInstaller.isInstalled(pluginId)) {
    return {
      success: false,
      message: `Skill "${pluginId}" is not installed.`,
    };
  }

  await pluginInstaller.disable(pluginId);
  await reloadSkills();

  return { success: true, message: `Disabled skill "${pluginId}".` };
}

// ============================================================================
// Command Router
// ============================================================================

/**
 * Handle /skill command routing
 */
export async function handleSkillCommand(
  args: string[],
): Promise<SkillCommandResult> {
  const subcommand = args[0]?.toLowerCase() ?? "list";
  const subArgs = args.slice(1);

  switch (subcommand) {
    case "list":
    case "ls":
      return skillList();

    case "install":
    case "add": {
      if (!subArgs[0]) {
        return {
          success: false,
          message: 'Usage: /skill install <id> [--agent <name>]',
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
      return skillInstall(subArgs[0], agent);
    }

    case "route":
    case "assign": {
      if (!subArgs[0] || !subArgs[1]) {
        return {
          success: false,
          message: `Usage: /skill route <id> <agent>\nAgents: ${VALID_AGENTS.join(", ")}`,
        };
      }
      return skillRoute(subArgs[0], subArgs[1] as AgentAffinity);
    }

    case "uninstall":
    case "remove":
    case "rm":
      if (!subArgs[0]) {
        return {
          success: false,
          message: "Usage: /skill uninstall <id>",
        };
      }
      return skillUninstall(subArgs[0]);

    case "enable":
      if (!subArgs[0]) {
        return { success: false, message: "Usage: /skill enable <id>" };
      }
      return skillEnable(subArgs[0]);

    case "disable":
      if (!subArgs[0]) {
        return { success: false, message: "Usage: /skill disable <id>" };
      }
      return skillDisable(subArgs[0]);

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
          message: "Usage: /skill configure <id>",
        };
      }
      const { mcpConfigure } = await import("./mcp.ts");
      return mcpConfigure(subArgs[0]);
    }

    case "info": {
      if (!subArgs[0]) {
        return { success: false, message: "Usage: /skill info <id>" };
      }
      const { mcpInfo } = await import("./mcp.ts");
      const infoResult = await mcpInfo(subArgs[0]);

      // Append routing info if it's an installed skill
      const skills = getResolvedSkills();
      const skill = skills.find((s) => s.pluginId === subArgs[0]);
      if (skill) {
        const sm = skill.skillManifest;
        const routing =
          sm.toolAgentMap && sm.toolAgentMap.length > 0
            ? sm.toolAgentMap
                .map((m) => `  ${m.toolName} -> ${m.agent}`)
                .join("\n")
            : `  all -> ${sm.defaultAgent}`;
        infoResult.message += `\n\nRouting:\n${routing}`;
        if (sm.alsoOnGordon) {
          infoResult.message += "\n  (also available on Gordon)";
        }
      }

      return infoResult;
    }

    case "help":
      return {
        success: true,
        message: `Skill Commands:
  /skill list                          — List installed skills with routing
  /skill search <query>                — Search marketplace
  /skill install <id> [--agent <name>] — Install and route to agent
  /skill uninstall <id>                — Remove a skill
  /skill route <id> <agent>            — Change agent routing
  /skill configure <id>                — Set up credentials
  /skill enable <id>                   — Enable a skill
  /skill disable <id>                  — Disable a skill
  /skill info <id>                     — Show skill details

Agents: ${VALID_AGENTS.join(", ")}`,
      };

    default:
      return {
        success: false,
        message: `Unknown subcommand "${subcommand}". Use "/skill help" for usage.`,
      };
  }
}
