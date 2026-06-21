/**
 * MCP Plugin Installer
 * Manages installation, uninstallation, and updates of MCP plugins
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import type { MCPServerManifest } from '../types';
import type {
  MarketplaceListing,
  InstalledPlugin,
  PluginValidationResult,
  InstallationProgress,
} from './types';
import { marketplaceClient } from './registry';

// ============================================================================
// Constants
// ============================================================================

import { getGordonDir } from '../../../storage/paths.ts';

/** Default plugins directory */
function getDefaultPluginsDir(): string {
  return path.join(getGordonDir(), 'plugins');
}

/** Installed plugins manifest file */
const INSTALLED_MANIFEST = 'installed.json';

/**
 * Launchers a plugin manifest is permitted to spawn. An MCP server runs as a
 * child process with the daemon's privileges — an arbitrary `command` is RCE.
 * Constrain it to known package-runner / interpreter launchers.
 */
const ALLOWED_LAUNCHERS = new Set(['npx', 'npm', 'bun', 'bunx', 'node', 'python', 'python3', 'uvx']);

/** Shell metacharacters that enable command chaining / injection. */
const SHELL_METACHAR = /[;|&$`><\n\r]/;

/**
 * Plugin id pattern — the install path is built from the id, so it must be a
 * single safe path segment (no separators, no `..`). Mirrors the `manifest.id`
 * check in `validatePlugin`.
 */
const PLUGIN_ID_PATTERN = /^[a-z0-9-]+$/;

/**
 * Validate a plugin id used to build a filesystem path. Returns an error
 * string when unsafe, or `null` when safe.
 */
function validatePluginId(id: unknown): string | null {
  if (typeof id !== 'string' || !PLUGIN_ID_PATTERN.test(id)) {
    return `Plugin ID "${String(id)}" must contain only lowercase letters, numbers, and hyphens`;
  }
  return null;
}

/**
 * Validate a plugin's launch command + args before it can be spawned.
 *
 * Returns an error string when the command or any arg is unsafe, or `null`
 * when safe (or when no command is present — manifests without a command
 * never spawn a process, so there is nothing to validate).
 */
export function validatePluginCommand(command?: string, args?: string[]): string | null {
  if (command === undefined) return null;

  if (typeof command !== 'string' || command.length === 0) {
    return 'Plugin command must be a non-empty string';
  }
  if (SHELL_METACHAR.test(command)) {
    return `Plugin command contains shell metacharacters: "${command}"`;
  }

  if (!path.isAbsolute(command)) {
    const base = path.basename(command).replace(/\.(exe|cmd|bat)$/i, '');
    if (!ALLOWED_LAUNCHERS.has(base)) {
      return `Plugin command launcher "${base}" is not in the allowlist (${[...ALLOWED_LAUNCHERS].join(', ')})`;
    }
  }

  if (args !== undefined) {
    for (const arg of args) {
      if (typeof arg !== 'string') {
        return 'Plugin command args must all be strings';
      }
      if (SHELL_METACHAR.test(arg)) {
        return `Plugin command arg contains shell metacharacters: "${arg}"`;
      }
    }
  }

  return null;
}

// ============================================================================
// Plugin Installer
// ============================================================================

/**
 * Manages MCP plugin installation, updates, and removal
 */
export class PluginInstaller {
  /** Map of installed plugins by ID */
  private installedPlugins = new Map<string, InstalledPlugin>();

  /** Directory where plugins are stored */
  private pluginsDir: string;

  /** Whether the installer has been initialized */
  private initialized = false;

  /** Event listeners for installation progress */
  private progressListeners: ((progress: InstallationProgress) => void)[] = [];

  constructor(pluginsDir?: string) {
    this.pluginsDir = pluginsDir ?? getDefaultPluginsDir();
  }

  resetForTesting(pluginsDir?: string): void {
    this.pluginsDir = pluginsDir ?? getDefaultPluginsDir();
    this.installedPlugins.clear();
    this.initialized = false;
  }

  /**
   * Initialize the installer and load existing plugins
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Ensure plugins directory exists
    await fs.mkdir(this.pluginsDir, { recursive: true });

    // Load installed plugins
    await this.loadInstalled();

    this.initialized = true;
  }

  /**
   * Install a plugin from a marketplace listing
   * @param listing - The marketplace listing to install
   * @returns The installed plugin
   */
  async install(listing: MarketplaceListing): Promise<InstalledPlugin> {
    await this.initialize();

    // The install path is derived from listing.id (distinct from manifest.id) —
    // validate it before building any filesystem path.
    const idError = validatePluginId(listing.id);
    if (idError) {
      throw new Error(idError);
    }

    // Check if already installed
    if (this.installedPlugins.has(listing.id)) {
      throw new Error(`Plugin "${listing.id}" is already installed`);
    }

    this.emitProgress({
      status: 'validating',
      progress: 10,
      message: `Validating ${listing.manifest.name}...`,
    });

    // Validate the plugin manifest
    const validation = await this.validatePlugin(listing.manifest);
    if (!validation.valid) {
      this.emitProgress({
        status: 'failed',
        progress: 0,
        message: 'Validation failed',
        error: validation.errors?.join(', '),
      });
      throw new Error(
        `Plugin validation failed: ${validation.errors?.join(', ')}`
      );
    }

    this.emitProgress({
      status: 'installing',
      progress: 50,
      message: `Installing ${listing.manifest.name}...`,
    });

    // Create the installed plugin record
    const installed: InstalledPlugin = {
      id: listing.id,
      manifest: listing.manifest,
      installedAt: new Date().toISOString(),
      installedFrom: listing.repository,
      version: listing.manifest.version,
      enabled: true,
    };

    // Create plugin directory
    const pluginDir = path.join(this.pluginsDir, listing.id);
    await fs.mkdir(pluginDir, { recursive: true });

    // Write manifest to plugin directory
    await fs.writeFile(
      path.join(pluginDir, 'manifest.json'),
      JSON.stringify(listing.manifest, null, 2)
    );

    // Write routing.json if the listing includes agent routing metadata
    if (listing.routingManifest) {
      await fs.writeFile(
        path.join(pluginDir, 'routing.json'),
        JSON.stringify(listing.routingManifest, null, 2)
      );
    }

    // Add to installed map
    this.installedPlugins.set(listing.id, installed);

    // Save installed manifest
    await this.saveInstalled();

    this.emitProgress({
      status: 'complete',
      progress: 100,
      message: `Successfully installed ${listing.manifest.name}`,
    });

    return installed;
  }

  /**
   * Install a plugin from a local manifest file
   * @param manifestPath - Path to the manifest.json file
   * @returns The installed plugin
   */
  async installFromLocal(manifestPath: string): Promise<InstalledPlugin> {
    await this.initialize();

    const content = await fs.readFile(manifestPath, 'utf-8');
    const manifest = JSON.parse(content) as MCPServerManifest;

    // Validate the manifest
    const validation = await this.validatePlugin(manifest);
    if (!validation.valid) {
      throw new Error(
        `Plugin validation failed: ${validation.errors?.join(', ')}`
      );
    }

    // Check if already installed
    if (this.installedPlugins.has(manifest.id)) {
      throw new Error(`Plugin "${manifest.id}" is already installed`);
    }

    // Create the installed plugin record
    const installed: InstalledPlugin = {
      id: manifest.id,
      manifest,
      installedAt: new Date().toISOString(),
      installedFrom: manifestPath,
      version: manifest.version,
      enabled: true,
    };

    // Guard the path segment derived from manifest.id before building the path.
    const idError = validatePluginId(manifest.id);
    if (idError) {
      throw new Error(idError);
    }

    // Create plugin directory and copy manifest
    const pluginDir = path.join(this.pluginsDir, manifest.id);
    await fs.mkdir(pluginDir, { recursive: true });
    await fs.writeFile(
      path.join(pluginDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2)
    );

    // Add to installed map
    this.installedPlugins.set(manifest.id, installed);

    // Save installed manifest
    await this.saveInstalled();

    return installed;
  }

  /**
   * Uninstall a plugin
   * @param pluginId - The plugin ID to uninstall
   */
  async uninstall(pluginId: string): Promise<void> {
    await this.initialize();

    const plugin = this.installedPlugins.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin "${pluginId}" is not installed`);
    }

    // Remove plugin directory
    const pluginDir = path.join(this.pluginsDir, pluginId);
    try {
      await fs.rm(pluginDir, { recursive: true, force: true });
    } catch {
      // Directory might not exist, that's okay
    }

    // Remove from installed map
    this.installedPlugins.delete(pluginId);

    // Save updated manifest
    await this.saveInstalled();
  }

  /**
   * Update a plugin to the latest version
   * @param pluginId - The plugin ID to update
   * @returns The updated plugin
   */
  async update(pluginId: string): Promise<InstalledPlugin> {
    await this.initialize();

    // pluginId feeds path.join below — validate before any filesystem path.
    const idError = validatePluginId(pluginId);
    if (idError) {
      throw new Error(idError);
    }

    const current = this.installedPlugins.get(pluginId);
    if (!current) {
      throw new Error(`Plugin "${pluginId}" is not installed`);
    }

    // Fetch latest from marketplace
    const listing = await marketplaceClient.getPlugin(pluginId);
    if (!listing) {
      throw new Error(`Plugin "${pluginId}" not found in marketplace`);
    }

    // Check if update is needed
    if (listing.manifest.version === current.version) {
      return current; // Already up to date
    }

    // Validate new version
    const validation = await this.validatePlugin(listing.manifest);
    if (!validation.valid) {
      throw new Error(
        `Plugin update validation failed: ${validation.errors?.join(', ')}`
      );
    }

    // Update the plugin
    const updated: InstalledPlugin = {
      ...current,
      manifest: listing.manifest,
      version: listing.manifest.version,
      installedFrom: listing.repository,
    };

    // Update manifest file
    const pluginDir = path.join(this.pluginsDir, pluginId);
    await fs.writeFile(
      path.join(pluginDir, 'manifest.json'),
      JSON.stringify(listing.manifest, null, 2)
    );

    // Update installed map
    this.installedPlugins.set(pluginId, updated);

    // Save updated manifest
    await this.saveInstalled();

    return updated;
  }

  /**
   * Update all installed plugins
   * @returns Array of updated plugins
   */
  async updateAll(): Promise<InstalledPlugin[]> {
    await this.initialize();

    const updated: InstalledPlugin[] = [];
    const errors: string[] = [];

    for (const pluginId of this.installedPlugins.keys()) {
      try {
        const plugin = await this.update(pluginId);
        updated.push(plugin);
      } catch (error) {
        errors.push(
          `${pluginId}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    if (errors.length > 0) {
      console.warn('Some plugins failed to update:', errors);
    }

    return updated;
  }

  /**
   * Get all installed plugins
   * @returns Array of installed plugins
   */
  getInstalled(): InstalledPlugin[] {
    return Array.from(this.installedPlugins.values());
  }

  /**
   * Get enabled plugins only
   * @returns Array of enabled plugins
   */
  getEnabled(): InstalledPlugin[] {
    return this.getInstalled().filter((p) => p.enabled);
  }

  /**
   * Get a specific installed plugin
   * @param pluginId - The plugin ID
   * @returns The installed plugin or undefined
   */
  getPlugin(pluginId: string): InstalledPlugin | undefined {
    return this.installedPlugins.get(pluginId);
  }

  /**
   * Check if a plugin is installed
   * @param pluginId - The plugin ID to check
   * @returns True if installed
   */
  isInstalled(pluginId: string): boolean {
    return this.installedPlugins.has(pluginId);
  }

  /**
   * Enable a plugin
   * @param pluginId - The plugin ID to enable
   */
  async enable(pluginId: string): Promise<void> {
    await this.initialize();

    const plugin = this.installedPlugins.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin "${pluginId}" is not installed`);
    }

    if (plugin.enabled) {
      return; // Already enabled
    }

    plugin.enabled = true;
    await this.saveInstalled();
  }

  /**
   * Disable a plugin
   * @param pluginId - The plugin ID to disable
   */
  async disable(pluginId: string): Promise<void> {
    await this.initialize();

    const plugin = this.installedPlugins.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin "${pluginId}" is not installed`);
    }

    if (!plugin.enabled) {
      return; // Already disabled
    }

    plugin.enabled = false;
    await this.saveInstalled();
  }

  /**
   * Check for available updates
   * @returns Array of plugins with available updates
   */
  async checkUpdates(): Promise<
    Array<{ plugin: InstalledPlugin; availableVersion: string }>
  > {
    await this.initialize();

    const updates: Array<{
      plugin: InstalledPlugin;
      availableVersion: string;
    }> = [];

    for (const plugin of this.installedPlugins.values()) {
      try {
        const listing = await marketplaceClient.getPlugin(plugin.id);
        if (listing && listing.manifest.version !== plugin.version) {
          updates.push({
            plugin,
            availableVersion: listing.manifest.version,
          });
        }
      } catch {
        // Plugin might not be in marketplace, skip
      }
    }

    return updates;
  }

  /**
   * Load installed plugins from disk
   */
  async loadInstalled(): Promise<void> {
    const manifestPath = path.join(this.pluginsDir, INSTALLED_MANIFEST);

    try {
      const content = await fs.readFile(manifestPath, 'utf-8');
      const data = JSON.parse(content) as { plugins: InstalledPlugin[] };

      this.installedPlugins.clear();
      for (const plugin of data.plugins) {
        // A poisoned installed.json could carry a traversal id (the path is
        // later rebuilt from plugin.id) — skip ids that aren't a safe segment.
        if (validatePluginId(plugin.id) !== null) {
          console.warn(`Skipping installed plugin with invalid id: ${String(plugin.id)}`);
          continue;
        }
        this.installedPlugins.set(plugin.id, plugin);
      }
    } catch {
      // File doesn't exist or is invalid, start fresh
      this.installedPlugins.clear();
    }
  }

  /**
   * Save installed plugins to disk
   */
  private async saveInstalled(): Promise<void> {
    const manifestPath = path.join(this.pluginsDir, INSTALLED_MANIFEST);
    const data = {
      version: '1.0.0',
      lastUpdated: new Date().toISOString(),
      plugins: Array.from(this.installedPlugins.values()),
    };

    await fs.writeFile(manifestPath, JSON.stringify(data, null, 2));
  }

  /**
   * Validate a plugin manifest before installation
   * @param manifest - The manifest to validate
   * @returns Validation result
   */
  private async validatePlugin(
    manifest: MCPServerManifest
  ): Promise<PluginValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Required fields
    if (!manifest.id || typeof manifest.id !== 'string') {
      errors.push('Missing or invalid "id" field');
    } else if (!/^[a-z0-9-]+$/.test(manifest.id)) {
      errors.push('Plugin ID must contain only lowercase letters, numbers, and hyphens');
    }

    if (!manifest.name || typeof manifest.name !== 'string') {
      errors.push('Missing or invalid "name" field');
    }

    if (!manifest.version || typeof manifest.version !== 'string') {
      errors.push('Missing or invalid "version" field');
    } else if (!/^\d+\.\d+\.\d+/.test(manifest.version)) {
      warnings.push('Version should follow semver format (e.g., 1.0.0)');
    }

    if (!manifest.description || typeof manifest.description !== 'string') {
      errors.push('Missing or invalid "description" field');
    }

    if (!manifest.author || typeof manifest.author !== 'string') {
      errors.push('Missing or invalid "author" field');
    }

    if (!manifest.category) {
      errors.push('Missing "category" field');
    }

    // Tools validation
    if (!Array.isArray(manifest.tools)) {
      errors.push('Missing or invalid "tools" array');
    } else if (manifest.tools.length === 0) {
      warnings.push('Plugin defines no tools');
    } else {
      for (const tool of manifest.tools) {
        if (!tool.name || typeof tool.name !== 'string') {
          errors.push(`Tool missing "name" field`);
        }
        if (!tool.description || typeof tool.description !== 'string') {
          errors.push(`Tool "${tool.name}" missing "description" field`);
        }
      }
    }

    // Command validation — reject manifests that would spawn an unsafe process.
    const commandError = validatePluginCommand(manifest.command, manifest.args);
    if (commandError) {
      errors.push(commandError);
    }

    // Authentication validation
    if (!manifest.authentication) {
      errors.push('Missing "authentication" configuration');
    } else {
      const validAuthTypes = ['api_key', 'oauth', 'none'];
      if (!validAuthTypes.includes(manifest.authentication.type)) {
        errors.push(
          `Invalid authentication type: ${manifest.authentication.type}`
        );
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  /**
   * Register a progress listener
   * @param listener - Callback for progress updates
   * @returns Unsubscribe function
   */
  onProgress(
    listener: (progress: InstallationProgress) => void
  ): () => void {
    this.progressListeners.push(listener);
    return () => {
      const index = this.progressListeners.indexOf(listener);
      if (index >= 0) {
        this.progressListeners.splice(index, 1);
      }
    };
  }

  /**
   * Emit a progress update to all listeners
   */
  private emitProgress(progress: InstallationProgress): void {
    for (const listener of this.progressListeners) {
      try {
        listener(progress);
      } catch {
        // Ignore listener errors
      }
    }
  }

  /**
   * Get the plugins directory path
   */
  getPluginsDir(): string {
    return this.pluginsDir;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

/**
 * Global plugin installer instance
 */
export const pluginInstaller = new PluginInstaller();
