/**
 * Evaluation Feedback Loop — Learn from Trade Outcomes
 *
 * Tracks trade outcomes (win/loss/breakeven) by pattern and adjusts
 * confidence scores for future recommendations. If a pattern loses
 * money 3+ times, it gets downweighted. If it wins consistently,
 * it gets upweighted.
 *
 * NOT an ML model — just a sliding-window frequency counter with
 * exponential decay. Simple, auditable, deterministic.
 *
 * Integration: called by the orchestrator after trade closures
 * (via PostOrderPlacement hook or position:closed event).
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getGordonDir } from "../../storage/paths.ts";

// ============================================================================
// Types
// ============================================================================

export interface TradeOutcome {
  id: string;
  /** Pattern that generated this trade (e.g., "breakout", "mean-reversion", "momentum"). */
  pattern: string;
  /** Symbol traded. */
  symbol: string;
  /** Whether the trade was profitable. */
  result: "win" | "loss" | "breakeven";
  /** P&L in USD. */
  pnlUsd: number;
  /** P&L as percentage of entry. */
  pnlPct: number;
  /** How long the trade was held (ms). */
  holdDurationMs: number;
  /** ISO timestamp of close. */
  closedAt: string;
  /** Strategy that generated this (if any). */
  strategy?: string;
  /** Timeframe used. */
  timeframe?: string;
}

export interface PatternStats {
  pattern: string;
  totalTrades: number;
  wins: number;
  losses: number;
  breakevens: number;
  winRate: number;
  avgPnlPct: number;
  /** Confidence multiplier: 1.0 = neutral, >1.0 = upweighted, <1.0 = downweighted. */
  confidenceMultiplier: number;
  /** Recent streak (positive = winning, negative = losing). */
  streak: number;
  /** Last 10 outcomes. */
  recentOutcomes: Array<"win" | "loss" | "breakeven">;
  lastUpdated: string;
}

// ============================================================================
// Storage
// ============================================================================

// Paths are resolved lazily (per call) rather than at module load: the
// pre-resolved GORDON_DIR const freezes whatever GORDON_HOME was when
// storage/paths.ts FIRST loaded, so a test (or operator) that overrides
// GORDON_HOME after any other module touched paths.ts would silently
// read/write the REAL ~/.gordon — persistent feedback state leaking across
// test runs.
function feedbackDir(): string {
  return join(getGordonDir(), "feedback");
}

function outcomesFile(): string {
  return join(feedbackDir(), "outcomes.json");
}

function statsFile(): string {
  return join(feedbackDir(), "pattern-stats.json");
}

