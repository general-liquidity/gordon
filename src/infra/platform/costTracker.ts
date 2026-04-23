/**
 * Per-Model Cost Tracking
 *
 * Accumulate API costs broken down by model. Tracks input, output, and
 * cache tokens separately. Persists to ~/.gordon/sessions/{id}.cost.json
 * for session resumption and budget monitoring.
 *
 * Claude Code pattern: costs tracked per canonical model name with cache
 * read/write separated. Restored on session resume.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { GORDON_DIR } from "../storage/paths.ts";
import { createModuleLogger } from "../logger/index.ts";
import { emitAlert } from "./observability/alertEmitter.ts";

async function emitCostAlert(args: {
  threshold: number;
  kind: "session" | "daily";
  total: number;
  limit: number;
  key: string;
}): Promise<void> {
  const level = args.threshold >= 0.9 ? "critical" : "warning";
  await emitAlert({
    level,
    category: "cost",
    message: `${args.kind === "session" ? "Session" : "Daily"} cost at ${(args.threshold * 100).toFixed(0)}% of $${args.limit.toFixed(2)} budget ($${args.total.toFixed(4)})`,
    context: { kind: args.kind, threshold: args.threshold, total: args.total, limit: args.limit },
    dedupeKey: `cost:${args.key}`,
  });
}

const costLogger = createModuleLogger("cost-budget");

// ============================================================================
// Cost Budget
// ============================================================================

/**
 * Cost budget enforcement. Wired into CostTracker.record() so every API call
 * triggers a check. Default thresholds emit warnings at 50 / 75 / 90% and
 * (when action="halt") block at 100% for the session and the day.
 */
export interface CostBudget {
  sessionUsd?: number;
  dailyUsd?: number;
  action: "warn" | "halt";
  warnThresholds: number[];
}

export interface CostBudgetCheck {
  withinBudget: boolean;
  sessionFraction?: number;
  dailyFraction?: number;
  warning?: string;
  halt?: boolean;
  reason?: string;
}

let activeBudget: CostBudget | null = null;
let dailyTotalUsd = 0;
let dailyDateKey = todayKey();
const warnedThresholds = new Set<string>();
let halted = false;

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function setCostBudget(budget: CostBudget | null): void {
  activeBudget = budget;
  warnedThresholds.clear();
  halted = false;
}

export function getCostBudget(): CostBudget | null {
  return activeBudget;
}

export function resetCostBudgetState(): void {
  warnedThresholds.clear();
  halted = false;
  dailyTotalUsd = 0;
  dailyDateKey = todayKey();
}

/**
 * Check whether the current cost is within budget. Called from
 * CostTracker.record() after each API call.
 *
 * Uses session totals AND a process-wide daily roll-up. The daily counter
 * resets when the date key changes.
 */
export function checkCostBudget(sessionTotalUsd: number, callCostUsd: number): CostBudgetCheck {
  if (!activeBudget) return { withinBudget: true };

  // Roll over daily counter if the date changed
  const today = todayKey();
  if (today !== dailyDateKey) {
    dailyDateKey = today;
    dailyTotalUsd = 0;
    warnedThresholds.clear();
  }
  dailyTotalUsd += callCostUsd;

  const result: CostBudgetCheck = { withinBudget: true };

  const sessionLimit = activeBudget.sessionUsd;
  const dailyLimit = activeBudget.dailyUsd;
  if (sessionLimit && sessionLimit > 0) {
    result.sessionFraction = sessionTotalUsd / sessionLimit;
  }
  if (dailyLimit && dailyLimit > 0) {
    result.dailyFraction = dailyTotalUsd / dailyLimit;
  }

  // Threshold warnings — fire each threshold once per scope
  for (const threshold of activeBudget.warnThresholds) {
    if (sessionLimit && (result.sessionFraction ?? 0) >= threshold) {
      const key = `session:${threshold}`;
      if (!warnedThresholds.has(key)) {
        warnedThresholds.add(key);
        result.warning = `Session cost at ${(threshold * 100).toFixed(0)}% of $${sessionLimit.toFixed(2)} budget ($${sessionTotalUsd.toFixed(4)})`;
        costLogger.warn(result.warning);
        void emitCostAlert({ threshold, kind: "session", total: sessionTotalUsd, limit: sessionLimit, key });
      }
    }
    if (dailyLimit && (result.dailyFraction ?? 0) >= threshold) {
      const key = `daily:${today}:${threshold}`;
      if (!warnedThresholds.has(key)) {
        warnedThresholds.add(key);
        result.warning = `Daily cost at ${(threshold * 100).toFixed(0)}% of $${dailyLimit.toFixed(2)} budget ($${dailyTotalUsd.toFixed(4)})`;
        costLogger.warn(result.warning);
        void emitCostAlert({ threshold, kind: "daily", total: dailyTotalUsd, limit: dailyLimit, key });
      }
    }
  }

  // Hard halt at 100% if action=halt
  if (activeBudget.action === "halt") {
    if (sessionLimit && (result.sessionFraction ?? 0) >= 1) {
      result.withinBudget = false;
      result.halt = true;
      result.reason = `Session cost ($${sessionTotalUsd.toFixed(4)}) exceeded budget ($${sessionLimit.toFixed(2)}). Use /cost reset to continue.`;
      halted = true;
    }
    if (dailyLimit && (result.dailyFraction ?? 0) >= 1) {
      result.withinBudget = false;
      result.halt = true;
      result.reason = `Daily cost ($${dailyTotalUsd.toFixed(4)}) exceeded budget ($${dailyLimit.toFixed(2)}). Resets at midnight UTC.`;
      halted = true;
    }
  }

  return result;
}

