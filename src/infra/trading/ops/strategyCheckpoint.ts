/**
 * Strategy Checkpointing — Save/Restore Portfolio Snapshots
 *
 * Trading equivalent of Claude Code's undo/checkpoint system. Saves
 * portfolio state at key moments (before rebalance, before strategy change)
 * and allows rollback to a previous snapshot.
 *
 * Unlike git (which tracks file diffs), this tracks portfolio state:
 * positions, cash, pending orders, risk parameters.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { GORDON_DIR } from "../../storage/paths.ts";

// ============================================================================
// Types
// ============================================================================

export interface PortfolioCheckpoint {
  id: string;
  /** Human-readable label. */
  label: string;
  /** ISO timestamp. */
  createdAt: string;
  /** Why this checkpoint was created. */
  reason: "manual" | "pre_rebalance" | "pre_strategy_change" | "pre_execution" | "auto";
  /** Full portfolio snapshot. */
  portfolio: {
    totalValueUsd: number;
    cashUsd: number;
    positions: Array<{
      symbol: string;
      side: "long" | "short";
      quantity: number;
      avgPrice: number;
      currentPrice: number;
      notionalUsd: number;
    }>;
    pendingOrders: Array<{
      orderId: string;
      symbol: string;
      side: "BUY" | "SELL";
      type: string;
      quantity: number;
      price?: number;
    }>;
  };
  /** Strategy parameters at checkpoint time. */
  strategyParams?: Record<string, unknown>;
  /** Risk parameters at checkpoint time. */
  riskParams?: {
    maxPositionPct: number;
    dailyLossLimit: number;
    maxDrawdownPct: number;
    permissionMode: "auto" | "ask" | "strict";
  };
  /** Session ID for correlation. */
  sessionId?: string;
}

// ============================================================================
// Storage
// ============================================================================

const CHECKPOINTS_DIR = join(GORDON_DIR, "checkpoints");
const MAX_CHECKPOINTS = 50;

function ensureDir(): void {
  if (!existsSync(CHECKPOINTS_DIR)) mkdirSync(CHECKPOINTS_DIR, { recursive: true });
}

function checkpointPath(id: string): string {
  return join(CHECKPOINTS_DIR, `${id}.json`);
}

// ============================================================================
// API
// ============================================================================

/**
 * Save a portfolio checkpoint.
 */
export function saveCheckpoint(
  checkpoint: Omit<PortfolioCheckpoint, "id" | "createdAt">,
): PortfolioCheckpoint {
  ensureDir();

  const full: PortfolioCheckpoint = {
    ...checkpoint,
    id: `cp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    createdAt: new Date().toISOString(),
  };

  writeFileSync(checkpointPath(full.id), JSON.stringify(full, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });

  // Enforce max checkpoints (delete oldest)
  pruneCheckpoints();

  return full;
}

/**
 * Load a specific checkpoint.
 */
export function loadCheckpoint(id: string): PortfolioCheckpoint | null {
  const path = checkpointPath(id);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as PortfolioCheckpoint;
  } catch {
    return null;
  }
}

/**
 * List all checkpoints (newest first).
 */
export function listCheckpoints(): PortfolioCheckpoint[] {
  ensureDir();
  const files = readdirSync(CHECKPOINTS_DIR).filter((f) => f.endsWith(".json"));
  const checkpoints: PortfolioCheckpoint[] = [];

  for (const file of files) {
    try {
      const cp = JSON.parse(
        readFileSync(join(CHECKPOINTS_DIR, file), "utf-8"),
      ) as PortfolioCheckpoint;
      checkpoints.push(cp);
    } catch {}
  }

  return checkpoints.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

/**
 * Get the most recent checkpoint.
 */
export function getLatestCheckpoint(): PortfolioCheckpoint | null {
  const all = listCheckpoints();
  return all[0] ?? null;
}

/**
 * Compare two checkpoints and return the diff.
 */
export function compareCheckpoints(
  oldId: string,
  newId: string,
): {
  old: PortfolioCheckpoint;
  new: PortfolioCheckpoint;
  valueDelta: number;
  positionsAdded: string[];
  positionsRemoved: string[];
  positionsChanged: string[];
} | null {
  const oldCp = loadCheckpoint(oldId);
  const newCp = loadCheckpoint(newId);
  if (!oldCp || !newCp) return null;

  const oldSymbols = new Set(oldCp.portfolio.positions.map((p) => p.symbol));
  const newSymbols = new Set(newCp.portfolio.positions.map((p) => p.symbol));

  const added = [...newSymbols].filter((s) => !oldSymbols.has(s));
  const removed = [...oldSymbols].filter((s) => !newSymbols.has(s));
  const changed = [...newSymbols].filter((s) => {
    if (!oldSymbols.has(s)) return false;
    const oldPos = oldCp.portfolio.positions.find((p) => p.symbol === s);
    const newPos = newCp.portfolio.positions.find((p) => p.symbol === s);
    return oldPos?.quantity !== newPos?.quantity || oldPos?.side !== newPos?.side;
  });

  return {
    old: oldCp,
    new: newCp,
    valueDelta: newCp.portfolio.totalValueUsd - oldCp.portfolio.totalValueUsd,
    positionsAdded: added,
    positionsRemoved: removed,
    positionsChanged: changed,
  };
}

function pruneCheckpoints(): void {
  const all = listCheckpoints();
  if (all.length <= MAX_CHECKPOINTS) return;

  const toRemove = all.slice(MAX_CHECKPOINTS);
  for (const cp of toRemove) {
    try {
      const { unlinkSync } = require("node:fs") as typeof import("node:fs");
      unlinkSync(checkpointPath(cp.id));
    } catch {
      // Non-critical
    }
  }
}

/**
 * Format a checkpoint for display.
 */
export function formatCheckpoint(cp: PortfolioCheckpoint): string {
  const lines: string[] = [];
  lines.push(`Checkpoint: ${cp.label} (${cp.id})`);
  lines.push(`  Created: ${cp.createdAt} | Reason: ${cp.reason}`);
  lines.push(
    `  Value: $${cp.portfolio.totalValueUsd.toLocaleString()} | Cash: $${cp.portfolio.cashUsd.toLocaleString()}`,
  );
  lines.push(
    `  Positions: ${cp.portfolio.positions.length} | Pending orders: ${cp.portfolio.pendingOrders.length}`,
  );

  for (const pos of cp.portfolio.positions.slice(0, 5)) {
    lines.push(
      `    ${pos.side} ${pos.quantity} ${pos.symbol} @ $${pos.avgPrice.toFixed(2)} ($${pos.notionalUsd.toLocaleString()})`,
    );
  }
  if (cp.portfolio.positions.length > 5) {
    lines.push(`    ... +${cp.portfolio.positions.length - 5} more`);
  }

  return lines.join("\n");
}
