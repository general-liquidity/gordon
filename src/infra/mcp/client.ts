/**
 * MCP Client — @mastra/mcp integration
 *
 * Bridges Gordon's plugin marketplace (install/enable/configure) with
 * Mastra's MCPClient for actual MCP server connections and tool discovery.
 *
 * Architecture:
 * - Reads installed+enabled plugins from PluginInstaller
 * - Converts MCPServerManifest → MastraMCPServerDefinition (stdio)
 * - Injects credentials from MCPCredentialManager into env
 * - Returns Mastra-native Tool objects ready to spread into agents
 *
 * Usage:
 * ```typescript
 * import { initMCPTools, getMCPTools, disconnectMCP } from './client';
 *
 * // At startup (async)
 * await initMCPTools();
 *
 * // In agent creation (sync)
 * const agent = new Agent({
 *   tools: { ...myTools, ...getMCPTools() },
 * });
 *
 * // At shutdown
 * await disconnectMCP();
 * ```
 */

import { MCPClient } from "@mastra/mcp";
import type { Tool } from "@mastra/core/tools";
import type { MastraMCPServerDefinition } from "@mastra/mcp";

import { pluginInstaller } from "./marketplace/installer.ts";
import { credentialManager } from "./credentials.ts";
import type { MCPServerManifest } from "./types.ts";

// ============================================================================
// State
// ============================================================================

let _mcpClient: MCPClient | null = null;
let _mcpTools: Record<string, Tool> | null = null;
let _initPromise: Promise<Record<string, Tool>> | null = null;

// ============================================================================
// Plugin → Server Definition Conversion
// ============================================================================

/**
 * Build environment variables for a plugin, merging manifest env with credentials
 */
function buildPluginEnv(manifest: MCPServerManifest): Record<string, string> {
  const env: Record<string, string> = {};

  // Copy manifest-defined env vars
  if (manifest.env) {
    Object.assign(env, manifest.env);
  }

  // Inject credentials as env vars
  const { authentication } = manifest;
  if (authentication.type === "api_key" && authentication.envVar) {
    const apiKey = credentialManager.getWithFallback(
      manifest.id,
      "apiKey",
      authentication.envVar,
    );
    if (apiKey) {
      env[authentication.envVar] = apiKey;
    }
  }

  // For custom field authentication, inject each field as env var
  if (authentication.fields) {
    const creds = credentialManager.retrieve(manifest.id);
    if (creds) {
      for (const field of authentication.fields) {
        if (creds[field.name]) {
          env[field.name.toUpperCase()] = creds[field.name]!;
        }
      }
    }
  }

  return env;
}

/**
 * Convert an installed plugin's manifest to a Mastra MCP server definition
 */
function manifestToServerDef(manifest: MCPServerManifest): MastraMCPServerDefinition | null {
  if (!manifest.command) {
    return null;
  }

  return {
    command: manifest.command,
    args: manifest.args,
    env: buildPluginEnv(manifest),
    timeout: 30_000,
  };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Initialize MCP tools from installed+enabled plugins
 *
 * Call this once at app startup. Safe to call multiple times — returns cached result.
 * If no plugins are installed/enabled, returns an empty object.
 *
 * @returns Record of Mastra-native Tool objects, namespaced as `pluginId_toolName`
 */
export async function initMCPTools(): Promise<Record<string, Tool>> {
  // Deduplicate concurrent calls
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    if (_mcpTools) return _mcpTools;

    try {
      await pluginInstaller.initialize();
      const installed = pluginInstaller.getInstalled().filter((p) => p.enabled);

      if (installed.length === 0) {
        _mcpTools = {};
        console.log("[MCP] No enabled plugins found");
        return _mcpTools;
      }

      // Build server definitions from installed plugins
      const servers: Record<string, MastraMCPServerDefinition> = {};
      for (const plugin of installed) {
        const serverDef = manifestToServerDef(plugin.manifest);
        if (serverDef) {
          servers[plugin.id] = serverDef;
        }
      }

      if (Object.keys(servers).length === 0) {
        _mcpTools = {};
        console.log("[MCP] No plugins with valid commands found");
        return _mcpTools;
      }

      // Create MCPClient and discover tools
      _mcpClient = new MCPClient({
        id: "gordon-mcp",
        servers,
        timeout: 30_000,
      });

      _mcpTools = await _mcpClient.listTools();
      const toolCount = Object.keys(_mcpTools).length;
      const serverCount = Object.keys(servers).length;
      console.log(`[MCP] Loaded ${toolCount} tools from ${serverCount} plugin(s)`);

      return _mcpTools;
    } catch (error) {
      console.error("[MCP] Failed to initialize MCP tools:", (error as Error).message);
      _mcpTools = {};
      return _mcpTools;
    }
  })();

  return _initPromise;
}

/**
 * Get cached MCP tools (synchronous)
 *
 * Returns empty object if initMCPTools() hasn't been called or no plugins are installed.
 * Safe to call at any time — never throws.
 */
export function getMCPTools(): Record<string, Tool> {
  return _mcpTools ?? {};
}

/**
 * Get tool names organized by plugin server
 * Useful for TOOL_AGENT_MAP population
 */
export function getMCPToolsByServer(): Record<string, string[]> {
  if (!_mcpTools) return {};

  const byServer: Record<string, string[]> = {};
  for (const toolName of Object.keys(_mcpTools)) {
    // MCPClient namespaces as serverName_toolName
    const underscoreIdx = toolName.indexOf("_");
    if (underscoreIdx > 0) {
      const serverName = toolName.substring(0, underscoreIdx);
      if (!byServer[serverName]) byServer[serverName] = [];
      byServer[serverName].push(toolName);
    }
  }
  return byServer;
}

/**
 * Disconnect all MCP servers and release resources
 * Call at app shutdown
 */
export async function disconnectMCP(): Promise<void> {
  if (_mcpClient) {
    try {
      await _mcpClient.disconnect();
    } catch (error) {
      console.error("[MCP] Error during disconnect:", (error as Error).message);
    }
    _mcpClient = null;
  }
  _mcpTools = null;
  _initPromise = null;
}

/**
 * Check if MCP tools have been initialized
 */
export function isMCPInitialized(): boolean {
  return _mcpTools !== null;
}

/**
 * Get MCP client stats
 */
export function getMCPStats(): {
  initialized: boolean;
  toolCount: number;
  serverCount: number;
  toolNames: string[];
} {
  const toolNames = Object.keys(_mcpTools ?? {});
  const servers = new Set(
    toolNames.map((name) => {
      const idx = name.indexOf("_");
      return idx > 0 ? name.substring(0, idx) : name;
    }),
  );

  return {
    initialized: _mcpTools !== null,
    toolCount: toolNames.length,
    serverCount: servers.size,
    toolNames,
  };
}