export function isCostHalted(): boolean {
  return halted;
}

export function clearCostHalt(): void {
  halted = false;
  warnedThresholds.clear();
}

export function getDailyCostUsd(): number {
  return dailyTotalUsd;
}

// ============================================================================
// Types
// ============================================================================

export interface ModelCostEntry {
  modelId: string;
  displayName: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  apiCalls: number;
  totalCostUsd: number;
}

export interface CostSnapshot {
  sessionId: string;
  startedAt: string;
  lastUpdatedAt: string;
  durationMs: number;
  models: Record<string, ModelCostEntry>;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  totalApiCalls: number;
}

// ============================================================================
// Pricing (per 1M tokens)
// ============================================================================

interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
  cacheReadPer1M: number;
  cacheWritePer1M: number;
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  // Anthropic
  "claude-opus-4-6":   { inputPer1M: 15.00, outputPer1M: 75.00, cacheReadPer1M: 1.50, cacheWritePer1M: 18.75 },
  "claude-sonnet-4-6": { inputPer1M: 3.00,  outputPer1M: 15.00, cacheReadPer1M: 0.30, cacheWritePer1M: 3.75 },
  "claude-haiku-4-5":  { inputPer1M: 1.00,  outputPer1M: 5.00,  cacheReadPer1M: 0.10, cacheWritePer1M: 1.25 },
  // OpenAI
  "gpt-5.4":           { inputPer1M: 3.00,  outputPer1M: 15.00, cacheReadPer1M: 0.30, cacheWritePer1M: 3.75 },
  "gpt-5.4-pro":       { inputPer1M: 3.00,  outputPer1M: 15.00, cacheReadPer1M: 0.30, cacheWritePer1M: 3.75 },
  "gpt-5.4-mini":      { inputPer1M: 0.75,  outputPer1M: 5.00,  cacheReadPer1M: 0.08, cacheWritePer1M: 0.94 },
  "gpt-5.4-nano":      { inputPer1M: 0.20,  outputPer1M: 1.00,  cacheReadPer1M: 0.02, cacheWritePer1M: 0.25 },
  // Inception
  "mercury-2":          { inputPer1M: 0.25,  outputPer1M: 0.75,  cacheReadPer1M: 0.025, cacheWritePer1M: 0.25 },
  "mercury-edit-2":     { inputPer1M: 0.25,  outputPer1M: 0.75,  cacheReadPer1M: 0.025, cacheWritePer1M: 0.25 },
};

const DEFAULT_PRICING: ModelPricing = { inputPer1M: 3.00, outputPer1M: 15.00, cacheReadPer1M: 0.30, cacheWritePer1M: 3.75 };

function getPricing(modelId: string): ModelPricing {
  // Try exact match, then prefix match
  if (MODEL_PRICING[modelId]) return MODEL_PRICING[modelId];
  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (modelId.startsWith(key) || modelId.includes(key)) return pricing;
  }
  return DEFAULT_PRICING;
}

function computeCost(pricing: ModelPricing, input: number, output: number, cacheRead: number, cacheWrite: number): number {
  return (
    (input * pricing.inputPer1M / 1_000_000) +
    (output * pricing.outputPer1M / 1_000_000) +
    (cacheRead * pricing.cacheReadPer1M / 1_000_000) +
    (cacheWrite * pricing.cacheWritePer1M / 1_000_000)
  );
}

// ============================================================================
// Tracker
// ============================================================================

