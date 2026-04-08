/**
 * Auto-Optimizer Enhancements — Inspired by Recursive-Improve
 *
 * Three additions to the base auto-optimizer:
 *
 * 1. Ratchet History: versioned parameter snapshots with full metrics,
 *    creating an auditable optimization trail.
 *
 * 2. Root Cause Diagnosis: when a mutation makes things worse, diagnose
 *    WHICH metric degraded most and target the next mutation at that weakness.
 *
 * 3. Island Evolution: run N independent optimization streams in parallel
 *    with different starting points, periodically cross-pollinate the best.
 *
 * These enhance (not replace) the base autoOptimizer.ts hill-climbing loop.
 * The genome system (core/genome/) handles playbook-level evolution;
 * these handle parameter-level optimization with smarter search.
 */

import type { StrategyParameters, BacktestScore, OptimizationResult } from "./autoOptimizer.ts";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GORDON_DIR } from "../storage/paths.ts";

// ============================================================================
// 1. RATCHET HISTORY — Versioned parameter snapshots
// ============================================================================

export interface RatchetEntry {
  id: string;
  iteration: number;
  timestamp: string;
  parameters: StrategyParameters;
  score: BacktestScore;
  decision: "keep" | "revert";
  /** Which parameters changed from previous entry. */
  parameterDiffs: Array<{ param: string; from: number; to: number }>;
  /** Commit-like hash for deduplication. */
  hash: string;
}

export interface RatchetHistory {
  directiveDescription: string;
  startedAt: string;
  entries: RatchetEntry[];
  bestEntry: RatchetEntry | null;
  totalKeeps: number;
  totalReverts: number;
}

const RATCHET_DIR = join(GORDON_DIR, "optimization-history");

function ensureRatchetDir(): void {
  if (!existsSync(RATCHET_DIR)) mkdirSync(RATCHET_DIR, { recursive: true });
}

function hashParams(params: StrategyParameters): string {
  const sorted = Object.entries(params).sort(([a], [b]) => a.localeCompare(b));
  const str = sorted.map(([k, v]) => `${k}:${v.toFixed(6)}`).join("|");
  // Simple hash (not crypto — just dedup)
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36).padStart(8, "0");
}

export function createRatchetHistory(directiveDescription: string): RatchetHistory {
  return {
    directiveDescription,
    startedAt: new Date().toISOString(),
    entries: [],
    bestEntry: null,
    totalKeeps: 0,
    totalReverts: 0,
  };
}

export function recordRatchetEntry(
  history: RatchetHistory,
  iteration: number,
  params: StrategyParameters,
  score: BacktestScore,
  decision: "keep" | "revert",
  prevParams?: StrategyParameters,
): RatchetEntry {
  const parameterDiffs = prevParams
    ? Object.keys(params)
        .filter((k) => params[k] !== prevParams[k])
        .map((k) => ({ param: k, from: prevParams[k]!, to: params[k]! }))
    : [];

  const entry: RatchetEntry = {
    id: `ratchet_${iteration}_${Date.now().toString(36)}`,
    iteration,
    timestamp: new Date().toISOString(),
    parameters: { ...params },
    score,
    decision,
    parameterDiffs,
    hash: hashParams(params),
  };

  history.entries.push(entry);
  if (decision === "keep") {
    history.totalKeeps++;
    if (!history.bestEntry || score.objectiveValue > history.bestEntry.score.objectiveValue) {
      history.bestEntry = entry;
    }
  } else {
    history.totalReverts++;
  }

  return entry;
}

export function saveRatchetHistory(history: RatchetHistory): void {
  ensureRatchetDir();
  const filename = `ratchet_${history.startedAt.replace(/[:.]/g, "-")}.json`;
  writeFileSync(join(RATCHET_DIR, filename), JSON.stringify(history, null, 2), { encoding: "utf-8", mode: 0o600 });
}

export function loadLatestRatchetHistory(): RatchetHistory | null {
  ensureRatchetDir();
  try {
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    const files = readdirSync(RATCHET_DIR).filter((f: string) => f.startsWith("ratchet_")).sort().reverse();
    if (files.length === 0) return null;
    return JSON.parse(readFileSync(join(RATCHET_DIR, files[0]!), "utf-8"));
  } catch {
    return null;
  }
}

// ============================================================================
// 2. ROOT CAUSE DIAGNOSIS — Target mutations at weakest metric
// ============================================================================

export type WeaknessCategory =
  | "return_degraded"      // Total return dropped
  | "risk_increased"       // Drawdown or volatility increased
  | "consistency_dropped"  // Win rate or Sortino dropped
  | "insufficient_trades"  // Too few trades (overfitting to few signals)
  | "multiple_degraded";   // Several metrics got worse simultaneously

