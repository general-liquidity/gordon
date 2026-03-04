/**
 * MCP Commands
 * CLI commands for managing MCP plugins and servers
 */

import {
  marketplaceClient,
  pluginInstaller,
  type MarketplaceListing,
  type InstalledPlugin,
} from '../../infra/mcp/marketplace';
import { credentialManager } from '../../infra/mcp/credentials';
import type { MCPCategory, MCPToolDefinition } from '../../infra/mcp/types';

// ============================================================================
// Showcase Data
// ============================================================================

/**
 * Curated plugin recommendations organized by use case
 */
interface ShowcaseCategory {
  title: string;
  description: string;
  plugins: Array<{
    id: string;
    summary: string;
    pricingNote?: string;
  }>;
}

const PLUGIN_SHOWCASE: ShowcaseCategory[] = [
  {
    title: 'For Better Data',
    description: 'Enhanced market data and historical prices',
    plugins: [
      { id: 'coingecko', summary: 'Historical prices, 50+ alt coins', pricingNote: 'freemium' },
      { id: 'glassnode', summary: 'On-chain analytics', pricingNote: 'paid' },
    ],
  },
  {
    title: 'For Alerts',
    description: 'Stay notified about important market events',
    plugins: [
      { id: 'telegram-alerts', summary: 'Position notifications' },
      { id: 'tradingview-signals', summary: 'Webhook integration' },
    ],
  },
  {
    title: 'For DeFi',
    description: 'Decentralized finance analytics and data',
    plugins: [
      { id: 'defi-llama', summary: 'TVL analytics' },
      { id: 'dexscreener', summary: 'DEX trading data' },
    ],
  },
  {
    title: 'For Solana',
    description: 'Trade, swap, and manage assets on Solana',
    plugins: [
      { id: 'solana-agent-kit', summary: 'Jupiter swaps, transfers, NFTs, token deploy' },
    ],
  },
  {
    title: 'For Sentiment',
    description: 'Social metrics and market sentiment',
    plugins: [
      { id: 'lunarcrush', summary: 'Social metrics', pricingNote: 'freemium' },
    ],
  },
  {
    title: 'For Portfolio',
    description: 'Track and analyze your holdings',
    plugins: [
      { id: 'portfolio-tracker', summary: 'PnL tracking, tax reports' },
    ],
  },
];

/**
 * Plugin suggestions based on user queries/features
 */
interface PluginSuggestion {
  keywords: string[];
  pluginId: string;
  reason: string;
}

const PLUGIN_SUGGESTIONS: PluginSuggestion[] = [
  { keywords: ['on-chain', 'onchain', 'nupl', 'sopr', 'whale', 'flow'], pluginId: 'glassnode', reason: 'provides on-chain analytics and whale tracking' },
  { keywords: ['social', 'sentiment', 'twitter', 'influencer'], pluginId: 'lunarcrush', reason: 'tracks social media sentiment and influencer activity' },
  { keywords: ['defi', 'tvl', 'yield', 'farming', 'protocol'], pluginId: 'defi-llama', reason: 'provides DeFi protocol analytics and TVL data' },
  { keywords: ['dex', 'uniswap', 'pancakeswap', 'liquidity', 'new pair'], pluginId: 'dexscreener', reason: 'tracks DEX trading data and new pairs' },
  { keywords: ['alert', 'notification', 'telegram', 'notify'], pluginId: 'telegram-alerts', reason: 'sends alerts to Telegram' },
  { keywords: ['tradingview', 'signal', 'webhook'], pluginId: 'tradingview-signals', reason: 'integrates TradingView alerts' },
  { keywords: ['historical', 'history', 'ohlc', 'altcoin', 'market cap'], pluginId: 'coingecko', reason: 'provides historical price data for thousands of coins' },
  { keywords: ['portfolio', 'pnl', 'profit', 'loss', 'tax'], pluginId: 'portfolio-tracker', reason: 'tracks portfolio and generates tax reports' },
  { keywords: ['solana', 'sol', 'jupiter', 'raydium', 'spl', 'phantom'], pluginId: 'solana-agent-kit', reason: 'provides Solana trading, swaps, transfers, and NFT minting via Jupiter' },
];

// ============================================================================
// Types
// ============================================================================

