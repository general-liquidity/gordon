import { useMemo } from "react";
import { SLASH_COMMANDS } from "../../app/slash/slashCommands.ts";
import { paletteWorkflowFor } from "../../app/slash/commandUx.ts";
import type { PaletteItem } from "../components/CommandPalette.js";
import { getRuntime } from "../bridge/runtime.js";
import { getBinding, type BindableAction } from "../keybindings/keybindings.ts";

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

const KEY_HINT_ACTIONS: Record<string, BindableAction> = {
  emergency: "toggleEmergencyHalt",
  menu: "togglePalette",
  "settings-panel": "toggleSettings",
  "export-panel": "toggleExport",
  privacy: "togglePrivacy",
  "context-viz": "toggleContextView",
};

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
        workflowId: paletteWorkflowFor(cmd),
        keyHint: formatBinding(KEY_HINT_ACTIONS[cmd.name]),
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
              workflowId: "system",
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
              workflowId: "system",
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

function formatBinding(action: BindableAction | undefined): string | undefined {
  if (!action) return undefined;
  const binding = getBinding(action);
  if (!binding) return undefined;
  return binding.key
    .split("+")
    .map((part) =>
      part.length === 1 ? part.toUpperCase() : part[0]!.toUpperCase() + part.slice(1),
    )
    .join("+");
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
