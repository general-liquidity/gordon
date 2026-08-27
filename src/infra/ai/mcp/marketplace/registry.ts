/**
 * MCP Marketplace Registry Client
 * Fetches and searches the plugin marketplace registry
 */

import * as fs from "node:fs/promises";
import type { MCPCategory } from "../types";
import type {
  MarketplaceRegistry,
  MarketplaceListing,
  MarketplaceSearchOptions,
  MarketplaceSearchResult,
} from "./types";

// ============================================================================
// Constants
// ============================================================================

/** Default URL for the marketplace registry */
const REGISTRY_URL =
  "https://raw.githubusercontent.com/general-liquidity/gordon-mcp-marketplace/master/registry.json";

/** Default cache TTL (1 hour) */
const DEFAULT_CACHE_TTL = 3600000;

// ============================================================================
// Registry Client
// ============================================================================

/**
 * Client for fetching and searching the MCP marketplace registry
 */
export class MarketplaceRegistryClient {
  /** Cached registry data */
  private cache: MarketplaceRegistry | null = null;
  /** Timestamp when cache was last updated */
  private cacheTime = 0;
  /** Cache time-to-live in milliseconds */
  private cacheTTL: number;
  /** Registry URL */
  private registryUrl: string;

  constructor(options?: { registryUrl?: string; cacheTTL?: number }) {
    this.registryUrl = options?.registryUrl ?? REGISTRY_URL;
    this.cacheTTL = options?.cacheTTL ?? DEFAULT_CACHE_TTL;
  }

