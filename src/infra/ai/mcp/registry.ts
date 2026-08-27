/**
 * MCP Server Registry
 * Central registry for MCP server management
 *
 * Similar pattern to ProviderRegistry but for MCP servers.
 * Manages server manifests, configurations, and running instances.
 */

import type {
  MCPCategory,
  MCPServerConfig,
  MCPServerInstance,
  MCPServerManifest,
  MCPServerEvent,
  MCPServerEventHandler,
} from "./types";
import { createServerInstance } from "./server-instance";
import { credentialManager } from "./credentials";

// ============================================================================
// MCP Server Registry
// ============================================================================

/**
 * MCP Server Registry - manages MCP server lifecycle and discovery
 *
 * Responsibilities:
 * - Register/unregister server manifests
 * - Manage server configurations
 * - Start/stop server instances
 * - Route tool calls to appropriate servers
 */
export class MCPServerRegistry {
  /** Registered server manifests */
  private manifests = new Map<string, MCPServerManifest>();

  /** Running server instances */
  private instances = new Map<string, MCPServerInstance>();

  /** Server configurations */
  private configs = new Map<string, MCPServerConfig>();

  /** Event handlers */
  private eventHandlers: MCPServerEventHandler[] = [];

  // ==========================================================================
  // Manifest Management
  // ==========================================================================

  /**
   * Register a server manifest
   * @param manifest - Server manifest to register
   */
  register(manifest: MCPServerManifest): void {
    if (this.manifests.has(manifest.id)) {
      throw new Error(`Server "${manifest.id}" is already registered`);
    }
    this.manifests.set(manifest.id, manifest);

    // Create default config if not exists
    if (!this.configs.has(manifest.id)) {
      this.configs.set(manifest.id, {
        id: manifest.id,
        enabled: true,
        priority: 0,
      });
    }
  }

  /**
   * Unregister a server manifest
   * @param serverId - Server ID to unregister
   */
  async unregister(serverId: string): Promise<void> {
    // Stop if running
    if (this.instances.has(serverId)) {
      await this.stopServer(serverId);
    }

    this.manifests.delete(serverId);
    this.configs.delete(serverId);
  }

  /**
   * Get a server manifest by ID
   * @param serverId - Server ID
   * @returns Manifest or undefined
   */
  getManifest(serverId: string): MCPServerManifest | undefined {
    return this.manifests.get(serverId);
  }

  /**
   * List all registered manifests
   * @returns Array of manifests
   */
  listManifests(): MCPServerManifest[] {
    return Array.from(this.manifests.values());
  }

  /**
   * List manifests by category
   * @param category - Category to filter by
   * @returns Array of manifests in the category
   */
  listByCategory(category: MCPCategory): MCPServerManifest[] {
    return this.listManifests().filter((m) => m.category === category);
  }

  /**
   * Check if a server is registered
   * @param serverId - Server ID
   * @returns True if registered
   */
  isRegistered(serverId: string): boolean {
    return this.manifests.has(serverId);
  }

  // ==========================================================================
  // Instance Management
  // ==========================================================================

  /**
   * Get a running server instance, starting it if needed
   * @param serverId - Server ID
   * @returns Running server instance
   */
  async getInstance(serverId: string): Promise<MCPServerInstance> {
    // Check if already running
    const existing = this.instances.get(serverId);
    if (existing && existing.status === "running") {
      return existing;
    }

    // Start the server
    return this.startServer(serverId);
  }

  /**
   * Start a server
   * @param serverId - Server ID
   * @returns Started server instance
   */
  async startServer(serverId: string): Promise<MCPServerInstance> {
    const manifest = this.manifests.get(serverId);
    if (!manifest) {
      throw new Error(`Server "${serverId}" not found`);
    }

    const config = this.configs.get(serverId);
    if (config && !config.enabled) {
      throw new Error(`Server "${serverId}" is disabled`);
    }

    // Check credentials
    if (!credentialManager.hasRequiredCredentials(manifest)) {
      const missing = credentialManager.getMissingCredentials(manifest);
      throw new Error(`Missing required credentials for "${serverId}": ${missing.join(", ")}`);
    }

    // Check if already running
    const existing = this.instances.get(serverId);
    if (existing && existing.status === "running") {
      return existing;
    }

    // Create and start instance
    const instance = createServerInstance(manifest);

    try {
      // The instance from createServerInstance is a LocalMCPServerInstance which has start()
      // Cast to access the start method which isn't in the base interface
      const startableInstance = instance as MCPServerInstance & { start(): Promise<void> };
      await startableInstance.start();
      this.instances.set(serverId, instance);

      this.emitEvent({
        type: "started",
        serverId,
        timestamp: Date.now(),
      });

      return instance;
    } catch (err) {
      this.emitEvent({
        type: "error",
        serverId,
        error: err instanceof Error ? err.message : String(err),
        timestamp: Date.now(),
      });
      throw err;
    }
  }

