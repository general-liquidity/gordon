/**
 * Strategy Registry
 *
 * Central registry for all trading strategies. Provides registration,
 * lookup, and listing capabilities for the strategy library.
 *
 * Usage:
 *   import { strategyRegistry } from "./registry.ts";
 *
 *   // Register a strategy
 *   strategyRegistry.register(supportBounceStrategy);
 *
 *   // Get a strategy by ID
 *   const strategy = strategyRegistry.get("support_bounce");
 *
 *   // List all strategies
 *   const all = strategyRegistry.listStrategies();
 */

import type { Strategy, StrategyDefinition, StrategyId } from "./types.ts";

// ============================================================================
// Strategy Registry Class
// ============================================================================

/**
 * Registry for managing trading strategies.
 * Singleton pattern - use the exported `strategyRegistry` instance.
 */
export class StrategyRegistry {
  private strategies = new Map<StrategyId, Strategy>();

  /**
   * Register a strategy in the registry.
   * Throws if a strategy with the same ID is already registered.
   *
   * @param strategy - Strategy instance to register
   */
  register(strategy: Strategy): void {
    if (this.strategies.has(strategy.id)) {
      throw new Error(`Strategy "${strategy.id}" is already registered. Use replace() to update.`);
    }
    this.strategies.set(strategy.id, strategy);
  }

  /**
   * Replace an existing strategy or register a new one.
   * Use this for testing or hot-reloading strategies.
   *
   * @param strategy - Strategy instance to register or replace
   */
  replace(strategy: Strategy): void {
    this.strategies.set(strategy.id, strategy);
  }

  /**
   * Get a strategy by its ID.
   *
   * @param id - Strategy ID to look up
   * @returns Strategy instance or undefined if not found
   */
  get(id: StrategyId): Strategy | undefined {
    return this.strategies.get(id);
  }

  /**
   * Get a strategy by ID, throwing if not found.
   *
   * @param id - Strategy ID to look up
   * @returns Strategy instance
   * @throws Error if strategy not found
   */
  getOrThrow(id: StrategyId): Strategy {
    const strategy = this.strategies.get(id);
    if (!strategy) {
      throw new Error(`Strategy "${id}" not found. Available: ${this.getIds().join(", ")}`);
    }
    return strategy;
  }

  /**
   * Check if a strategy is registered.
   *
   * @param id - Strategy ID to check
   * @returns true if registered
   */
  has(id: StrategyId): boolean {
    return this.strategies.has(id);
  }

  /**
   * Get all registered strategies.
   *
   * @returns Array of all strategy instances
   */
  getAll(): Strategy[] {
    return Array.from(this.strategies.values());
  }

  /**
   * Get all strategy IDs.
   *
   * @returns Array of registered strategy IDs
   */
  getIds(): StrategyId[] {
    return Array.from(this.strategies.keys());
  }

  /**
   * Get strategies by tier.
   *
   * @param tier - Tier to filter by (1 = beginner, 2 = intermediate)
   * @returns Array of strategies in that tier
   */
  getByTier(tier: 1 | 2): Strategy[] {
    return this.getAll().filter((s) => s.tier === tier);
  }

  /**
   * Get strategies by risk level.
   *
   * @param riskLevel - Risk level to filter by
   * @returns Array of strategies with that risk level
   */
  getByRiskLevel(riskLevel: "low" | "medium" | "high"): Strategy[] {
    return this.getAll().filter((s) => s.riskLevel === riskLevel);
  }

  /**
   * List all strategies as definitions (without methods).
   * Useful for displaying available strategies to users.
   *
   * @returns Array of strategy definitions
   */
  listStrategies(): StrategyDefinition[] {
    return this.getAll().map((s) => ({
      id: s.id,
      name: s.name,
      tier: s.tier,
      description: s.description,
      indicators: s.indicators,
      timeframes: s.timeframes,
      riskLevel: s.riskLevel,
    }));
  }

  /**
   * List strategies formatted for display.
   * Groups by tier and includes all relevant info.
   *
   * @returns Formatted strategy list
   */
  listFormatted(): FormattedStrategyList {
    const tier1 = this.getByTier(1).map(formatStrategy);
    const tier2 = this.getByTier(2).map(formatStrategy);

    return {
      tier1: {
        label: "Beginner Strategies",
        strategies: tier1,
      },
      tier2: {
        label: "Intermediate Strategies",
        strategies: tier2,
      },
      total: this.strategies.size,
    };
  }

  /**
   * Get the number of registered strategies.
   *
   * @returns Count of registered strategies
   */
  get size(): number {
    return this.strategies.size;
  }

  /**
   * Clear all registered strategies.
   * Primarily for testing purposes.
   */
  clear(): void {
    this.strategies.clear();
  }
}

// ============================================================================
// Formatted Output Types
// ============================================================================

export interface FormattedStrategy {
  id: StrategyId;
  name: string;
  description: string;
  indicators: string;
  timeframes: string;
  risk: string;
}

export interface FormattedStrategyList {
  tier1: {
    label: string;
    strategies: FormattedStrategy[];
  };
  tier2: {
    label: string;
    strategies: FormattedStrategy[];
  };
  total: number;
}

/**
 * Format a strategy for display
 */
function formatStrategy(s: Strategy): FormattedStrategy {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    indicators: s.indicators.join(", "),
    timeframes: s.timeframes.join(", "),
    risk: s.riskLevel,
  };
}

// ============================================================================
// Singleton Instance
// ============================================================================

/**
 * Global strategy registry instance.
 * Import this to register or look up strategies.
 */
export const strategyRegistry = new StrategyRegistry();