/**
 * Result of an MCP command execution
 */
export interface MCPCommandResult {
  /** Whether the command succeeded */
  success: boolean;
  /** Human-readable message */
  message: string;
  /** Additional data (command-specific) */
  data?: unknown;
}

// ============================================================================
// Command Implementations
// ============================================================================

/**
 * List all installed MCP plugins
 * Usage: /mcp list
 */
export async function mcpList(): Promise<MCPCommandResult> {
  try {
    await pluginInstaller.initialize();
    const installed = pluginInstaller.getInstalled();

    if (installed.length === 0) {
      return {
        success: true,
        message: 'No plugins installed. Use "/mcp search" to find plugins.',
        data: { plugins: [] },
      };
    }

    const pluginList = installed.map((p) => ({
      id: p.id,
      name: p.manifest.name,
      version: p.version,
      enabled: p.enabled,
      category: p.manifest.category,
      tools: p.manifest.tools.length,
    }));

    const enabledCount = installed.filter((p) => p.enabled).length;

    return {
      success: true,
      message: `${installed.length} plugin(s) installed (${enabledCount} enabled)`,
      data: { plugins: pluginList },
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to list plugins: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Convert stars count to star rating display
 */
function getStarRating(stars?: number): string {
  if (!stars) return '';
  // Normalize: 500+ stars = 5 stars, scale linearly below
  const rating = Math.min(5, Math.round((stars / 100) * 1));
  const filled = Math.max(1, Math.min(5, rating));
  return '\u2605'.repeat(filled) + '\u2606'.repeat(5 - filled);
}

/**
 * Format pricing for display
 */
function formatPricing(pricing: { type: string; freeUsage?: string }): string {
  switch (pricing.type) {
    case 'free':
      return 'Free';
    case 'freemium':
      return pricing.freeUsage ? `Freemium (${pricing.freeUsage})` : 'Freemium';
    case 'paid':
      return 'Paid';
    default:
      return pricing.type;
  }
}

/**
 * Search the marketplace for plugins
 * Usage: /mcp search <query>
 */
export async function mcpSearch(query: string): Promise<MCPCommandResult> {
  try {
    // Parse category filter if provided (e.g., "coingecko category:data-provider")
    let category: MCPCategory | undefined;
    let searchQuery = query;

    const categoryMatch = query.match(/category:(\S+)/);
    if (categoryMatch) {
      category = categoryMatch[1] as MCPCategory;
      searchQuery = query.replace(/category:\S+/, '').trim();
    }

    const results = await marketplaceClient.searchAdvanced({
      query: searchQuery || undefined,
      category,
      sortBy: 'downloads',
      sortOrder: 'desc',
      limit: 20,
    });

    if (results.plugins.length === 0) {
      return {
        success: true,
        message: query
          ? `No plugins found matching "${query}"`
          : 'No plugins available',
        data: { plugins: [], total: 0 },
      };
    }

    const pluginList = results.plugins.map((p) => ({
      id: p.id,
      name: p.manifest.name,
      description: p.manifest.description,
      shortDescription: p.manifest.description.substring(0, 60) + (p.manifest.description.length > 60 ? '...' : ''),
      category: p.manifest.category,
      verified: p.verified,
      official: p.officialProvider,
      pricing: p.pricing.type,
      pricingFormatted: formatPricing(p.pricing),
      stars: p.stars,
      starRating: getStarRating(p.stars),
      downloads: p.downloads,
      downloadsFormatted: p.downloads ? `${(p.downloads / 1000).toFixed(1)}k` : undefined,
      installed: pluginInstaller.isInstalled(p.id),
      toolCount: p.manifest.tools.length,
    }));

    // Build enhanced message output
    const lines = [`Found ${results.total} plugin(s)${query ? ` matching "${query}"` : ''}:\n`];

    for (const plugin of pluginList) {
      const status = plugin.installed ? '[installed]' : '';
      const verified = plugin.verified ? '\u2713' : '';
      lines.push(`${plugin.id} (${plugin.category}) ${plugin.starRating} ${status}`);
      lines.push(`  ${plugin.shortDescription}`);
      lines.push(`  Pricing: ${plugin.pricingFormatted} | Verified: ${verified || '-'} | Tools: ${plugin.toolCount}`);
      lines.push('');
    }

    return {
      success: true,
      message: lines.join('\n'),
      data: { plugins: pluginList, total: results.total },
    };
  } catch (error) {
    return {
      success: false,
      message: `Search failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Install a plugin from the marketplace
 * Usage: /mcp install <pluginId>
 */
export async function mcpInstall(pluginId: string): Promise<MCPCommandResult> {
  try {
    // Check if already installed
    if (pluginInstaller.isInstalled(pluginId)) {
      return {
        success: false,
        message: `Plugin "${pluginId}" is already installed`,
      };
    }

    // Fetch plugin from marketplace
    const listing = await marketplaceClient.getPlugin(pluginId);
    if (!listing) {
      return {
        success: false,
        message: `Plugin "${pluginId}" not found in marketplace`,
      };
    }

    // Install the plugin
    const installed = await pluginInstaller.install(listing);

    // Check if credentials are needed
    const needsCredentials =
      listing.manifest.authentication.type !== 'none' &&
      !credentialManager.hasRequiredCredentials(listing.manifest);

    let message = `Successfully installed "${listing.manifest.name}" v${installed.version}`;
    if (needsCredentials) {
      message += `. Note: This plugin requires credentials. Use "/mcp configure ${pluginId}" to set them up.`;
    }

    return {
      success: true,
      message,
      data: {
        plugin: {
          id: installed.id,
          name: installed.manifest.name,
          version: installed.version,
          enabled: installed.enabled,
          needsCredentials,
        },
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `Installation failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Uninstall a plugin
 * Usage: /mcp uninstall <pluginId>
 */
export async function mcpUninstall(pluginId: string): Promise<MCPCommandResult> {
  try {
    const plugin = pluginInstaller.getPlugin(pluginId);
    if (!plugin) {
      return {
        success: false,
        message: `Plugin "${pluginId}" is not installed`,
      };
    }

    const pluginName = plugin.manifest.name;
    await pluginInstaller.uninstall(pluginId);

    // Also remove any stored credentials
    credentialManager.delete(pluginId);

    return {
      success: true,
      message: `Successfully uninstalled "${pluginName}"`,
    };
  } catch (error) {
    return {
      success: false,
      message: `Uninstall failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Configure credentials for a plugin
 * Usage: /mcp configure <pluginId>
 *
 * Note: In a real implementation, this would prompt for credentials interactively.
 * For now, it returns information about what credentials are needed.
 */
export async function mcpConfigure(pluginId: string): Promise<MCPCommandResult> {
  try {
    const plugin = pluginInstaller.getPlugin(pluginId);
    if (!plugin) {
      return {
        success: false,
        message: `Plugin "${pluginId}" is not installed`,
      };
    }

    const { authentication } = plugin.manifest;

    if (authentication.type === 'none') {
      return {
        success: true,
        message: `Plugin "${plugin.manifest.name}" does not require any credentials`,
      };
    }

    const missing = credentialManager.getMissingCredentials(plugin.manifest);

    if (missing.length === 0) {
      return {
        success: true,
        message: `Plugin "${plugin.manifest.name}" is fully configured`,
        data: { configured: true },
      };
    }

    // Build configuration instructions
    let instructions: string;

    if (authentication.type === 'api_key' && authentication.envVar) {
      instructions = `Set the ${authentication.envVar} environment variable, or store credentials using the credential manager.`;
    } else if (authentication.fields) {
      const fieldList = authentication.fields
        .map((f) => `- ${f.label} (${f.name})${f.sensitive ? ' [sensitive]' : ''}`)
        .join('\n');
      instructions = `Required credentials:\n${fieldList}`;
    } else {
      instructions = `Missing credentials: ${missing.join(', ')}`;
    }

    return {
      success: true,
      message: `Plugin "${plugin.manifest.name}" needs configuration:\n${instructions}`,
      data: {
        configured: false,
        missing,
        authType: authentication.type,
        envVar: authentication.envVar,
        fields: authentication.fields,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `Configuration check failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Enable a plugin
 * Usage: /mcp enable <pluginId>
 */
export async function mcpEnable(pluginId: string): Promise<MCPCommandResult> {
  try {
    const plugin = pluginInstaller.getPlugin(pluginId);
    if (!plugin) {
      return {
        success: false,
        message: `Plugin "${pluginId}" is not installed`,
      };
    }

    if (plugin.enabled) {
      return {
        success: true,
        message: `Plugin "${plugin.manifest.name}" is already enabled`,
      };
    }

    await pluginInstaller.enable(pluginId);

    return {
      success: true,
      message: `Plugin "${plugin.manifest.name}" has been enabled`,
    };
  } catch (error) {
    return {
      success: false,
      message: `Enable failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Disable a plugin
 * Usage: /mcp disable <pluginId>
 */
export async function mcpDisable(pluginId: string): Promise<MCPCommandResult> {
  try {
    const plugin = pluginInstaller.getPlugin(pluginId);
    if (!plugin) {
      return {
        success: false,
        message: `Plugin "${pluginId}" is not installed`,
      };
    }

    if (!plugin.enabled) {
      return {
        success: true,
        message: `Plugin "${plugin.manifest.name}" is already disabled`,
      };
    }

    await pluginInstaller.disable(pluginId);

    return {
      success: true,
      message: `Plugin "${plugin.manifest.name}" has been disabled`,
    };
  } catch (error) {
    return {
      success: false,
      message: `Disable failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Update all installed plugins
 * Usage: /mcp update
 */
export async function mcpUpdate(): Promise<MCPCommandResult> {
  try {
    await pluginInstaller.initialize();
    const installed = pluginInstaller.getInstalled();

    if (installed.length === 0) {
      return {
        success: true,
        message: 'No plugins installed to update',
      };
    }

    // Check for updates
    const updates = await pluginInstaller.checkUpdates();

    if (updates.length === 0) {
      return {
        success: true,
        message: 'All plugins are up to date',
        data: { updated: [], checked: installed.length },
      };
    }

    // Perform updates
    const results: Array<{
      id: string;
      name: string;
      oldVersion: string;
      newVersion: string;
      success: boolean;
      error?: string;
    }> = [];

    for (const { plugin, availableVersion } of updates) {
      try {
        const updated = await pluginInstaller.update(plugin.id);
        results.push({
          id: plugin.id,
          name: plugin.manifest.name,
          oldVersion: plugin.version,
          newVersion: updated.version,
          success: true,
        });
      } catch (error) {
        results.push({
          id: plugin.id,
          name: plugin.manifest.name,
          oldVersion: plugin.version,
          newVersion: availableVersion,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    let message = `Updated ${successCount} plugin(s)`;
    if (failCount > 0) {
      message += `, ${failCount} failed`;
    }

    return {
      success: failCount === 0,
      message,
      data: { results },
    };
  } catch (error) {
    return {
      success: false,
      message: `Update failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Format tool signature for display
 */
function formatToolSignature(tool: MCPToolDefinition): string {
  const schema = tool.inputSchema as { properties?: Record<string, { type?: string }>; required?: string[] };
  const properties = schema.properties || {};
  const required = schema.required || [];

  const params = Object.entries(properties).map(([name, prop]) => {
    const isRequired = required.includes(name);
    const type = prop.type || 'any';
    return isRequired ? `${name}: ${type}` : `${name}?: ${type}`;
  });

  return `${tool.name}(${params.join(', ')})`;
}

/**
 * Get related commands that work with a plugin
 */
function getIntegrationCommands(category: MCPCategory): string[] {
  const integrations: Record<MCPCategory, string[]> = {
    'data-provider': ['/scan', '/analyze', '/compare', '/history'],
    'analytics': ['/scan', '/analyze', '/signals'],
    'execution': ['/trade', '/order', '/position'],
    'exchange': ['/trade', '/order', '/balance'],
    'infrastructure': ['/scan', '/analyze'],
    'portfolio': ['/portfolio', '/pnl', '/balance'],
    'research': ['/analyze', '/research', '/sentiment'],
    'utility': ['/alert', '/notify'],
  };
  return integrations[category] || [];
}

/**
 * Get detailed information about a plugin
 * Usage: /mcp info <pluginId>
 */
export async function mcpInfo(pluginId: string): Promise<MCPCommandResult> {
  try {
    // Check installed first
    const installed = pluginInstaller.getPlugin(pluginId);
    const listing = await marketplaceClient.getPlugin(pluginId);

    if (!installed && !listing) {
      return {
        success: false,
        message: `Plugin "${pluginId}" not found`,
      };
    }

    const manifest = installed?.manifest ?? listing!.manifest;
    const pricing = listing?.pricing;
    const auth = manifest.authentication;

    // Build comprehensive info object
    const info = {
      id: manifest.id,
      name: manifest.name,
      version: installed?.version ?? manifest.version,
      description: manifest.description,
      author: manifest.author,
      category: manifest.category,
      tools: manifest.tools.map((t) => ({
        name: t.name,
        description: t.description,
        signature: formatToolSignature(t),
      })),
      authentication: manifest.authentication.type,
      installed: !!installed,
      enabled: installed?.enabled ?? false,
      installedAt: installed?.installedAt,
      installedFrom: installed?.installedFrom,
      marketplace: listing
        ? {
            repository: listing.repository,
            verified: listing.verified,
            official: listing.officialProvider,
            pricing: listing.pricing,
            stars: listing.stars,
            downloads: listing.downloads,
            lastUpdated: listing.lastUpdated,
          }
        : null,
    };

    // Build formatted output
    const lines: string[] = [];

    // Header
    const verifiedMark = listing?.verified ? '\u2713' : '';
    lines.push(`Plugin: ${manifest.name}`);
    lines.push(`Version: ${info.version} | Category: ${manifest.category} | Verified: ${verifiedMark || '-'}`);
    lines.push('');

    // What it does
    lines.push('What it does:');
    // Split description into bullet points if it contains sentences
    const descParts = manifest.description.split(/[.!]\s+/).filter(Boolean);
    for (const part of descParts) {
      lines.push(`  \u2022 ${part.trim()}`);
    }
    lines.push('');

    // Tools added
    lines.push('Tools added:');
    for (const tool of manifest.tools) {
      lines.push(`  - ${formatToolSignature(tool)}`);
      lines.push(`      ${tool.description}`);
    }
    lines.push('');

    // Requirements
    lines.push('Requirements:');
    if (auth.type === 'none') {
      lines.push('  \u2022 No authentication required');
    } else if (auth.type === 'api_key') {
      const envNote = auth.envVar ? ` (set ${auth.envVar})` : '';
      const urlNote = pricing?.pricingUrl ? ` - Get at ${pricing.pricingUrl}` : '';
      lines.push(`  \u2022 API Key: Required${envNote}${urlNote}`);
    } else if (auth.type === 'oauth') {
      lines.push('  \u2022 OAuth: Authorization required');
    }
    if (auth.fields && auth.fields.length > 0) {
      for (const field of auth.fields) {
        const sensitive = field.sensitive ? ' [sensitive]' : '';
        lines.push(`    - ${field.label}${sensitive}`);
      }
    }
    lines.push('');

    // Integration
    const integrations = getIntegrationCommands(manifest.category);
    if (integrations.length > 0) {
      lines.push('Integration:');
      lines.push(`  \u2022 Works with: ${integrations.join(', ')}`);
      if (auth.type === 'none') {
        lines.push('  \u2022 Auto-enabled after installation');
      } else {
        lines.push('  \u2022 Auto-enabled after configuration');
      }
      lines.push('');
    }

    // Pricing
    if (pricing) {
      lines.push(`Pricing: ${formatPricing(pricing)}`);
      if (pricing.pricingUrl) {
        lines.push(`  See: ${pricing.pricingUrl}`);
      }
      lines.push('');
    }

    // Stats
    if (listing) {
      const stats: string[] = [];
      if (listing.stars) stats.push(`${listing.stars} stars`);
      if (listing.downloads) stats.push(`${(listing.downloads / 1000).toFixed(1)}k downloads`);
      if (stats.length > 0) {
        lines.push(`Stats: ${stats.join(' | ')}`);
      }
      if (listing.repository) {
        lines.push(`Repository: ${listing.repository}`);
      }
    }

    // Installation status
    if (installed) {
      lines.push('');
      lines.push(`Status: Installed ${installed.enabled ? '(enabled)' : '(disabled)'}`);
      if (installed.installedAt) {
        lines.push(`Installed: ${new Date(installed.installedAt).toLocaleDateString()}`);
      }
    }

    return {
      success: true,
      message: lines.join('\n'),
      data: info,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to get plugin info: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Show curated plugin recommendations by use case
 * Usage: /mcp showcase
 */
export async function mcpShowcase(): Promise<MCPCommandResult> {
  try {
    const lines: string[] = [];
    lines.push('=== Recommended Plugins by Use Case ===');
    lines.push('');

    for (const category of PLUGIN_SHOWCASE) {
      lines.push(`${category.title}:`);

      for (const plugin of category.plugins) {
        const pricingNote = plugin.pricingNote ? ` (${plugin.pricingNote})` : '';
        const isInstalled = pluginInstaller.isInstalled(plugin.id);
        const installedMark = isInstalled ? ' [installed]' : '';
        lines.push(`  \u2022 ${plugin.id} - ${plugin.summary}${pricingNote}${installedMark}`);
      }

      lines.push('');
    }

    lines.push('Tip: Use "/mcp info <plugin>" for details or "/mcp install <plugin>" to add.');

    // Gather data for response
    const showcaseData = PLUGIN_SHOWCASE.map((cat) => ({
      title: cat.title,
      description: cat.description,
      plugins: cat.plugins.map((p) => ({
        ...p,
        installed: pluginInstaller.isInstalled(p.id),
      })),
    }));

    return {
      success: true,
      message: lines.join('\n'),
      data: { categories: showcaseData },
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to load showcase: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Get plugin suggestions based on user query or feature request
 * Usage: /mcp suggest <query>
 * Can also be called programmatically to suggest plugins based on user messages
 */
export async function mcpSuggest(query: string): Promise<MCPCommandResult> {
  try {
    const queryLower = query.toLowerCase();
    const matches: Array<{
      pluginId: string;
      reason: string;
      matchedKeywords: string[];
      installed: boolean;
    }> = [];

    // Find matching suggestions
    for (const suggestion of PLUGIN_SUGGESTIONS) {
      const matchedKeywords = suggestion.keywords.filter((kw) =>
        queryLower.includes(kw.toLowerCase())
      );

      if (matchedKeywords.length > 0) {
        matches.push({
          pluginId: suggestion.pluginId,
          reason: suggestion.reason,
          matchedKeywords,
          installed: pluginInstaller.isInstalled(suggestion.pluginId),
        });
      }
    }

    if (matches.length === 0) {
      return {
        success: true,
        message: `No plugin suggestions for "${query}". Try "/mcp showcase" to browse available plugins.`,
        data: { suggestions: [] },
      };
    }

    // Sort by number of matched keywords (most relevant first)
    matches.sort((a, b) => b.matchedKeywords.length - a.matchedKeywords.length);

    // Build output
    const lines: string[] = [];
    lines.push(`Plugin suggestions for "${query}":`);
    lines.push('');

    for (const match of matches) {
      const status = match.installed ? '[installed]' : '';

      // Fetch additional info from marketplace
      const listing = await marketplaceClient.getPlugin(match.pluginId);
      const name = listing?.manifest.name || match.pluginId;
      const pricing = listing ? formatPricing(listing.pricing) : '';

      lines.push(`\u2022 ${name} (${match.pluginId}) ${status}`);
      lines.push(`  ${match.reason}`);
      if (pricing && !match.installed) {
        lines.push(`  Pricing: ${pricing}`);
      }
      if (!match.installed) {
        lines.push(`  Install: /mcp install ${match.pluginId}`);
      }
      lines.push('');
    }

    return {
      success: true,
      message: lines.join('\n'),
      data: { suggestions: matches },
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to get suggestions: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Check if a user message might benefit from plugin suggestions
 * Returns suggested plugins if relevant, null otherwise
 * This can be called from the main chat handler to proactively suggest plugins
 */
export function checkForPluginSuggestions(userMessage: string): PluginSuggestion[] {
  const messageLower = userMessage.toLowerCase();
  const matches: PluginSuggestion[] = [];

  for (const suggestion of PLUGIN_SUGGESTIONS) {
    // Only suggest if user doesn't already have the plugin
    if (pluginInstaller.isInstalled(suggestion.pluginId)) {
      continue;
    }

    const hasMatch = suggestion.keywords.some((kw) =>
      messageLower.includes(kw.toLowerCase())
    );

    if (hasMatch) {
      matches.push(suggestion);
    }
  }

  return matches;
}

/**
 * Format plugin suggestions as a user-friendly message
 * Call this when you want to include suggestions in a response
 */
export function formatPluginSuggestionsMessage(suggestions: PluginSuggestion[]): string {
  if (suggestions.length === 0) return '';

  const lines = ['\n---', 'Tip: Plugins available for this feature:'];

  for (const suggestion of suggestions.slice(0, 3)) {
    lines.push(`  \u2022 ${suggestion.pluginId} - ${suggestion.reason}`);
  }

  if (suggestions.length > 0) {
    lines.push(`Use "/mcp suggest <topic>" for more or "/mcp showcase" to browse all.`);
  }

  return lines.join('\n');
}

// ============================================================================
// Command Router
// ============================================================================

/**
 * Handle MCP command routing
 * @param args - Command arguments (e.g., ["list"], ["install", "coingecko"])
 */
export async function handleMCPCommand(args: string[]): Promise<MCPCommandResult> {
  const subcommand = args[0]?.toLowerCase() ?? 'list';
  const subArgs = args.slice(1);

  switch (subcommand) {
    case 'list':
    case 'ls':
      return mcpList();

    case 'search':
    case 'find':
      if (subArgs.length === 0) {
        // Show all plugins if no query
        return mcpSearch('');
      }
      return mcpSearch(subArgs.join(' '));

    case 'install':
    case 'add':
      if (subArgs.length === 0 || !subArgs[0]) {
        return {
          success: false,
          message: 'Usage: /mcp install <pluginId>',
        };
      }
      return mcpInstall(subArgs[0]);

    case 'uninstall':
    case 'remove':
    case 'rm':
      if (subArgs.length === 0 || !subArgs[0]) {
        return {
          success: false,
          message: 'Usage: /mcp uninstall <pluginId>',
        };
      }
      return mcpUninstall(subArgs[0]);

    case 'configure':
    case 'config':
      if (subArgs.length === 0 || !subArgs[0]) {
        return {
          success: false,
          message: 'Usage: /mcp configure <pluginId>',
        };
      }
      return mcpConfigure(subArgs[0]);

    case 'enable':
      if (subArgs.length === 0 || !subArgs[0]) {
        return {
          success: false,
          message: 'Usage: /mcp enable <pluginId>',
        };
      }
      return mcpEnable(subArgs[0]);

    case 'disable':
      if (subArgs.length === 0 || !subArgs[0]) {
        return {
          success: false,
          message: 'Usage: /mcp disable <pluginId>',
        };
      }
      return mcpDisable(subArgs[0]);

    case 'update':
    case 'upgrade':
      return mcpUpdate();

    case 'info':
    case 'show':
      if (subArgs.length === 0 || !subArgs[0]) {
        return {
          success: false,
          message: 'Usage: /mcp info <pluginId>',
        };
      }
      return mcpInfo(subArgs[0]);

    case 'showcase':
    case 'recommended':
    case 'featured':
      return mcpShowcase();

    case 'suggest':
    case 'recommend':
      if (subArgs.length === 0) {
        return {
          success: false,
          message: 'Usage: /mcp suggest <query>\nExample: /mcp suggest on-chain data',
        };
      }
      return mcpSuggest(subArgs.join(' '));

    case 'help':
      return {
        success: true,
        message: `MCP Plugin Manager Commands:
  /mcp list                  - List installed plugins
  /mcp search <query>        - Search marketplace
  /mcp install <id>          - Install a plugin
  /mcp uninstall <id>        - Remove a plugin
  /mcp configure <id>        - Configure credentials
  /mcp enable <id>           - Enable a plugin
  /mcp disable <id>          - Disable a plugin
  /mcp update                - Update all plugins
  /mcp info <id>             - Show plugin details
  /mcp showcase              - Browse recommended plugins by use case
  /mcp suggest <query>       - Get plugin suggestions for a feature

Search tips:
  /mcp search price          - Search by keyword
  /mcp search category:data-provider  - Filter by category

Categories: data-provider, analytics, execution, portfolio, research, utility`,
      };

    default:
      return {
        success: false,
        message: `Unknown subcommand: ${subcommand}. Use "/mcp help" for available commands.`,
      };
  }
}