export class CostTracker {
  private models = new Map<string, ModelCostEntry>();
  private sessionId: string;
  private startedAt: string;
  private startTime: number;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.startedAt = new Date().toISOString();
    this.startTime = Date.now();
  }

  /**
   * Record token usage from an API response.
   */
  record(params: {
    modelId: string;
    displayName?: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  }): ModelCostEntry {
    const { modelId, inputTokens, outputTokens } = params;
    const cacheRead = params.cacheReadTokens ?? 0;
    const cacheWrite = params.cacheWriteTokens ?? 0;

    let entry = this.models.get(modelId);
    if (!entry) {
      entry = {
        modelId,
        displayName: params.displayName ?? modelId,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        apiCalls: 0,
        totalCostUsd: 0,
      };
      this.models.set(modelId, entry);
    }

    const pricing = getPricing(modelId);
    const beforeCost = entry.totalCostUsd;

    entry.inputTokens += inputTokens;
    entry.outputTokens += outputTokens;
    entry.cacheReadTokens += cacheRead;
    entry.cacheWriteTokens += cacheWrite;
    entry.apiCalls++;

    entry.totalCostUsd = computeCost(
      pricing, entry.inputTokens, entry.outputTokens,
      entry.cacheReadTokens, entry.cacheWriteTokens,
    );

    // Budget check — runs after the call, doesn't block this call but flags
    // halts for the next one and emits warnings as thresholds cross.
    const sessionTotal = this.snapshot().totalCostUsd;
    const callCost = entry.totalCostUsd - beforeCost;
    checkCostBudget(sessionTotal, callCost);

    return entry;
  }

  /**
   * Get cost snapshot for display or persistence.
   */
  snapshot(): CostSnapshot {
    const models: Record<string, ModelCostEntry> = {};
    let totalInput = 0, totalOutput = 0, totalCost = 0, totalCalls = 0;

    for (const [id, entry] of this.models) {
      models[id] = { ...entry };
      totalInput += entry.inputTokens;
      totalOutput += entry.outputTokens;
      totalCost += entry.totalCostUsd;
      totalCalls += entry.apiCalls;
    }

    return {
      sessionId: this.sessionId,
      startedAt: this.startedAt,
      lastUpdatedAt: new Date().toISOString(),
      durationMs: Date.now() - this.startTime,
      models,
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      totalCostUsd: totalCost,
      totalApiCalls: totalCalls,
    };
  }

  /**
   * Format cost for terminal display.
   */
  formatDisplay(): string {
    const snap = this.snapshot();
    const lines: string[] = [];
    lines.push(`Session cost: $${snap.totalCostUsd.toFixed(4)} | ${snap.totalApiCalls} calls | ${Math.round(snap.durationMs / 1000)}s`);

    for (const entry of Object.values(snap.models)) {
      const pct = snap.totalCostUsd > 0 ? Math.round((entry.totalCostUsd / snap.totalCostUsd) * 100) : 0;
      lines.push(`  ${entry.displayName}: $${entry.totalCostUsd.toFixed(4)} (${pct}%) — ${entry.inputTokens.toLocaleString()}in/${entry.outputTokens.toLocaleString()}out`);
    }

    return lines.join("\n");
  }

  /**
   * Persist to disk.
   */
  save(): void {
    const dir = join(GORDON_DIR, "sessions");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const file = join(dir, `${this.sessionId}.cost.json`);
    writeFileSync(file, JSON.stringify(this.snapshot(), null, 2), { encoding: "utf-8", mode: 0o600 });
  }

  /**
   * Restore from a previous session.
   */
  static restore(sessionId: string): CostTracker | null {
    const file = join(GORDON_DIR, "sessions", `${sessionId}.cost.json`);
    if (!existsSync(file)) return null;
    try {
      const snap = JSON.parse(readFileSync(file, "utf-8")) as CostSnapshot;
      if (snap.sessionId !== sessionId) return null;

      const tracker = new CostTracker(sessionId);
      tracker.startedAt = snap.startedAt;
      for (const entry of Object.values(snap.models)) {
        tracker.models.set(entry.modelId, { ...entry });
      }
      return tracker;
    } catch {
      return null;
    }
  }
}

// ── Singleton ──

let instance: CostTracker | null = null;

export function getCostTracker(sessionId?: string): CostTracker {
  if (!instance && sessionId) instance = new CostTracker(sessionId);
  if (!instance) instance = new CostTracker(`session_${Date.now()}`);
  return instance;
}

export function resetCostTracker(): void {
  instance = null;
}
