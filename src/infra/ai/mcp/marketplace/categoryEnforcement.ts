/**
 * MCP Marketplace Category Enforcement
 *
 * Gordon's marketplace is trading-only. Non-financial MCPs are rejected
 * at install time. Users who really want Slack/email/weather can manually
 * configure them in .gordon/mcp.json, but the marketplace won't surface them.
 */

// ============================================================================
// Allowed Categories (trading/financial only)
// ============================================================================

export const ALLOWED_CATEGORIES = new Set([
  "data-provider",     // Market data, on-chain data, financial data
  "execution",         // Trading, order management, bridges
  "research",          // Analytics, smart money, research platforms
  "infrastructure",    // Blockchain nodes, custody, dev platforms
  "analytics",         // AI predictions, quantitative analysis
  "exchange",          // Exchange integrations
]);

export const BLOCKED_CATEGORIES = new Set([
  "communication",     // Slack, email, Discord
  "productivity",      // Notion, Linear, Jira
  "weather",           // Weather APIs
  "social",            // Social media (except financial sentiment)
  "entertainment",     // Games, media
  "general",           // Generic tools
  "developer-tools",   // Code-specific tools (IDE, git, etc.)
]);

// ============================================================================
// Enforcement
// ============================================================================

export interface CategoryCheckResult {
  allowed: boolean;
  category: string;
  reason?: string;
}

/**
 * Check if an MCP plugin's category is allowed in Gordon's marketplace.
 */
export function checkPluginCategory(category: string): CategoryCheckResult {
  if (ALLOWED_CATEGORIES.has(category)) {
    return { allowed: true, category };
  }

  if (BLOCKED_CATEGORIES.has(category)) {
    return {
      allowed: false,
      category,
      reason: `Category "${category}" is not allowed in Gordon's trading marketplace. ` +
        `Gordon only supports financial/trading MCP servers. ` +
        `To use this server anyway, add it manually to .gordon/mcp.json.`,
    };
  }

  // Unknown category — reject by default (allowlist, not blocklist)
  return {
    allowed: false,
    category,
    reason: `Unknown category "${category}". Allowed categories: ${[...ALLOWED_CATEGORIES].join(", ")}. ` +
      `To use a non-marketplace MCP server, add it manually to .gordon/mcp.json.`,
  };
}

/**
 * Filter a list of plugins to only include allowed categories.
 */
export function filterAllowedPlugins<T extends { category?: string }>(plugins: T[]): T[] {
  return plugins.filter((p) => p.category && ALLOWED_CATEGORIES.has(p.category));
}

/**
 * Validate a plugin manifest before installation.
 */
export function validatePluginForInstall(manifest: {
  id: string;
  name?: string;
  category?: string;
}): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!manifest.id) {
    errors.push("Plugin must have an id.");
  }

  if (!manifest.category) {
    errors.push("Plugin must have a category.");
  } else {
    const check = checkPluginCategory(manifest.category);
    if (!check.allowed) {
      errors.push(check.reason!);
    }
  }

  return { valid: errors.length === 0, errors };
}
