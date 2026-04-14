import { useState, useEffect, useMemo } from "react";
import { getRuntime } from "../bridge/runtime.js";

// ============================================================================
// useMergedTools — Unified tool list from built-in + MCP + plugins
//
// Reads from the active SessionRuntime to build a single array of all
// available tools with source attribution.
// ============================================================================

export type ToolSource = "builtin" | "mcp" | "plugin";

export interface MergedTool {
  id: string;
  name: string;
  source: ToolSource;
  /** MCP server name (only when source === "mcp") */
  serverName?: string;
  /** Plugin name (only when source === "plugin") */
  pluginName?: string;
  /** Brief description if available */
  description?: string;
}

export function useMergedTools(): MergedTool[] {
  const [tools, setTools] = useState<MergedTool[]>([]);

  useEffect(() => {
    const runtime = getRuntime();
    if (!runtime) return;

    const refresh = () => {
      const merged: MergedTool[] = [];

      // 1. Built-in tools from runtime registry
      try {
        const registeredTools = runtime.getRegisteredTools() as any[];
        for (const tool of registeredTools) {
          merged.push({
            id: `builtin:${tool.name ?? tool.id}`,
            name: tool.name ?? tool.id,
            source: "builtin",
            description: tool.description,
          });
        }
      } catch {
        // getRegisteredTools may not be available on all runtime versions
      }

      // 2. MCP server tools
      try {
        const state = runtime.getState();
        const mcpServers = (state.tooling?.mcpServers ?? []) as any[];
        for (const server of mcpServers) {
          const serverTools = server.tools ?? [];
          for (const tool of serverTools) {
            merged.push({
              id: `mcp:${server.name}:${tool.name}`,
              name: tool.name,
              source: "mcp",
              serverName: server.name,
              description: tool.description,
            });
          }
        }
      } catch {
        // MCP may not be configured
      }

      // 3. Plugin tools
      try {
        const state = runtime.getState();
        const plugins = (state.tooling?.plugins ?? []) as any[];
        for (const plugin of plugins) {
          if (!plugin.enabled) continue;
          const pluginTools = plugin.tools ?? [];
          for (const tool of pluginTools) {
            merged.push({
              id: `plugin:${plugin.name}:${tool.name}`,
              name: tool.name,
              source: "plugin",
              pluginName: plugin.name,
              description: tool.description,
            });
          }
        }
      } catch {
        // Plugins may not be configured
      }

      setTools(merged);
    };

    refresh();

    // Re-poll on tooling changes (subscribe if runtime supports it)
    const unsubscribe = runtime.subscribe(() => {
      refresh();
    });

    return () => {
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, []);

  return tools;
}

/**
 * Returns a human-readable badge for the tool source.
 */
export function toolSourceBadge(tool: MergedTool): string {
  switch (tool.source) {
    case "mcp":
      return `MCP:${tool.serverName ?? "?"}`;
    case "plugin":
      return `PLG:${tool.pluginName ?? "?"}`;
    case "builtin":
    default:
      return "BUILT-IN";
  }
}
