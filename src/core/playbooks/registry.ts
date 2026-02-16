/**
 * Playbook Registry
 *
 * Central registry for all loaded playbooks. Provides registration,
 * lookup, filtering, search, and formatted listing capabilities.
 *
 * Usage:
 *   import { playbookRegistry } from "./registry.ts";
 *
 *   playbookRegistry.register(playbook);
 *   const pb = playbookRegistry.get("momentum-breakout");
 *   const tier2 = playbookRegistry.getByTier(2);
 */

import { createModuleLogger } from "../../infra/logger/logger.ts";
import type {
  Playbook,
  FormattedPlaybook,
  FormattedPlaybookList,
} from "./types.ts";

const log = createModuleLogger("playbook-registry");

// ============================================================================
// PlaybookRegistry Class
// ============================================================================

/**
 * Registry for managing playbooks.
 * Singleton pattern -- use the exported `playbookRegistry` instance.
 */
export class PlaybookRegistry {
  private playbooks = new Map<string, Playbook>();

  // ---------- Registration ----------

  /**
   * Register a playbook in the registry.
   * Throws if a playbook with the same ID is already registered.
   *
   * @param playbook - Playbook to register
   */
  register(playbook: Playbook): void {
    if (this.playbooks.has(playbook.id)) {
      throw new Error(
        `Playbook "${playbook.id}" is already registered. Use replace() to update.`
      );
    }
    this.playbooks.set(playbook.id, playbook);
    log.debug(`Registered playbook: ${playbook.id}`);
  }

  /**
   * Replace an existing playbook or register a new one.
   *
   * @param playbook - Playbook to register or replace
   */
  replace(playbook: Playbook): void {
    this.playbooks.set(playbook.id, playbook);
  }

  // ---------- Lookup ----------

  /**
   * Get a playbook by its ID.
   *
   * @param id - Playbook ID (kebab-case)
   * @returns Playbook or undefined
   */
  get(id: string): Playbook | undefined {
    return this.playbooks.get(id);
  }

  /**
   * Get a playbook by ID, throwing if not found.
   *
   * @param id - Playbook ID
   * @returns Playbook
   * @throws Error if not found
   */
  getOrThrow(id: string): Playbook {
    const pb = this.playbooks.get(id);
    if (!pb) {
      throw new Error(
        `Playbook "${id}" not found. Available: ${this.getIds().join(", ")}`
      );
    }
    return pb;
  }

  /**
   * Check if a playbook is registered.
   */
  has(id: string): boolean {
    return this.playbooks.has(id);
  }

  // ---------- Listing ----------

  /**
   * Get all registered playbooks.
   */
  getAll(): Playbook[] {
    return Array.from(this.playbooks.values());
  }

  /**
   * Get all playbook IDs.
   */
  getIds(): string[] {
    return Array.from(this.playbooks.keys());
  }

  // ---------- Filtering ----------

  /**
   * Get playbooks by skill tier.
   */
  getByTier(tier: 1 | 2 | 3): Playbook[] {
    return this.getAll().filter((pb) => pb.tier === tier);
  }

  /**
   * Get playbooks by risk level.
   */
  getByRiskLevel(level: "low" | "medium" | "high"): Playbook[] {
    return this.getAll().filter((pb) => pb.riskLevel === level);
  }

  /**
   * Get playbooks targeting a specific market.
   */
  getByMarket(market: string): Playbook[] {
    const lower = market.toLowerCase();
    return this.getAll().filter((pb) =>
      pb.markets.some((m) => m.toLowerCase() === lower)
    );
  }

  /**
   * Get playbooks that work with a specific symbol.
   */
  getBySymbol(symbol: string): Playbook[] {
    const upper = symbol.toUpperCase();
    return this.getAll().filter((pb) => {
      if (!pb.symbols || pb.symbols.length === 0) return true; // No symbol restriction
      return pb.symbols.some((s) => s.toUpperCase() === upper);
    });
  }

  /**
   * Get playbooks by tag.
   */
  getByTag(tag: string): Playbook[] {
    const lower = tag.toLowerCase();
    return this.getAll().filter((pb) =>
      pb.tags.some((t) => t.toLowerCase() === lower)
    );
  }

  // ---------- Search ----------

  /**
   * Search playbooks by a free-text query.
   * Matches against id, name, description, tags, markets, and symbols.
   *
   * @param query - Search string
   * @returns Matching playbooks sorted by relevance
   */
  search(query: string): Playbook[] {
    const lower = query.toLowerCase();
    const terms = lower.split(/\s+/).filter(Boolean);

    const scored = this.getAll().map((pb) => {
      let score = 0;
      const searchable = [
        pb.id,
        pb.name,
        pb.description,
        ...pb.tags,
        ...pb.markets,
        ...(pb.symbols ?? []),
        pb.riskLevel,
        `tier${pb.tier}`,
      ]
        .join(" ")
        .toLowerCase();

      for (const term of terms) {
        if (searchable.includes(term)) score += 1;
        if (pb.id.includes(term)) score += 2;
        if (pb.name.toLowerCase().includes(term)) score += 2;
      }

      return { pb, score };
    });

    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((s) => s.pb);
  }

  // ---------- Formatted Display ----------

  /**
   * Format all playbooks for terminal display, grouped by tier.
   */
  listFormatted(): FormattedPlaybookList {
    const tierLabels: Record<number, string> = {
      1: "Beginner Playbooks",
      2: "Intermediate Playbooks",
      3: "Advanced Playbooks",
    };

    const tiers = [1, 2, 3]
      .map((tier) => ({
        label: tierLabels[tier] ?? `Tier ${tier}`,
        playbooks: this.getByTier(tier as 1 | 2 | 3).map(formatPlaybook),
      }))
      .filter((t) => t.playbooks.length > 0);

    return {
      tiers,
      total: this.playbooks.size,
    };
  }

  // ---------- Utility ----------

  /**
   * Get the number of registered playbooks.
   */
  get size(): number {
    return this.playbooks.size;
  }

  /**
   * Clear all registered playbooks. Primarily for testing.
   */
  clear(): void {
    this.playbooks.clear();
  }
}

// ============================================================================
// Formatting Helpers
// ============================================================================

function formatPlaybook(pb: Playbook): FormattedPlaybook {
  return {
    id: pb.id,
    name: pb.name,
    tier: `Tier ${pb.tier}`,
    risk: pb.riskLevel,
    markets: pb.markets.join(", "),
    timeframes: pb.timeframes.join(", "),
    tags: pb.tags.join(", "),
    description: pb.description.length > 100
      ? pb.description.slice(0, 97) + "..."
      : pb.description,
  };
}

// ============================================================================
// Singleton Instance
// ============================================================================

/**
 * Global playbook registry instance.
 * Import this to register or look up playbooks.
 */
export const playbookRegistry = new PlaybookRegistry();
