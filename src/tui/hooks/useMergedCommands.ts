import { useMemo } from "react";
import { SLASH_COMMANDS } from "../../app/slash/slashCommands.ts";
import type { PaletteItem } from "../components/CommandPalette.js";
import { getRuntime } from "../bridge/runtime.js";

// ============================================================================
// useMergedCommands — Unified command list for CommandPalette
//
// Merges built-in SLASH_COMMANDS with plugin-contributed commands from
// the runtime tooling state. Returns PaletteItem[] with category badges.
// ============================================================================

export interface MergedCommand extends PaletteItem {
  /** Source of the command */
  source: "builtin" | "plugin" | "mcp";
  /** Badge text shown next to the command in the palette */
  badge?: string;
}

export function useMergedCommands(): MergedCommand[] {
  return useMemo(() => {
    const merged: MergedCommand[] = [];

    // 1. Built-in slash commands
    for (const cmd of SLASH_COMMANDS) {
      merged.push({
        id: cmd.name,
        label: `/${cmd.name}`,
        description: cmd.description,
        category: cmd.workflow,
        source: "builtin",
      });
    }

    // 2. Plugin-contributed commands from runtime state
    try {
      const runtime = getRuntime();
      if (runtime) {
        const state = runtime.getState();

        // Plugin commands
        const plugins = (state.tooling?.plugins ?? []) as any[];
        for (const plugin of plugins) {
          if (!plugin.enabled) continue;
          const commands = plugin.commands ?? [];
          for (const cmd of commands) {
            merged.push({
              id: `plugin:${plugin.name}:${cmd.name}`,
              label: `/${cmd.name}`,
              description: cmd.description ?? `[${plugin.name}]`,
              category: "Plugins",
              source: "plugin",
              badge: `PLG:${plugin.name}`,
            });
          }
        }

        // MCP server commands (if any expose slash-style commands)
        const mcpServers = (state.tooling?.mcpServers ?? []) as any[];
        for (const server of mcpServers) {
          const commands = server.commands ?? [];
          for (const cmd of commands) {
            merged.push({
              id: `mcp:${server.name}:${cmd.name}`,
              label: `/${cmd.name}`,
              description: cmd.description ?? `[MCP:${server.name}]`,
              category: "MCP",
              source: "mcp",
              badge: `MCP:${server.name}`,
            });
          }
        }
      }
    } catch {
      // Runtime may not be initialized yet
    }

    return merged;
  }, []);
}

/**
 * Filter merged commands by source type.
 */
export function filterBySource(
  commands: MergedCommand[],
  source: MergedCommand["source"],
): MergedCommand[] {
  return commands.filter((c) => c.source === source);
}
