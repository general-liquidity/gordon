/**
 * MCP (Model Context Protocol) Server Infrastructure
 *
 * This module provides a registry system for managing MCP servers,
 * enabling Gordon CLI to integrate with external tools and services.
 *
 * Architecture:
 * - Registry: Central management of server manifests and instances
 * - Credentials: Secure storage for server authentication
 * - Server Instance: Process management for local MCP servers
 *
 * Usage:
 * ```typescript
 * import { mcpRegistry, credentialManager } from './infra/mcp';
 *
 * // Register a server
 * mcpRegistry.register({
 *   id: 'coingecko',
 *   name: 'CoinGecko MCP',
 *   version: '1.0.0',
 *   description: 'Market data from CoinGecko',
 *   author: 'Gordon Team',
 *   category: 'data-provider',
 *   tools: [{ name: 'get_price', description: '...', inputSchema: {} }],
 *   authentication: { type: 'api_key', envVar: 'COINGECKO_API_KEY' },
 *   command: 'npx',
 *   args: ['@gordon/mcp-coingecko'],
 * });
 *
 * // Store credentials
 * credentialManager.store('coingecko', { apiKey: 'your-api-key' });
 *
 * // Call a tool
 * const result = await mcpRegistry.callTool('coingecko', 'get_price', {
 *   symbol: 'BTC',
 * });
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
} from './types';

// ============================================================================
// Class and Instance Exports
// ============================================================================

export { MCPServerRegistry, mcpRegistry } from './registry';
export { MCPCredentialManager, credentialManager } from './credentials';
export { LocalMCPServerInstance, createServerInstance } from './server-instance';
