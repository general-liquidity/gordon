/**
 * MCP Marketplace Types
 * Type definitions for the MCP plugin marketplace system
 */

import type { MCPServerManifest, MCPCategory } from '../types';

// ============================================================================
// Marketplace Listing
// ============================================================================

/**
 * Pricing model for a marketplace plugin
 */
export interface PluginPricing {
  /** Pricing type */
  type: 'free' | 'freemium' | 'paid';
  /** Description of free tier limits (for freemium) */
  freeUsage?: string;
  /** URL to pricing page (for paid/freemium) */
  pricingUrl?: string;
}

/**
 * A plugin listing in the marketplace
 */
export interface MarketplaceListing {
  /** Unique identifier for the plugin */
  id: string;
  /** The plugin's manifest defining its capabilities */
  manifest: MCPServerManifest;
  /** Repository URL (e.g., GitHub) */
  repository: string;
  /** GitHub stars count */
  stars?: number;
  /** Total download count */
  downloads?: number;
  /** Whether the plugin has been verified by the Gordon team */
  verified: boolean;
  /** Whether this is from the official provider (e.g., CoinGecko official plugin) */
  officialProvider: boolean;
  /** ISO date string of last update */
  lastUpdated: string;
  /** Pricing information */
  pricing: PluginPricing;
  /** Optional routing manifest for agent routing (auto-written as routing.json on install) */
  routingManifest?: import('../../routing/types').RoutingManifest;
}

// ============================================================================
// Marketplace Registry
// ============================================================================

/**
 * The full marketplace registry containing all available plugins
 */
export interface MarketplaceRegistry {
  /** Registry schema version */
  version: string;
  /** ISO date string of last registry update */
  lastUpdated: string;
  /** Array of all available plugins */
  plugins: MarketplaceListing[];
}

// ============================================================================
// Installed Plugin
// ============================================================================

/**
 * A plugin that has been installed locally
 */
export interface InstalledPlugin {
  /** Plugin identifier (matches MarketplaceListing.id) */
  id: string;
  /** The plugin's manifest */
  manifest: MCPServerManifest;
  /** ISO date string when the plugin was installed */
  installedAt: string;
  /** Source of installation (marketplace URL, local path, etc.) */
  installedFrom: string;
  /** Installed version */
  version: string;
  /** Whether the plugin is enabled */
  enabled: boolean;
}

// ============================================================================
// Search & Filter Types
// ============================================================================

/**
 * Search options for the marketplace
 */
export interface MarketplaceSearchOptions {
  /** Text query to search for */
  query?: string;
  /** Filter by category */
  category?: MCPCategory;
  /** Filter by pricing type */
  pricingType?: 'free' | 'freemium' | 'paid';
  /** Only show verified plugins */
  verifiedOnly?: boolean;
  /** Only show official provider plugins */
  officialOnly?: boolean;
  /** Sort field */
  sortBy?: 'name' | 'stars' | 'downloads' | 'lastUpdated';
  /** Sort direction */
  sortOrder?: 'asc' | 'desc';
  /** Maximum results to return */
  limit?: number;
}

/**
 * Result of a marketplace search
 */
export interface MarketplaceSearchResult {
  /** Matching plugins */
  plugins: MarketplaceListing[];
  /** Total count of matches (before limit) */
  total: number;
  /** Search query used */
  query?: string;
}

// ============================================================================
// Plugin Validation
// ============================================================================

/**
 * Result of plugin validation
 */
export interface PluginValidationResult {
  /** Whether the plugin is valid */
  valid: boolean;
  /** Validation errors (if any) */
  errors?: string[];
  /** Validation warnings (non-blocking) */
  warnings?: string[];
}

// ============================================================================
// Installation Status
// ============================================================================

/**
 * Status of a plugin installation operation
 */
export type InstallationStatus =
  | 'pending'
  | 'downloading'
  | 'validating'
  | 'installing'
  | 'configuring'
  | 'complete'
  | 'failed';

/**
 * Progress update during plugin installation
 */
export interface InstallationProgress {
  /** Current status */
  status: InstallationStatus;
  /** Progress percentage (0-100) */
  progress: number;
  /** Human-readable message */
  message: string;
  /** Error message (if failed) */
  error?: string;
}
