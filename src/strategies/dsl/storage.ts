/**
 * DSL Strategy Storage
 *
 * Handles persistence of DSL-based strategies to the filesystem.
 * Stores strategies in ~/.gordon/strategies/generated/
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { StrategyDSL } from "./schema.ts";
import { validateStrategyDSL } from "./schema.ts";
import { GORDON_DIR, getGordonDir } from "../../infra/storage/paths.ts";

// Re-export for callers
export { getGordonDir };

// ============================================================================
// Constants
// ============================================================================

const STRATEGIES_DIR = "strategies";
const GENERATED_DIR = "generated";
const STRATEGY_EXT = ".json";

// ============================================================================
// Path Helpers
// ============================================================================

/**
 * Get the strategies directory path
 */
export function getStrategiesDir(): string {
  return path.join(GORDON_DIR, STRATEGIES_DIR);
}

/**
 * Get the generated strategies directory path
 */
export function getGeneratedStrategiesDir(): string {
  return path.join(getStrategiesDir(), GENERATED_DIR);
}

/**
 * Get the full path for a strategy file
 */
function getStrategyPath(id: string): string {
  return path.join(getGeneratedStrategiesDir(), `${id}${STRATEGY_EXT}`);
}

// ============================================================================
// Directory Management
// ============================================================================

/**
 * Ensure the generated strategies directory exists
 */
async function ensureDir(): Promise<void> {
  const dir = getGeneratedStrategiesDir();
  await fs.mkdir(dir, { recursive: true });
}

/**
 * Check if the storage directory exists
 */