function ensureDir(): void {
  const dir = feedbackDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function loadOutcomes(): TradeOutcome[] {
  const file = outcomesFile();
  if (!existsSync(file)) return [];
  try { return JSON.parse(readFileSync(file, "utf-8")); } catch { return []; }
}

function saveOutcomes(outcomes: TradeOutcome[]): void {
  ensureDir();
  // Keep last 500 outcomes
  const trimmed = outcomes.slice(-500);
  writeFileSync(outcomesFile(), JSON.stringify(trimmed, null, 2), { encoding: "utf-8", mode: 0o600 });
}

function loadPatternStats(): Record<string, PatternStats> {
  const file = statsFile();
  if (!existsSync(file)) return {};
  try { return JSON.parse(readFileSync(file, "utf-8")); } catch { return {}; }
}

function savePatternStats(stats: Record<string, PatternStats>): void {
  ensureDir();
  writeFileSync(statsFile(), JSON.stringify(stats, null, 2), { encoding: "utf-8", mode: 0o600 });
}

// ============================================================================
// Core Logic
// ============================================================================

/**
 * Record a trade outcome and update pattern statistics.
 */
export function recordTradeOutcome(outcome: TradeOutcome): PatternStats {
  // Save outcome
  const outcomes = loadOutcomes();
  outcomes.push(outcome);
  saveOutcomes(outcomes);

  // Update pattern stats
  const allStats = loadPatternStats();
  const stats = allStats[outcome.pattern] ?? createEmptyStats(outcome.pattern);

  stats.totalTrades++;
  if (outcome.result === "win") { stats.wins++; stats.streak = Math.max(1, stats.streak + 1); }
  else if (outcome.result === "loss") { stats.losses++; stats.streak = Math.min(-1, stats.streak - 1); }
  else { stats.breakevens++; stats.streak = 0; }

  stats.winRate = stats.wins / Math.max(1, stats.wins + stats.losses);

  // Rolling average P&L (exponential decay, recent trades weighted more)
  const alpha = 0.15; // Smoothing factor
  stats.avgPnlPct = stats.avgPnlPct * (1 - alpha) + outcome.pnlPct * alpha;

  // Recent outcomes (last 10)
  stats.recentOutcomes.push(outcome.result);
  if (stats.recentOutcomes.length > 10) stats.recentOutcomes.shift();

  // Compute confidence multiplier
  stats.confidenceMultiplier = computeConfidenceMultiplier(stats);
  stats.lastUpdated = new Date().toISOString();

  allStats[outcome.pattern] = stats;
  savePatternStats(allStats);

  return stats;
}

/**
 * Compute confidence multiplier based on recent performance.
 *
 * Rules:
 *   - Win rate > 60% over last 10 → upweight (1.0 → 1.3)
 *   - Win rate < 40% over last 10 → downweight (1.0 → 0.6)
 *   - 3+ consecutive losses → strong downweight (0.4)
 *   - 3+ consecutive wins → moderate upweight (1.2)
 *   - Not enough data (<5 trades) → neutral (1.0)
 */
function computeConfidenceMultiplier(stats: PatternStats): number {
  if (stats.totalTrades < 5) return 1.0;

  const recent = stats.recentOutcomes;
  const recentWins = recent.filter((r) => r === "win").length;
  const recentTotal = recent.filter((r) => r !== "breakeven").length;
  const recentWinRate = recentTotal > 0 ? recentWins / recentTotal : 0.5;

  let multiplier = 1.0;

  // Win rate adjustment
  if (recentWinRate > 0.7) multiplier = 1.3;
  else if (recentWinRate > 0.6) multiplier = 1.15;
  else if (recentWinRate < 0.3) multiplier = 0.5;
  else if (recentWinRate < 0.4) multiplier = 0.7;

  // Streak adjustment
  if (stats.streak <= -3) multiplier = Math.min(multiplier, 0.4);
  else if (stats.streak >= 3) multiplier = Math.max(multiplier, 1.2);

  // Clamp
  return Math.max(0.2, Math.min(1.5, multiplier));
}

function createEmptyStats(pattern: string): PatternStats {
  return {
    pattern,
    totalTrades: 0,
    wins: 0,
    losses: 0,
    breakevens: 0,
    winRate: 0,
    avgPnlPct: 0,
    confidenceMultiplier: 1.0,
    streak: 0,
    recentOutcomes: [],
    lastUpdated: new Date().toISOString(),
  };
}

// ============================================================================
// Query API
// ============================================================================

/**
 * Get confidence multiplier for a pattern. Used by the scanner/analyst
 * to weight recommendations.
 */
export function getPatternConfidence(pattern: string): number {
  const stats = loadPatternStats();
  return stats[pattern]?.confidenceMultiplier ?? 1.0;
}

/**
 * Get full stats for a pattern.
 */
export function getPatternStats(pattern: string): PatternStats | null {
  const stats = loadPatternStats();
  return stats[pattern] ?? null;
}

/**
 * Get all pattern stats (for display).
 */
export function getAllPatternStats(): PatternStats[] {
  return Object.values(loadPatternStats()).sort((a, b) => b.totalTrades - a.totalTrades);
}

/**
 * Format pattern stats for agent prompt injection.
 * Shows patterns with strong signals (very good or very bad).
 */
export function formatFeedbackForPrompt(): string {
  const stats = getAllPatternStats();
  if (stats.length === 0) return "";

  const notable = stats.filter((s) => s.totalTrades >= 5 && (s.confidenceMultiplier < 0.7 || s.confidenceMultiplier > 1.15));
  if (notable.length === 0) return "";

  const lines = ["[GORDON_PATTERN_FEEDBACK]"];
  for (const s of notable) {
    const direction = s.confidenceMultiplier > 1.0 ? "STRONG" : "WEAK";
    lines.push(`- ${s.pattern}: ${direction} (${(s.winRate * 100).toFixed(0)}% WR, ${s.totalTrades} trades, streak ${s.streak}, confidence ${s.confidenceMultiplier.toFixed(2)}x)`);
  }
  return lines.join("\n") + "\n";
}
