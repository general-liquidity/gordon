/**
 * Base Onchain Registry API Client
 * Fetches curated/featured onchain apps, mints, and experiences from Base's registry
 *
 * API: https://base.org/api/registry/
 * Docs: https://docs.base.org/base-chain/tools/onchain-registry-api
 */

import {
  REGISTRY_API_BASE,
  type RegistryEntriesResponse,
  type RegistryFeaturedResponse,
  type RegistryQueryParams,
  type RegistryEntry,
  type RegistryCategory,
  type RegistryCuration,
} from "./types.ts";

// ============================================================================
// Registry Client
// ============================================================================

/**
 * Fetch entries from the Base Onchain Registry
 *
 * @param params - Query parameters for filtering entries
 * @returns Paginated list of registry entries
 */
export async function getRegistryEntries(
  params: RegistryQueryParams = {}
): Promise<RegistryEntriesResponse> {
  const url = new URL(`${REGISTRY_API_BASE}/entries`);

  if (params.page) url.searchParams.set("page", String(params.page));
  if (params.limit) url.searchParams.set("limit", String(params.limit));
  if (params.curation) url.searchParams.set("curation", params.curation);
  if (params.category && params.category.length > 0) {
    for (const cat of params.category) {
      url.searchParams.append("category", cat);
    }
  }

  const response = await fetch(url.toString(), {
    headers: { "Accept": "application/json" },
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(`Base Registry API error: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<RegistryEntriesResponse>;
}

/**
 * Fetch the currently featured entry from the Base Onchain Registry
 *
 * @returns The currently featured registry entry
 */
export async function getRegistryFeatured(): Promise<RegistryFeaturedResponse> {
  const url = `${REGISTRY_API_BASE}/featured`;

  const response = await fetch(url, {
    headers: { "Accept": "application/json" },
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(`Base Registry API error: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<RegistryFeaturedResponse>;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format a registry entry for display
 */
export function formatRegistryEntry(entry: RegistryEntry): {
  title: string;
  description: string;
  category: string;
  curation: string;
  creator: string;
  action: string;
  cost: string;
  contract: string;
  url: string;
  featured: boolean;
  active: boolean;
} {
  const now = new Date();
  const expiration = entry.content.expiration_ts ? new Date(entry.content.expiration_ts) : null;
  const start = entry.content.start_ts ? new Date(entry.content.start_ts) : null;

  return {
    title: entry.content.title,
    description: entry.content.full_description || entry.content.short_description,
    category: entry.category,
    curation: entry.content.curation,
    creator: entry.content.creator_name,
    action: entry.content.cta_text,
    cost: entry.content.token_amount ? `${entry.content.token_amount} ETH` : "Free",
    contract: entry.content.contract_address,
    url: entry.content.target_url,
    featured: entry.content.featured,
    active: (!start || start <= now) && (!expiration || expiration > now),
  };
}

/**
 * Get trending entries (Finance category, sorted by recency)
 */
export async function getTrendingBaseEntries(
  limit: number = 10
): Promise<RegistryEntry[]> {
  const response = await getRegistryEntries({
    category: ["Finance"],
    limit,
    curation: "Featured",
  });
  return response.data;
}

/**
 * Get all active entries across categories
 */
export async function getActiveBaseEntries(
  categories?: RegistryCategory[],
  limit: number = 20
): Promise<RegistryEntry[]> {
  const response = await getRegistryEntries({
    category: categories,
    limit,
  });

  const now = new Date();
  return response.data.filter((entry) => {
    const expiration = entry.content.expiration_ts ? new Date(entry.content.expiration_ts) : null;
    return !expiration || expiration > now;
  });
}