export async function storageExists(): Promise<boolean> {
  try {
    await fs.access(getGeneratedStrategiesDir());
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// CRUD Operations
// ============================================================================

/**
 * Save a strategy DSL to storage
 *
 * @param dsl - Strategy DSL to save
 * @throws Error if validation fails or write fails
 */
export async function saveStrategy(dsl: StrategyDSL): Promise<void> {
  // Validate the DSL before saving
  const validation = validateStrategyDSL(dsl);
  if (!validation.success) {
    throw new Error(`Invalid strategy DSL: ${validation.errors?.join(", ")}`);
  }

  await ensureDir();

  // Add metadata if not present
  const strategyWithMeta: StrategyDSL = {
    ...dsl,
    metadata: {
      ...dsl.metadata,
      generatedAt: dsl.metadata?.generatedAt ?? new Date().toISOString(),
    },
  };

  const filePath = getStrategyPath(dsl.id);
  const content = JSON.stringify(strategyWithMeta, null, 2);

  await fs.writeFile(filePath, content, "utf-8");
}

/**
 * Load a strategy DSL from storage
 *
 * @param id - Strategy ID to load
 * @returns Strategy DSL or null if not found
 */
export async function loadStrategy(id: string): Promise<StrategyDSL | null> {
  const filePath = getStrategyPath(id);

  try {
    const content = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(content);

    const validation = validateStrategyDSL(parsed);
    if (!validation.success) {
      console.error(`Invalid strategy file ${id}: ${validation.errors?.join(", ")}`);
      return null;
    }

    return validation.data!;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null; // File doesn't exist
    }
    throw error; // Re-throw other errors
  }
}

/**
 * List all saved strategy DSLs
 *
 * @returns Array of all valid strategy DSLs
 */
export async function listStrategies(): Promise<StrategyDSL[]> {
  await ensureDir();

  const dir = getGeneratedStrategiesDir();
  const entries = await fs.readdir(dir);

  const strategies: StrategyDSL[] = [];

  for (const entry of entries) {
    if (!entry.endsWith(STRATEGY_EXT)) {
      continue;
    }

    const id = entry.slice(0, -STRATEGY_EXT.length);
    const strategy = await loadStrategy(id);

    if (strategy) {
      strategies.push(strategy);
    }
  }

  // Sort by name
  return strategies.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Delete a strategy from storage
 *
 * @param id - Strategy ID to delete
 * @returns true if deleted, false if not found
 */
export async function deleteStrategy(id: string): Promise<boolean> {
  const filePath = getStrategyPath(id);

  try {
    await fs.unlink(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false; // File doesn't exist
    }
    throw error;
  }
}

/**
 * Check if a strategy exists in storage
 *
 * @param id - Strategy ID to check
 * @returns true if exists
 */
export async function strategyExists(id: string): Promise<boolean> {
  const filePath = getStrategyPath(id);

  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Bulk Operations
// ============================================================================

/**
 * Save multiple strategies
 *
 * @param strategies - Array of strategy DSLs to save
 * @returns Object with success count and errors
 */
export async function saveStrategies(
  strategies: StrategyDSL[]
): Promise<{ saved: number; errors: Array<{ id: string; error: string }> }> {
  await ensureDir();

  const errors: Array<{ id: string; error: string }> = [];
  let saved = 0;

  for (const strategy of strategies) {
    try {
      await saveStrategy(strategy);
      saved++;
    } catch (error) {
      errors.push({
        id: strategy.id,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return { saved, errors };
}

/**
 * Delete multiple strategies
 *
 * @param ids - Array of strategy IDs to delete
 * @returns Number of strategies actually deleted
 */
export async function deleteStrategies(ids: string[]): Promise<number> {
  let deleted = 0;

  for (const id of ids) {
    if (await deleteStrategy(id)) {
      deleted++;
    }
  }

  return deleted;
}

/**
 * Clear all generated strategies
 *
 * @returns Number of strategies deleted
 */
export async function clearAllStrategies(): Promise<number> {
  const strategies = await listStrategies();
  const ids = strategies.map((s) => s.id);
  return deleteStrategies(ids);
}

// ============================================================================
// Search and Filter
// ============================================================================

/**
 * List strategies filtered by criteria
 */
export async function listStrategiesFiltered(options: {
  tier?: "1" | "2";
  riskLevel?: "low" | "medium" | "high";
  timeframe?: string;
  tags?: string[];
}): Promise<StrategyDSL[]> {
  const all = await listStrategies();

  return all.filter((s) => {
    // Filter by tier
    if (options.tier && s.tier !== options.tier) {
      return false;
    }

    // Filter by risk level
    if (options.riskLevel && s.riskLevel !== options.riskLevel) {
      return false;
    }

    // Filter by timeframe
    if (options.timeframe && !s.timeframes.includes(options.timeframe)) {
      return false;
    }

    // Filter by tags
    if (options.tags && options.tags.length > 0) {
      const strategyTags = s.metadata?.tags ?? [];
      const hasAllTags = options.tags.every((tag) => strategyTags.includes(tag));
      if (!hasAllTags) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Search strategies by name or description
 */
export async function searchStrategies(query: string): Promise<StrategyDSL[]> {
  const all = await listStrategies();
  const lowerQuery = query.toLowerCase();

  return all.filter((s) => {
    return (
      s.name.toLowerCase().includes(lowerQuery) ||
      s.description.toLowerCase().includes(lowerQuery) ||
      s.id.includes(lowerQuery) ||
      (s.metadata?.tags ?? []).some((t) => t.toLowerCase().includes(lowerQuery))
    );
  });
}

// ============================================================================
// Import/Export
// ============================================================================

/**
 * Export all strategies to a single JSON file
 */
export async function exportStrategies(outputPath: string): Promise<number> {
  const strategies = await listStrategies();

  const exportData = {
    version: "1.0.0",
    exportedAt: new Date().toISOString(),
    strategies,
  };

  await fs.writeFile(outputPath, JSON.stringify(exportData, null, 2), "utf-8");

  return strategies.length;
}

/**
 * Import strategies from a JSON file
 */
export async function importStrategies(
  inputPath: string
): Promise<{ imported: number; skipped: number; errors: string[] }> {
  const content = await fs.readFile(inputPath, "utf-8");
  const data = JSON.parse(content);

  const errors: string[] = [];
  let imported = 0;
  let skipped = 0;

  // Handle both array format and object with strategies array
  const strategies: unknown[] = Array.isArray(data) ? data : data.strategies ?? [];

  for (const item of strategies) {
    const validation = validateStrategyDSL(item);

    if (!validation.success) {
      const id = (item as { id?: string })?.id ?? "unknown";
      errors.push(`${id}: ${validation.errors?.join(", ")}`);
      continue;
    }

    // Check if already exists
    const exists = await strategyExists(validation.data!.id);
    if (exists) {
      skipped++;
      continue;
    }

    try {
      await saveStrategy(validation.data!);
      imported++;
    } catch (error) {
      errors.push(`${validation.data!.id}: ${error instanceof Error ? error.message : "save failed"}`);
    }
  }

  return { imported, skipped, errors };
}

// ============================================================================
// Metadata Operations
// ============================================================================

/**
 * Update metadata for a strategy
 */
export async function updateStrategyMetadata(
  id: string,
  metadata: Partial<NonNullable<StrategyDSL["metadata"]>>
): Promise<boolean> {
  const strategy = await loadStrategy(id);
  if (!strategy) {
    return false;
  }

  strategy.metadata = {
    ...strategy.metadata,
    ...metadata,
  };

  await saveStrategy(strategy);
  return true;
}

/**
 * Add backtest results to strategy metadata
 */
export async function addBacktestResults(
  id: string,
  results: Record<string, unknown>
): Promise<boolean> {
  return updateStrategyMetadata(id, { backtestResults: results });
}

/**
 * Add tags to a strategy
 */
export async function addTags(id: string, tags: string[]): Promise<boolean> {
  const strategy = await loadStrategy(id);
  if (!strategy) {
    return false;
  }

  const existingTags = strategy.metadata?.tags ?? [];
  const newTags = [...new Set([...existingTags, ...tags])];

  return updateStrategyMetadata(id, { tags: newTags });
}

/**
 * Remove tags from a strategy
 */
export async function removeTags(id: string, tags: string[]): Promise<boolean> {
  const strategy = await loadStrategy(id);
  if (!strategy) {
    return false;
  }

  const existingTags = strategy.metadata?.tags ?? [];
  const filteredTags = existingTags.filter((t) => !tags.includes(t));

  return updateStrategyMetadata(id, { tags: filteredTags });
}

// ============================================================================
// Storage Statistics
// ============================================================================

/**
 * Get storage statistics
 */
export async function getStorageStats(): Promise<{
  totalStrategies: number;
  byTier: { tier1: number; tier2: number };
  byRiskLevel: { low: number; medium: number; high: number };
  totalSize: number;
}> {
  const strategies = await listStrategies();

  const byTier = { tier1: 0, tier2: 0 };
  const byRiskLevel = { low: 0, medium: 0, high: 0 };

  for (const s of strategies) {
    if (s.tier === "1") byTier.tier1++;
    else byTier.tier2++;

    byRiskLevel[s.riskLevel]++;
  }

  // Calculate total size
  let totalSize = 0;
  const dir = getGeneratedStrategiesDir();

  try {
    const entries = await fs.readdir(dir);
    for (const entry of entries) {
      if (entry.endsWith(STRATEGY_EXT)) {
        const stat = await fs.stat(path.join(dir, entry));
        totalSize += stat.size;
      }
    }
  } catch {
    // Directory might not exist
  }

  return {
    totalStrategies: strategies.length,
    byTier,
    byRiskLevel,
    totalSize,
  };
}
