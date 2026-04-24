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
import type { MCPCategory, MCPServerManifest } from "./types.ts";
import { withRetry, isServerCachedAsFailing, recordServerSuccess } from "./resilience.ts";
import {
  loadDiscoveryCache,
  saveDiscoveryCache,
  buildDescriptorsFromLiveTools,
  type CachedToolDescriptor,
} from "./discoveryCache.ts";

// ============================================================================
// State
// ============================================================================

let _mcpClient: MCPClient | null = null;
let _mcpTools: Record<string, Tool> | null = null;
let _initPromise: Promise<Record<string, Tool>> | null = null;
let _discoveryPromise: Promise<Record<string, Tool>> | null = null;
let _hotReloadTimer: ReturnType<typeof setInterval> | null = null;
let _lastPluginFingerprint: string | null = null;
let _hotReloadInFlight = false;
let _mcpServers: Record<string, MastraMCPServerDefinition> | null = null;
let _schemasDiscovered = false;
const _discoveredServerIds = new Set<string>();
/** Cached descriptors loaded from disk before first live discovery. Used for
 * fast bootstrap diagnostics + lazy-discovery decisions. */
let _cachedToolDescriptors: Record<string, CachedToolDescriptor> = {};
let _backgroundRefreshScheduled = false;
let _routingManagerPromise: Promise<typeof import("../../runtime/routing/manager.ts")> | null = null;

function buildPluginFingerprint(installedPlugins: Array<{ id: string; enabled: boolean; version?: string }>): string {
  return installedPlugins
    .map((plugin) => `${plugin.id}:${plugin.enabled ? "1" : "0"}:${plugin.version ?? "0"}`)
    .sort()
    .join("|");
}

function loadRoutingManager(): Promise<typeof import("../../runtime/routing/manager.ts")> {
  if (!_routingManagerPromise) {
    // Avoid a static import cycle with routing/manager when Bun compiles the binary.
    _routingManagerPromise = import("../../runtime/routing/manager.ts");
  }

  return _routingManagerPromise;
}

async function syncRoutingIfInitialized(): Promise<void> {
  const routingManager = await loadRoutingManager();
  if (routingManager.isRoutingInitialized()) {
    routingManager.syncRoutingWithCurrentMCPTools();
  }
}

async function reloadRoutingOrMCPTools(): Promise<void> {
  const routingManager = await loadRoutingManager();
  if (routingManager.isRoutingInitialized()) {
    await routingManager.reloadRouting();
  } else {
    await reloadMCPTools();
  }
}

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

  // For custom field authentication, inject each field as env var.
  // Convention: field names are uppercased to form env var names
  // (e.g., field.name "apiKey" becomes env var "APIKEY").
  // If a field has a specific envVar on the parent authentication config,
  // that is handled above. This loop covers additional custom fields.
  if (authentication.fields) {
    const creds = credentialManager.retrieve(manifest.id);
    if (creds) {
      for (const field of authentication.fields) {
        if (creds[field.name]) {
          // Use the authentication-level envVar if this is the primary API key field,
          // otherwise uppercase the field name as the env var convention
          const envKey =
            authentication.envVar && authentication.fields.length === 1
              ? authentication.envVar
              : field.name.toUpperCase();
          env[envKey] = creds[field.name]!;
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
 * This primes plugin metadata and server definitions but defers expensive tool-schema
 * discovery until the first request that needs external MCP tools.
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
      _lastPluginFingerprint = buildPluginFingerprint(installed);

      if (installed.length === 0) {
        _mcpTools = {};
        _mcpServers = {};
        _schemasDiscovered = true;
        if (process.env.GORDON_STARTUP_QUIET !== "1") {
          console.log("[MCP] No enabled plugins found");
        }
        return _mcpTools;
      }

      // Build server definitions from installed plugins
      const servers: Record<string, MastraMCPServerDefinition> = {};
      for (const plugin of installed) {
        const serverDef = manifestToServerDef(plugin.manifest);
        if (serverDef) {
          servers[plugin.id] = serverDef;
        } else {
          console.warn(`[MCP] Skipping plugin without command: ${plugin.manifest.name ?? plugin.id}`);
        }
      }

      if (Object.keys(servers).length === 0) {
        _mcpTools = {};
        _mcpServers = {};
        _schemasDiscovered = true;
        if (process.env.GORDON_STARTUP_QUIET !== "1") {
          console.log("[MCP] No plugins with valid commands found");
        }
        return _mcpTools;
      }

      _mcpServers = servers;
      _mcpTools = {};
      _schemasDiscovered = false;
      _discoveredServerIds.clear();
      const serverCount = Object.keys(servers).length;
      loggerInfo(`[MCP] Ready ${serverCount} plugin(s) for lazy tool discovery`);

      // Phase 1: load on-disk cache so the user sees a tool count immediately.
      // The cache is metadata-only; a live MCPClient connection is still
      // required before any tool can actually execute. The cache primarily
      // accelerates the "what tools do I have?" UX path.
      try {
        const loadResult = await loadDiscoveryCache(_lastPluginFingerprint ?? "");
        if (loadResult.cache && loadResult.fresh) {
          _cachedToolDescriptors = loadResult.cache.tools;
          loggerInfo(
            `[MCP] Loaded ${Object.keys(_cachedToolDescriptors).length} cached tool descriptor(s) (${Math.round(loadResult.ageMs / 60000)}m old)`,
          );
        } else if (loadResult.cache) {
          _cachedToolDescriptors = loadResult.cache.tools;
          loggerInfo(`[MCP] Stale cache (${loadResult.reason}); will refresh in background`);
        }
      } catch {
        // Cache load is best-effort.
      }

      return _mcpTools;
    } catch (error) {
      console.error("[MCP] Failed to initialize MCP tools:", (error as Error).message);
      _mcpTools = {};
      return _mcpTools;
    }
  })();

  return _initPromise;
}

