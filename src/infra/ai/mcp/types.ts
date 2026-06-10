/**
 * MCP Server Types
 * Type definitions for Model Context Protocol server integration
 */

// ============================================================================
// Categories
// ============================================================================

/**
 * MCP Server categories for organization and discovery
 */
export type MCPCategory =
  | 'data-provider'    // Historical data, market data feeds
  | 'analytics'        // Technical analysis, trading signals
  | 'execution'        // Additional exchanges, DEX integrations
  | 'exchange'         // Exchange integrations (Bitget, etc.)
  | 'infrastructure'   // RPC providers, node services
  | 'portfolio'        // Portfolio tracking, tax reporting
  | 'research'         // News aggregation, social sentiment, on-chain analysis
  | 'utility';         // Alerts, notifications, general utilities

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * Definition of a tool provided by an MCP server
 */
export interface MCPToolDefinition {
  /** Unique tool name within the server */
  name: string;
  /** Human-readable description of what the tool does */
  description: string;
  /** JSON Schema for tool input parameters */
  inputSchema: Record<string, unknown>;
}

// ============================================================================
// Server Manifest
// ============================================================================

/**
 * Authentication configuration for an MCP server
 */
export interface MCPAuthConfig {
  /** Authentication type required by the server */
  type: 'api_key' | 'oauth' | 'none';
  /** Environment variable name for API key (if type is 'api_key') */
  envVar?: string;
  /** Custom credential fields (for complex auth scenarios) */
  fields?: Array<{
    name: string;
    label: string;
    sensitive: boolean;
  }>;
}

/**
 * MCP Server manifest - describes a server's capabilities and requirements
 */
export interface MCPServerManifest {
  /** Unique identifier for the server */
  id: string;
  /** Human-readable name */
  name: string;
  /** Semantic version string */
  version: string;
  /** Description of the server's purpose and capabilities */
  description: string;
  /** Author or organization name */
  author: string;
  /** Server category for organization */
  category: MCPCategory;
  /** List of tools provided by this server */
  tools: MCPToolDefinition[];

  /** Authentication requirements */
  authentication: MCPAuthConfig;

  /** Command to start the server process */
  command?: string;
  /** Command line arguments */
  args?: string[];
  /** Environment variables to pass to the server */
  env?: Record<string, string>;
}

// ============================================================================
// Server Instance
// ============================================================================

/**
 * Server instance status
 */
export type MCPServerStatus = 'stopped' | 'starting' | 'running' | 'error';

/**
 * Running instance of an MCP server
 */
export interface MCPServerInstance {
  /** The server's manifest */
  manifest: MCPServerManifest;
  /** Current status of the server */
  status: MCPServerStatus;
  /** Error message if status is 'error' */
  error?: string;
  /** Timestamp when the server was started */
  startedAt?: number;

  /**
   * Call a tool on this server
   * @param toolName - Name of the tool to call
   * @param params - Parameters to pass to the tool
   * @returns Tool execution result
   */
  callTool(toolName: string, params: unknown): Promise<unknown>;

  /**
   * Stop the server instance
   */
  stop(): Promise<void>;
}

// ============================================================================
// Server Configuration
// ============================================================================

/**
 * User configuration for an MCP server
 */
export interface MCPServerConfig {
  /** Server identifier */
  id: string;
  /** Whether the server is enabled */
  enabled: boolean;
  /** Priority for tool resolution (higher = preferred) */
  priority?: number;
  /** Stored credentials for the server */
  credentials?: Record<string, string>;
}

// ============================================================================
// Events
// ============================================================================

/**
 * Events emitted by MCP servers
 */
export type MCPServerEvent =
  | { type: 'started'; serverId: string; timestamp: number }
  | { type: 'stopped'; serverId: string; timestamp: number }
  | { type: 'error'; serverId: string; error: string; timestamp: number }
  | { type: 'tool_called'; serverId: string; toolName: string; timestamp: number };

/**
 * Event handler for MCP server events
 */
export type MCPServerEventHandler = (event: MCPServerEvent) => void;