export interface Diagnosis {
  category: WeaknessCategory;
  worstMetric: string;
  degradationPct: number;
  /** Which parameters to target for the next mutation. */
  targetParameters: string[];
  /** Suggested mutation direction. */
  suggestion: string;
}

/**
 * Diagnose WHY a mutation made things worse.
 * Returns which metric degraded most and which parameters to target.
 */
export function diagnoseFailure(
  before: BacktestScore,
  after: BacktestScore,
  mutatedParams: string[],
): Diagnosis {
  const deltas: Array<{ metric: string; before: number; after: number; changePct: number }> = [
    { metric: "sharpe", before: before.metrics.sharpe, after: after.metrics.sharpe, changePct: pctChange(before.metrics.sharpe, after.metrics.sharpe) },
    { metric: "sortino", before: before.metrics.sortino, after: after.metrics.sortino, changePct: pctChange(before.metrics.sortino, after.metrics.sortino) },
    { metric: "totalReturn", before: before.metrics.totalReturn, after: after.metrics.totalReturn, changePct: pctChange(before.metrics.totalReturn, after.metrics.totalReturn) },
    { metric: "winRate", before: before.metrics.winRate, after: after.metrics.winRate, changePct: pctChange(before.metrics.winRate, after.metrics.winRate) },
    { metric: "maxDrawdownPct", before: before.metrics.maxDrawdownPct, after: after.metrics.maxDrawdownPct, changePct: pctChange(before.metrics.maxDrawdownPct, after.metrics.maxDrawdownPct) },
    { metric: "tradeCount", before: before.metrics.tradeCount, after: after.metrics.tradeCount, changePct: pctChange(before.metrics.tradeCount, after.metrics.tradeCount) },
  ];

  // Find worst degradation (for drawdown, higher = worse, so invert)
  const degraded = deltas.filter((d) => {
    if (d.metric === "maxDrawdownPct") return d.after > d.before; // Higher drawdown = worse
    return d.after < d.before; // Lower everything else = worse
  });

  if (degraded.length === 0) {
    return {
      category: "multiple_degraded",
      worstMetric: "unknown",
      degradationPct: 0,
      targetParameters: mutatedParams,
      suggestion: "No clear single weakness. Try a different mutation direction.",
    };
  }

  const worst = degraded.reduce((w, d) => Math.abs(d.changePct) > Math.abs(w.changePct) ? d : w);

  let category: WeaknessCategory;
  let suggestion: string;

  if (worst.metric === "totalReturn") {
    category = "return_degraded";
    suggestion = "Entry/exit thresholds may be too tight. Try relaxing entry conditions.";
  } else if (worst.metric === "maxDrawdownPct") {
    category = "risk_increased";
    suggestion = "Stop loss may be too wide or position size too large. Tighten stops.";
  } else if (worst.metric === "winRate" || worst.metric === "sortino") {
    category = "consistency_dropped";
    suggestion = "Signal quality degraded. Try adjusting indicator periods or entry confirmation.";
  } else if (worst.metric === "tradeCount" && after.metrics.tradeCount < 10) {
    category = "insufficient_trades";
    suggestion = "Too few trades — signals are too restrictive. Loosen thresholds.";
  } else {
    category = "multiple_degraded";
    suggestion = "Multiple metrics degraded. Revert to a smaller perturbation.";
  }

  return {
    category,
    worstMetric: worst.metric,
    degradationPct: worst.changePct,
    targetParameters: mutatedParams,
    suggestion,
  };
}

function pctChange(before: number, after: number): number {
  if (before === 0) return after === 0 ? 0 : 100;
  return ((after - before) / Math.abs(before)) * 100;
}

/**
 * Generate a TARGETED mutation based on diagnosis.
 * Instead of random mutations, target the parameters most likely to fix the weakness.
 */
