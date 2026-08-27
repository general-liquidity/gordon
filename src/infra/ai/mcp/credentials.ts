/**
 * MCP Credential Manager
 * Secure credential storage and retrieval for MCP servers
 */

import type { MCPServerManifest } from "./types";

// ============================================================================
// Credential Manager
// ============================================================================

/**
 * Manages credentials for MCP servers
 *
 * Currently stores credentials in memory. Future enhancements:
 * - System keychain integration (keytar)
 * - Encrypted file storage
 * - Hardware security module support
 */
export class MCPCredentialManager {
  /** In-memory credential storage */
  private credentials = new Map<string, Record<string, string>>();

  /**
   * Store credentials for a server
   * @param serverId - Server identifier
   * @param credentials - Key-value pairs of credential data
   */
  store(serverId: string, credentials: Record<string, string>): void {
    // Create a shallow copy to prevent external mutation
    this.credentials.set(serverId, { ...credentials });
  }

  /**
   * Retrieve credentials for a server
   * @param serverId - Server identifier
   * @returns Credentials or null if not found
   */
  retrieve(serverId: string): Record<string, string> | null {
    const creds = this.credentials.get(serverId);
    if (!creds) return null;
    // Return a copy to prevent external mutation
    return { ...creds };
  }

  /**
   * Delete credentials for a server
   * @param serverId - Server identifier
   */
  delete(serverId: string): void {
    this.credentials.delete(serverId);
  }

  /**
   * Clear all stored credentials
   */
  clearAll(): void {
    this.credentials.clear();
  }

  /**
   * Get a credential value with environment variable fallback
   * @param serverId - Server identifier
   * @param key - Credential key to retrieve
   * @param envVar - Optional environment variable name for fallback
   * @returns Credential value or null if not found
   */
  getWithFallback(serverId: string, key: string, envVar?: string): string | null {
    // First, check stored credentials
    const storedCreds = this.credentials.get(serverId);
    if (storedCreds?.[key]) {
      return storedCreds[key];
    }

    // Fallback to environment variable
    if (envVar && process.env[envVar]) {
      return process.env[envVar] as string;
    }

    return null;
  }

  /**
   * Check if all required credentials are available for a server
   * @param manifest - Server manifest with authentication requirements
   * @returns True if all required credentials are available
   */
  hasRequiredCredentials(manifest: MCPServerManifest): boolean {
    const { authentication } = manifest;

    // No authentication required
    if (authentication.type === "none") {
      return true;
    }

    // API key authentication
    if (authentication.type === "api_key") {
      if (authentication.envVar) {
        const value = this.getWithFallback(manifest.id, "apiKey", authentication.envVar);
        return value !== null && value.length > 0;
      }
      // Check stored credentials
      const creds = this.credentials.get(manifest.id);
      return !!creds?.apiKey;
    }

    // OAuth or custom field authentication
    if (authentication.fields && authentication.fields.length > 0) {
      const creds = this.credentials.get(manifest.id);
      if (!creds) return false;

      // Check all required fields
      for (const field of authentication.fields) {
        const credValue = creds[field.name];
        if (!credValue || credValue.length === 0) {
          return false;
        }
      }
      return true;
    }

    return false;
  }

  /**
   * Get missing credentials for a server
   * @param manifest - Server manifest with authentication requirements
   * @returns Array of missing credential field names
   */
  getMissingCredentials(manifest: MCPServerManifest): string[] {
    const { authentication } = manifest;
    const missing: string[] = [];

    if (authentication.type === "none") {
      return missing;
    }

    if (authentication.type === "api_key") {
      const value = this.getWithFallback(manifest.id, "apiKey", authentication.envVar);
      if (!value) {
        missing.push(authentication.envVar || "apiKey");
      }
      return missing;
    }

    if (authentication.fields) {
      const creds = this.credentials.get(manifest.id);
      for (const field of authentication.fields) {
        const credValue = creds?.[field.name];
        if (!credValue || credValue.length === 0) {
          missing.push(field.name);
        }
      }
    }

    return missing;
  }

  /**
   * List all server IDs with stored credentials
   * @returns Array of server IDs
   */
  listServers(): string[] {
    return Array.from(this.credentials.keys());
  }

  /**
   * Check if credentials exist for a server
   * @param serverId - Server identifier
   * @returns True if credentials are stored
   */
  hasCredentials(serverId: string): boolean {
    return this.credentials.has(serverId);
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

/**
 * Global credential manager instance
 */
export const credentialManager = new MCPCredentialManager();
