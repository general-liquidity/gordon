/**
 * MCP (Model Context Protocol) Server Infrastructure
 *
 * This module provides MCP server integration for Gordon CLI using @mastra/mcp.
 *
 * Architecture:
 * - Client: @mastra/mcp MCPClient for connecting to MCP servers and discovering tools
 * - Credentials: Secure storage for server authentication
 * - Marketplace: Plugin discovery, installation, and management
 * - Types: Shared type definitions
 *
 * Usage:
 * ```typescript
 * import { initMCPTools, getMCPTools, disconnectMCP } from './infra/mcp';
 *
 * // At startup
 * await initMCPTools();
 *
 * // In agent creation
 * const tools = getMCPTools(); // Mastra-native Tool objects
 *
 * // At shutdown
 * await disconnectMCP();
 * ```
 */

// ============================================================================
// Type Exports
// ============================================================================

export type {
  MCPCategory,
  MCPToolDefinition,
  MCPAuthConfig,
  MCPServerManifest,
  MCPServerStatus,
  MCPServerInstance,
  MCPServerConfig,
  MCPServerEvent,
  MCPServerEventHandler,
} from "./types";

// ============================================================================
// MCP Client (@mastra/mcp integration)
// ============================================================================

export {
  initMCPTools,
  reloadMCPTools,
  getMCPTools,
  getMCPToolsByServer,
  disconnectMCP,
  enableMCPHotReload,
  disableMCPHotReload,
  isMCPInitialized,
  getMCPStats,
} from "./client";

// ============================================================================
// Credential Management
// ============================================================================

export { MCPCredentialManager, credentialManager } from "./credentials";