  /**
   * Stop a server
   * @param serverId - Server ID
   */
  async stopServer(serverId: string): Promise<void> {
    const instance = this.instances.get(serverId);
    if (!instance) {
      return; // Already stopped
    }

    try {
      await instance.stop();
    } finally {
      this.instances.delete(serverId);

      this.emitEvent({
        type: "stopped",
        serverId,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Stop all running servers
   */
  async stopAll(): Promise<void> {
    const stopPromises = Array.from(this.instances.keys()).map((id) => this.stopServer(id));
    await Promise.allSettled(stopPromises);
  }

  /**
   * Get server status
   * @param serverId - Server ID
   * @returns Server status
   */
  getStatus(serverId: string): MCPServerInstance["status"] | "unregistered" {
    if (!this.manifests.has(serverId)) {
      return "unregistered";
    }

    const instance = this.instances.get(serverId);
    return instance?.status || "stopped";
  }

  /**
   * List running server IDs
   * @returns Array of running server IDs
   */
  listRunning(): string[] {
    return Array.from(this.instances.entries())
      .filter(([_, instance]) => instance.status === "running")
      .map(([id]) => id);
  }

  // ==========================================================================
  // Configuration Management
  // ==========================================================================

  /**
   * Configure a server
   * @param serverId - Server ID
   * @param config - Configuration options
   */
  configure(serverId: string, config: Partial<MCPServerConfig>): void {
    const existing = this.configs.get(serverId) || {
      id: serverId,
      enabled: true,
    };

    this.configs.set(serverId, {
      ...existing,
      ...config,
      id: serverId, // Ensure ID is not overwritten
    });

    // Store credentials if provided
    if (config.credentials) {
      credentialManager.store(serverId, config.credentials);
    }
  }

  /**
   * Get server configuration
   * @param serverId - Server ID
   * @returns Configuration or undefined
   */
  getConfig(serverId: string): MCPServerConfig | undefined {
    return this.configs.get(serverId);
  }

  /**
   * List all configurations
   * @returns Array of configurations
   */
  listConfigs(): MCPServerConfig[] {
    return Array.from(this.configs.values());
  }

  /**
   * Enable a server
   * @param serverId - Server ID
   */
  enable(serverId: string): void {
    this.configure(serverId, { enabled: true });
  }

  /**
   * Disable a server
   * @param serverId - Server ID
   */
  async disable(serverId: string): Promise<void> {
    // Stop if running
    await this.stopServer(serverId);
    this.configure(serverId, { enabled: false });
  }

  // ==========================================================================
  // Tool Invocation
  // ==========================================================================

  /**
   * Call a tool on a server
   * @param serverId - Server ID
   * @param toolName - Tool name
   * @param params - Tool parameters
   * @returns Tool result
   */
  async callTool(serverId: string, toolName: string, params: unknown): Promise<unknown> {
    const instance = await this.getInstance(serverId);

    this.emitEvent({
      type: "tool_called",
      serverId,
      toolName,
      timestamp: Date.now(),
    });

    return instance.callTool(toolName, params);
  }

  /**
   * Find servers that provide a specific tool
   * @param toolName - Tool name to search for
   * @returns Array of server IDs that provide the tool
   */
  findServersWithTool(toolName: string): string[] {
    const servers: string[] = [];

    for (const manifest of this.manifests.values()) {
      const config = this.configs.get(manifest.id);
      if (config && !config.enabled) continue;

      if (manifest.tools.some((t) => t.name === toolName)) {
        servers.push(manifest.id);
      }
    }

    // Sort by priority
    servers.sort((a, b) => {
      const priorityA = this.configs.get(a)?.priority || 0;
      const priorityB = this.configs.get(b)?.priority || 0;
      return priorityB - priorityA;
    });

    return servers;
  }

  /**
   * Get all available tools across all enabled servers
   * @returns Array of tools with their server info
   */
  getAllTools(): Array<{
    serverId: string;
    serverName: string;
    tool: MCPServerManifest["tools"][number];
  }> {
    const tools: Array<{
      serverId: string;
      serverName: string;
      tool: MCPServerManifest["tools"][number];
    }> = [];

    for (const manifest of this.manifests.values()) {
      const config = this.configs.get(manifest.id);
      if (config && !config.enabled) continue;

      for (const tool of manifest.tools) {
        tools.push({
          serverId: manifest.id,
          serverName: manifest.name,
          tool,
        });
      }
    }

    return tools;
  }

  // ==========================================================================
  // Event Handling
  // ==========================================================================

  /**
   * Add an event handler
   * @param handler - Event handler function
   * @returns Unsubscribe function
   */
  onEvent(handler: MCPServerEventHandler): () => void {
    this.eventHandlers.push(handler);
    return () => {
      const index = this.eventHandlers.indexOf(handler);
      if (index !== -1) {
        this.eventHandlers.splice(index, 1);
      }
    };
  }

  /**
   * Emit an event to all handlers
   */
  private emitEvent(event: MCPServerEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch {
        // Ignore handler errors
      }
    }
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  /**
   * Reset the registry (for testing)
   */
  async reset(): Promise<void> {
    await this.stopAll();
    this.manifests.clear();
    this.configs.clear();
    this.eventHandlers.length = 0;
  }

  /**
   * Get registry statistics
   */
  getStats(): {
    registered: number;
    running: number;
    enabled: number;
    byCategory: Record<MCPCategory, number>;
  } {
    const byCategory: Record<MCPCategory, number> = {
      "data-provider": 0,
      analytics: 0,
      execution: 0,
      exchange: 0,
      infrastructure: 0,
      portfolio: 0,
      research: 0,
      utility: 0,
    };

    let enabled = 0;
    for (const manifest of this.manifests.values()) {
      byCategory[manifest.category]++;
      const config = this.configs.get(manifest.id);
      if (!config || config.enabled) enabled++;
    }

    return {
      registered: this.manifests.size,
      running: this.listRunning().length,
      enabled,
      byCategory,
    };
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

/**
 * Global MCP server registry instance
 */
export const mcpRegistry = new MCPServerRegistry();