function loggerInfo(message: string): void {
  if (process.env.GORDON_STARTUP_QUIET !== "1") {
    console.log(message);
  }
}

export async function ensureMCPToolsDiscovered(serverIds?: string[]): Promise<Record<string, Tool>> {
  const normalizedServerIds = serverIds?.filter(Boolean);

  if (
    _mcpTools &&
    (
      (_schemasDiscovered && !normalizedServerIds?.length) ||
      (normalizedServerIds?.length && normalizedServerIds.every((id) => _discoveredServerIds.has(id)))
    )
  ) {
    return _mcpTools;
  }

  if (!normalizedServerIds?.length && _discoveryPromise) {
    return _discoveryPromise;
  }

  const discoveryTask = (async () => {
    await initMCPTools();

    if (
      _mcpTools &&
      (
        (_schemasDiscovered && !normalizedServerIds?.length) ||
        (normalizedServerIds?.length && normalizedServerIds.every((id) => _discoveredServerIds.has(id)))
      )
    ) {
      return _mcpTools;
    }

    const servers = _mcpServers ?? {};
    if (Object.keys(servers).length === 0) {
      _mcpTools = {};
      _schemasDiscovered = true;
      return _mcpTools;
    }

    const selectedServers = normalizedServerIds?.length
      ? Object.fromEntries(
          normalizedServerIds
            .filter((id) => Boolean(servers[id]))
            .map((id) => [id, servers[id]!]),
        )
      : servers;

    if (Object.keys(selectedServers).length === 0) {
      return _mcpTools ?? {};
    }

    if (!normalizedServerIds?.length && !_mcpClient) {
      _mcpClient = new MCPClient({
        id: "gordon-mcp",
        servers,
        timeout: 30_000,
      });
    }

    const client = normalizedServerIds?.length
      ? new MCPClient({
          id: "gordon-mcp-targeted",
          servers: selectedServers,
          timeout: 30_000,
        })
      : _mcpClient!;

    // Filter out servers cached as failing (skip them, don't waste time)
    const activeServerIds = Object.keys(selectedServers).filter(
      (id) => !isServerCachedAsFailing(id),
    );
    if (activeServerIds.length < Object.keys(selectedServers).length) {
      const skipped = Object.keys(selectedServers).length - activeServerIds.length;
      loggerInfo(`[MCP] Skipping ${skipped} server(s) cached as failing`);
    }

    // Discover tools with retry + backoff for each server
    const discoveredTools = await withRetry(
      normalizedServerIds?.[0] ?? "gordon-mcp",
      () => client.listTools(),
    );
    _mcpTools = {
      ...(_mcpTools ?? {}),
      ...discoveredTools,
    };

    // Mark all discovered servers as healthy
    for (const id of activeServerIds) recordServerSuccess(id);

    if (normalizedServerIds?.length) {
      normalizedServerIds.forEach((id) => _discoveredServerIds.add(id));
      try {
        await client.disconnect();
      } catch {
        // best effort for targeted one-shot discovery
      }
    } else {
      _schemasDiscovered = true;
      Object.keys(servers).forEach((id) => _discoveredServerIds.add(id));
    }
    loggerInfo(`[MCP] Loaded ${Object.keys(discoveredTools).length} tool(s) on demand`);

    // Persist the discovered tool names + descriptions for fast cold starts.
    // Fire-and-forget — cache writes never block the request path.
    try {
      const descriptors = buildDescriptorsFromLiveTools(_mcpTools);
      _cachedToolDescriptors = descriptors;
      void saveDiscoveryCache(_lastPluginFingerprint ?? "", descriptors);
    } catch {
      // Cache write failure is non-fatal.
    }

    await syncRoutingIfInitialized();

    return _mcpTools;
  })();

  if (!normalizedServerIds?.length) {
    _discoveryPromise = discoveryTask;
  }

  try {
    return await discoveryTask;
  } finally {
    if (!normalizedServerIds?.length) {
      _discoveryPromise = null;
    }
  }
}