export function generateTargetedMutation(
  base: StrategyParameters,
  diagnosis: Diagnosis,
  temperature: number = 0.15,
): StrategyParameters {
  const mutated = { ...base };
  const keys = Object.keys(base);

  // Identify parameters related to the weakness
  let targetKeys: string[];

  switch (diagnosis.category) {
    case "return_degraded":
      // Target entry/exit thresholds
      targetKeys = keys.filter((k) => /entry|exit|threshold|trigger|signal/i.test(k));
      break;
    case "risk_increased":
      // Target stop loss and position sizing
      targetKeys = keys.filter((k) => /stop|size|position|risk|atr/i.test(k));
      break;
    case "consistency_dropped":
      // Target indicator periods and confirmation
      targetKeys = keys.filter((k) => /period|window|lookback|length|ema|rsi|macd/i.test(k));
      break;
    case "insufficient_trades":
      // Loosen entry thresholds
      targetKeys = keys.filter((k) => /entry|threshold|min|filter/i.test(k));
      break;
    default:
      targetKeys = diagnosis.targetParameters.length > 0 ? diagnosis.targetParameters : keys;
  }

  // Fallback to all keys if no match
  if (targetKeys.length === 0) targetKeys = keys;

  // Mutate 1-2 targeted parameters
  const numToMutate = Math.min(2, targetKeys.length);
  const shuffled = [...targetKeys].sort(() => Math.random() - 0.5);

  for (let i = 0; i < numToMutate; i++) {
    const key = shuffled[i]!;
    const original = base[key]!;
    const perturbation = 1 + (Math.random() * 2 - 1) * temperature;
    let newValue = original * perturbation;
    if (Number.isInteger(original)) {
      newValue = Math.round(newValue);
      if (newValue === original) newValue += Math.random() > 0.5 ? 1 : -1;
    }
    mutated[key] = Math.max(original * 0.1, newValue);
  }

  return mutated;
}

// ============================================================================
// 3. ISLAND EVOLUTION — Parallel optimization streams
// ============================================================================

export interface Island {
  id: number;
  parameters: StrategyParameters;
  bestScore: BacktestScore | null;
  bestObjective: number;
  iterations: number;
  improvements: number;
}

export interface IslandEvolutionConfig {
  /** Number of parallel islands. Default 5. */
  numIslands: number;
  /** Generations before cross-pollination. Default 5. */
  crossPollinationInterval: number;
  /** How much of the best island's parameters to blend. Default 0.3. */
  blendFactor: number;
}

export const DEFAULT_ISLAND_CONFIG: IslandEvolutionConfig = {
  numIslands: 5,
  crossPollinationInterval: 5,
  blendFactor: 0.3,
};

/**
 * Initialize islands with different starting points.
 * Each island gets a perturbed version of the base parameters.
 */
export function initializeIslands(
  baseParams: StrategyParameters,
  numIslands: number = 5,
): Island[] {
  const islands: Island[] = [];

  // Island 0 = base parameters (control)
  islands.push({
    id: 0,
    parameters: { ...baseParams },
    bestScore: null,
    bestObjective: -Infinity,
    iterations: 0,
    improvements: 0,
  });

  // Islands 1-N = perturbed starting points
  for (let i = 1; i < numIslands; i++) {
    const perturbed: StrategyParameters = {};
    for (const [key, value] of Object.entries(baseParams)) {
      const factor = 0.5 + Math.random() * 1.0; // 50% to 150% of original
      perturbed[key] = Number.isInteger(value) ? Math.round(value * factor) : value * factor;
    }
    islands.push({
      id: i,
      parameters: perturbed,
      bestScore: null,
      bestObjective: -Infinity,
      iterations: 0,
      improvements: 0,
    });
  }

  return islands;
}

/**
 * Cross-pollinate: blend the best island's parameters into others.
 * One island per generation skips cross-pollination (preserves diversity).
 */
export function crossPollinate(
  islands: Island[],
  config: IslandEvolutionConfig = DEFAULT_ISLAND_CONFIG,
): void {
  // Find the best island
  const best = islands.reduce((b, island) =>
    island.bestObjective > b.bestObjective ? island : b,
  );

  // Skip island to preserve diversity (random selection)
  const skipIdx = Math.floor(Math.random() * islands.length);

  for (const island of islands) {
    if (island.id === best.id) continue; // Don't blend best with itself
    if (island.id === islands[skipIdx]?.id) continue; // Diversity preservation

    // Blend: island params = (1 - blend) * island + blend * best
    for (const key of Object.keys(island.parameters)) {
      const own = island.parameters[key]!;
      const bestVal = best.parameters[key]!;
      const blended = own * (1 - config.blendFactor) + bestVal * config.blendFactor;
      island.parameters[key] = Number.isInteger(own) ? Math.round(blended) : blended;
    }
  }
}

/**
 * Get the overall best result across all islands.
 */
export function getBestIsland(islands: Island[]): Island {
  return islands.reduce((best, island) =>
    island.bestObjective > best.bestObjective ? island : best,
  );
}

/**
 * Format island evolution status for display.
 */
export function formatIslandStatus(islands: Island[]): string {
  const best = getBestIsland(islands);
  const lines = ["Island Evolution Status:", ""];

  for (const island of islands) {
    const isBest = island.id === best.id;
    const icon = isBest ? "\u2605" : "\u25CB";
    const score = island.bestObjective === -Infinity ? "—" : island.bestObjective.toFixed(3);
    lines.push(`  ${icon} Island ${island.id}: score ${score} | ${island.iterations} iters | ${island.improvements} improvements${isBest ? " (BEST)" : ""}`);
  }

  return lines.join("\n");
}