  /**
   * Fetch the marketplace registry
   * Uses cache if available and not expired
   * @param forceRefresh - Force a fresh fetch, ignoring cache
   * @returns The marketplace registry
   */
  async fetchRegistry(forceRefresh = false): Promise<MarketplaceRegistry> {
    // Check cache validity
    const now = Date.now();
    if (!forceRefresh && this.cache && now - this.cacheTime < this.cacheTTL) {
      return this.cache;
    }

    try {
      const response = await fetch(this.registryUrl);

      if (!response.ok) {
        throw new Error(`Failed to fetch registry: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      // Validate basic structure
      if (!this.isValidRegistry(data)) {
        throw new Error("Invalid registry format");
      }

      this.cache = data as MarketplaceRegistry;
      this.cacheTime = now;

      return this.cache;
    } catch (error) {
      // If we have stale cache, return it rather than failing
      if (this.cache) {
        console.warn(
          "Failed to refresh registry, using stale cache:",
          error instanceof Error ? error.message : error,
        );
        return this.cache;
      }
      throw error;
    }
  }

  /**
   * Search the marketplace for plugins
   * @param query - Search query string
   * @param category - Optional category filter
   * @returns Array of matching plugins
   */
  async search(query: string, category?: MCPCategory): Promise<MarketplaceListing[]> {
    const result = await this.searchAdvanced({
      query,
      category,
    });
    return result.plugins;
  }

  /**
   * Advanced search with full options
   * @param options - Search options
   * @returns Search result with plugins and metadata
   */
  async searchAdvanced(options: MarketplaceSearchOptions): Promise<MarketplaceSearchResult> {
    const registry = await this.fetchRegistry();
    let plugins = [...registry.plugins];

    // Text search
    if (options.query) {
      const queryLower = options.query.toLowerCase();
      plugins = plugins.filter(
        (p) =>
          p.id.toLowerCase().includes(queryLower) ||
          p.manifest.name.toLowerCase().includes(queryLower) ||
          p.manifest.description.toLowerCase().includes(queryLower) ||
          p.manifest.author.toLowerCase().includes(queryLower),
      );
    }

    // Category filter
    if (options.category) {
      plugins = plugins.filter((p) => p.manifest.category === options.category);
    }

    // Pricing filter
    if (options.pricingType) {
      plugins = plugins.filter((p) => p.pricing.type === options.pricingType);
    }

    // Verified only filter
    if (options.verifiedOnly) {
      plugins = plugins.filter((p) => p.verified);
    }

    // Official only filter
    if (options.officialOnly) {
      plugins = plugins.filter((p) => p.officialProvider);
    }

    // Store total before limiting
    const total = plugins.length;

    // Sort
    const sortBy = options.sortBy ?? "name";
    const sortOrder = options.sortOrder ?? "asc";

    plugins.sort((a, b) => {
      let comparison = 0;

      switch (sortBy) {
        case "name":
          comparison = a.manifest.name.localeCompare(b.manifest.name);
          break;
        case "stars":
          comparison = (a.stars ?? 0) - (b.stars ?? 0);
          break;
        case "downloads":
          comparison = (a.downloads ?? 0) - (b.downloads ?? 0);
          break;
        case "lastUpdated":
          comparison = new Date(a.lastUpdated).getTime() - new Date(b.lastUpdated).getTime();
          break;
      }

      return sortOrder === "desc" ? -comparison : comparison;
    });

    // Apply limit
    if (options.limit && options.limit > 0) {
      plugins = plugins.slice(0, options.limit);
    }

    return {
      plugins,
      total,
      query: options.query,
    };
  }

  /**
   * Get a specific plugin by ID
   * @param pluginId - The plugin ID
   * @returns The plugin listing or null if not found
   */
  async getPlugin(pluginId: string): Promise<MarketplaceListing | null> {
    const registry = await this.fetchRegistry();
    return registry.plugins.find((p) => p.id === pluginId) ?? null;
  }

  /**
   * Get all plugins in a category
   * @param category - The category to filter by
   * @returns Array of plugins in the category
   */
  async getByCategory(category: MCPCategory): Promise<MarketplaceListing[]> {
    const registry = await this.fetchRegistry();
    return registry.plugins.filter((p) => p.manifest.category === category);
  }

  /**
   * Get featured/popular plugins
   * @param limit - Maximum number to return (default: 10)
   * @returns Array of featured plugins
   */
  async getFeatured(limit = 10): Promise<MarketplaceListing[]> {
    const result = await this.searchAdvanced({
      verifiedOnly: true,
      sortBy: "downloads",
      sortOrder: "desc",
      limit,
    });
    return result.plugins;
  }

  /**
   * Load a local registry file (for offline/testing)
   * @param path - Path to the local registry JSON file
   */
  async loadLocalRegistry(path: string): Promise<void> {
    const content = await fs.readFile(path, "utf-8");
    const data = JSON.parse(content);

    if (!this.isValidRegistry(data)) {
      throw new Error("Invalid local registry format");
    }

    this.cache = data as MarketplaceRegistry;
    this.cacheTime = Date.now();
  }

  /**
   * Clear the cache, forcing a fresh fetch on next request
   */
  clearCache(): void {
    this.cache = null;
    this.cacheTime = 0;
  }

  /**
   * Get cache status
   * @returns Object with cache information
   */
  getCacheStatus(): {
    cached: boolean;
    cacheAge: number | null;
    cacheExpired: boolean;
  } {
    if (!this.cache) {
      return { cached: false, cacheAge: null, cacheExpired: true };
    }

    const age = Date.now() - this.cacheTime;
    return {
      cached: true,
      cacheAge: age,
      cacheExpired: age >= this.cacheTTL,
    };
  }

  /**
   * Validate that data is a valid registry
   */
  private isValidRegistry(data: unknown): data is MarketplaceRegistry {
    if (!data || typeof data !== "object") return false;

    const registry = data as Record<string, unknown>;

    return (
      typeof registry.version === "string" &&
      typeof registry.lastUpdated === "string" &&
      Array.isArray(registry.plugins)
    );
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

/**
 * Global marketplace registry client instance
 */
export const marketplaceClient = new MarketplaceRegistryClient();