/**
 * Reload MCP tools from installed plugins without process restart.
 */
export async function reloadMCPTools(): Promise<Record<string, Tool>> {
  await disconnectMCP();
  return initMCPTools();
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
 * Get the descriptor map loaded from the on-disk discovery cache.
 *
 * Unlike getMCPTools(), this returns metadata only — name, server, optional
 * description — and is populated immediately at init time without a live
 * MCPClient connection. Used for cold-start UX (showing the user what
 * tools will be available before discovery completes).
 */
export function getCachedToolDescriptors(): Record<string, CachedToolDescriptor> {
  return _cachedToolDescriptors;
}

/**
 * Phase 2 of lazy discovery: kick a background refresh of the discovery
 * cache once the first response has been delivered.
 *
 * Idempotent — only one refresh runs per process even if called multiple times.
 * Use this after the first user-visible response so the next session has a
 * fresh cache without delaying the current request.
 */
export function scheduleBackgroundDiscoveryRefresh(): void {
  if (_backgroundRefreshScheduled) return;
  if (_schemasDiscovered) return; // already up to date
  if (!_mcpServers || Object.keys(_mcpServers).length === 0) return;
  _backgroundRefreshScheduled = true;

  // Defer to the next tick so we don't block whatever just yielded the
  // first response. setImmediate isn't available in all runtimes Bun
  // bundles, so use setTimeout(0) for portability.
  setTimeout(() => {
    void ensureMCPToolsDiscovered()
      .catch((err) => {
        if (process.env.GORDON_STARTUP_QUIET !== "1") {
          console.warn("[MCP] Background discovery refresh failed:", (err as Error).message);
        }
      })
      .finally(() => {
        _backgroundRefreshScheduled = false;
      });
  }, 0);
}

export function getScopedMCPTools(options?: {
  categories?: MCPCategory[];
  excludeCategories?: MCPCategory[];
}): Record<string, Tool> {
  const tools = _mcpTools ?? {};
  if (!options?.categories?.length && !options?.excludeCategories?.length) {
    return tools;
  }

  const allowedCategories = options.categories ? new Set(options.categories) : null;
  const excludedCategories = new Set(options.excludeCategories ?? []);
  const categoriesByServer = new Map(
    pluginInstaller.getInstalled().map((plugin) => [plugin.id, plugin.manifest.category] as const),
  );

  return Object.fromEntries(
    Object.entries(tools).filter(([toolName]) => {
      const underscoreIdx = toolName.indexOf("_");
      if (underscoreIdx <= 0) return true;

      const serverId = toolName.substring(0, underscoreIdx);
      const category = categoriesByServer.get(serverId);
      if (!category) return true;
      if (excludedCategories.has(category)) return false;
      if (allowedCategories && !allowedCategories.has(category)) return false;
      return true;
    }),
  );
}

export function areMCPSchemasDiscovered(serverIds?: string[]): boolean {
  if (!serverIds?.length) {
    return _schemasDiscovered;
  }
  return serverIds.every((id) => _discoveredServerIds.has(id));
}

export interface MCPDiscoveryIntent {
  shouldDiscover: boolean;
  matchedServerIds: string[];
  reasons: string[];
}

function tokenizeForDiscoveryMatch(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

export function getMCPDiscoveryIntent(userMessage: string): MCPDiscoveryIntent {
  const summaries = getMCPServerSummary();
  if (summaries.length === 0) {
    return {
      shouldDiscover: false,
      matchedServerIds: [],
      reasons: [],
    };
  }

  const lower = userMessage.toLowerCase();
  const matchedServerIds = new Set<string>();
  const reasons = new Set<string>();

  if (/\b(mcp|plugin|plugins|tool server|external tool)\b/i.test(lower)) {
    summaries.forEach((summary) => matchedServerIds.add(summary.id));
    reasons.add("The request explicitly mentions MCP or plugins.");
  }

  for (const summary of summaries) {
    const aliases = new Set<string>([
      summary.id.toLowerCase(),
      summary.name.toLowerCase(),
      summary.category.toLowerCase(),
      ...tokenizeForDiscoveryMatch(summary.name),
      ...tokenizeForDiscoveryMatch(summary.category),
    ]);

    for (const alias of aliases) {
      if (!alias) continue;
      if (alias.includes(" ")) {
        if (lower.includes(alias)) {
          matchedServerIds.add(summary.id);
          reasons.add(`The request mentions ${summary.name}.`);
        }
        continue;
      }

      const pattern = new RegExp(`(^|[^a-z0-9])${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i");
      if (pattern.test(lower)) {
        matchedServerIds.add(summary.id);
        reasons.add(`The request mentions ${summary.name}.`);
      }
    }
  }

  return {
    shouldDiscover: matchedServerIds.size > 0,
    matchedServerIds: [...matchedServerIds],
    reasons: [...reasons],
  };
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
  _discoveryPromise = null;
  _mcpServers = null;
  _schemasDiscovered = false;
  _discoveredServerIds.clear();
  _cachedToolDescriptors = {};
  _backgroundRefreshScheduled = false;
}

/**
 * Enable hot reload polling for plugin changes.
 *
 * This checks installed/enabled plugin metadata periodically and refreshes MCP
 * tools when a change is detected.
 */
export function enableMCPHotReload(intervalMs: number = 5000): void {
  if (_hotReloadTimer) return;

  _hotReloadTimer = setInterval(() => {
    if (_hotReloadInFlight) {
      return;
    }

    _hotReloadInFlight = true;
    void (async () => {
      try {
        await pluginInstaller.initialize();
        const installed = pluginInstaller.getInstalled().filter((p) => p.enabled);
        const fingerprint = buildPluginFingerprint(installed);

        if (_lastPluginFingerprint !== null && fingerprint !== _lastPluginFingerprint) {
          console.log("[MCP] Plugin change detected, hot-reloading...");
          await reloadRoutingOrMCPTools();
        }

        _lastPluginFingerprint = fingerprint;
      } catch (error) {
        console.error("[MCP] Hot reload polling failed:", (error as Error).message);
      } finally {
        _hotReloadInFlight = false;
      }
    })();
  }, intervalMs);
}

export function disableMCPHotReload(): void {
  if (_hotReloadTimer) {
    clearInterval(_hotReloadTimer);
    _hotReloadTimer = null;
  }
  _hotReloadInFlight = false;
}

/**
 * Check if MCP tools have been initialized
 */
export function isMCPInitialized(): boolean {
  return _mcpTools !== null;
}

/**
 * Get a compact metadata-only summary of available MCP servers without
 * triggering full tool-schema discovery. Safe to call at startup.
 *
 * This implements the paper's "compact summary of available servers and their
 * capabilities" that is loaded at startup (<5% context cost) while deferring
 * full schema discovery to point-of-use via ensureMCPToolsDiscovered().
 */
export function getMCPServerSummary(): Array<{
  id: string;
  name: string;
  category: string;
  toolCount: number | null;
}> {
  const installed = pluginInstaller.getInstalled().filter((p) => p.enabled);
  return installed.map((plugin) => {
    let toolCount: number | null = null;
    if (_schemasDiscovered && _mcpTools) {
      const prefix = plugin.id + "_";
      toolCount = Object.keys(_mcpTools).filter((t) => t.startsWith(prefix)).length;
    }
    return {
      id: plugin.id,
      name: plugin.manifest.name ?? plugin.id,
      category: plugin.manifest.category ?? "general",
      toolCount,
    };
  });
}

/**
 * Get MCP client stats
 */
export function getMCPStats(): {
  initialized: boolean;
  discovered: boolean;
  toolCount: number;
  serverCount: number;
  toolNames: string[];
} {
  const toolNames = Object.keys(_mcpTools ?? {});
  const servers = _mcpServers
    ? new Set(Object.keys(_mcpServers))
    : new Set(
        toolNames.map((name) => {
          const idx = name.indexOf("_");
          return idx > 0 ? name.substring(0, idx) : name;
        }),
      );

  return {
    initialized: _mcpTools !== null,
    discovered: _schemasDiscovered,
    toolCount: toolNames.length,
    serverCount: servers.size,
    toolNames,
  };
}
