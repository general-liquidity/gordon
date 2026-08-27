/**
 * Auto-Rebalance Cycle — Trading Equivalent of Auto-Fix PR
 *
 * Claude Code: lint → fix → test → commit → PR
 * Gordon:      detect drift → propose rebalance → risk-check → approve → execute → verify
 *
 * Orchestrates the full rebalance lifecycle as a pipeline of discrete steps,
 * each with its own success/failure/retry semantics.
 */

import type { PortfolioDiff } from "./portfolioDiff.ts";

// ============================================================================
// Types
// ============================================================================

export type RebalanceStepId =
  | "detect_drift"
  | "compute_target"
  | "generate_trades"
  | "risk_check"
  | "approval"
  | "execute"
  | "verify";

export type StepStatus = "pending" | "running" | "success" | "failed" | "skipped";

export interface RebalanceStep {
  id: RebalanceStepId;
  label: string;
  status: StepStatus;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  result?: unknown;
  error?: string;
}

export interface DriftDetection {
  /** Positions that have drifted beyond threshold. */
  driftedPositions: Array<{
    symbol: string;
    targetWeightPct: number;
    actualWeightPct: number;
    driftPct: number;
  }>;
  /** Total portfolio drift (sum of absolute deviations). */
  totalDriftPct: number;
  /** Whether drift exceeds the rebalance threshold. */
  needsRebalance: boolean;
}

export interface RebalanceProposal {
  /** Target allocation. */
  targetAllocations: Array<{
    symbol: string;
    targetWeightPct: number;
    currentWeightPct: number;
    action: "buy" | "sell" | "hold";
    tradeNotionalUsd: number;
  }>;
  /** Portfolio diff. */
  diff: PortfolioDiff;
  /** Estimated total fees. */
  estimatedFeesUsd: number;
  /** Estimated tax impact (if applicable). */
  estimatedTaxImpact?: number;
}

export interface RebalanceCycle {
  id: string;
  createdAt: string;
  status: "running" | "completed" | "failed" | "cancelled";
  steps: RebalanceStep[];
  drift?: DriftDetection;
  proposal?: RebalanceProposal;
  /** Step where the cycle stopped (if failed/cancelled). */
  stoppedAt?: RebalanceStepId;
  /** Total duration. */
  totalDurationMs?: number;
}

export interface RebalanceConfig {
  /** Minimum drift % before triggering rebalance. Default 5%. */
  driftThresholdPct: number;
  /** Target allocations by symbol (must sum to 100). */
  targetAllocations: Record<string, number>;
  /** Auto-approve if total trade notional is below this. Default $1000. */
  autoApproveThresholdUsd: number;
  /** Skip risk check for small rebalances. Default true. */
  skipRiskCheckForSmall: boolean;
  /** Max slippage tolerance. Default 0.5%. */
  maxSlippagePct: number;
}

export const DEFAULT_REBALANCE_CONFIG: RebalanceConfig = {
  driftThresholdPct: 5,
  targetAllocations: {},
  autoApproveThresholdUsd: 1000,
  skipRiskCheckForSmall: true,
  maxSlippagePct: 0.5,
};

// ============================================================================
// Pipeline
// ============================================================================

/**
 * Create a new rebalance cycle with all steps initialized.
 */
export function createRebalanceCycle(): RebalanceCycle {
  const steps: RebalanceStep[] = [
    { id: "detect_drift", label: "Detect portfolio drift", status: "pending" },
    { id: "compute_target", label: "Compute target allocations", status: "pending" },
    { id: "generate_trades", label: "Generate rebalance trades", status: "pending" },
    { id: "risk_check", label: "Risk assessment", status: "pending" },
    { id: "approval", label: "User approval", status: "pending" },
    { id: "execute", label: "Execute trades", status: "pending" },
    { id: "verify", label: "Verify execution", status: "pending" },
  ];

  return {
    id: `rebal_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    createdAt: new Date().toISOString(),
    status: "running",
    steps,
  };
}

/**
 * Start a step in the cycle.
 */
export function startStep(cycle: RebalanceCycle, stepId: RebalanceStepId): RebalanceStep {
  const step = cycle.steps.find((s) => s.id === stepId);
  if (!step) throw new Error(`Unknown step: ${stepId}`);
  step.status = "running";
  step.startedAt = new Date().toISOString();
  return step;
}

/**
 * Complete a step successfully.
 */
export function completeStep(
  cycle: RebalanceCycle,
  stepId: RebalanceStepId,
  result?: unknown,
): void {
  const step = cycle.steps.find((s) => s.id === stepId);
  if (!step) return;
  step.status = "success";
  step.completedAt = new Date().toISOString();
  step.durationMs = step.startedAt ? Date.now() - new Date(step.startedAt).getTime() : 0;
  step.result = result;
}

/**
 * Fail a step and stop the cycle.
 */
export function failStep(cycle: RebalanceCycle, stepId: RebalanceStepId, error: string): void {
  const step = cycle.steps.find((s) => s.id === stepId);
  if (!step) return;
  step.status = "failed";
  step.completedAt = new Date().toISOString();
  step.durationMs = step.startedAt ? Date.now() - new Date(step.startedAt).getTime() : 0;
  step.error = error;
  cycle.status = "failed";
  cycle.stoppedAt = stepId;

  // Skip remaining steps
  for (const s of cycle.steps) {
    if (s.status === "pending") s.status = "skipped";
  }
}

/**
 * Cancel the cycle (user abort).
 */
export function cancelCycle(cycle: RebalanceCycle): void {
  cycle.status = "cancelled";
  const running = cycle.steps.find((s) => s.status === "running");
  if (running) {
    cycle.stoppedAt = running.id;
    running.status = "failed";
    running.error = "Cancelled by user";
  }
  for (const s of cycle.steps) {
    if (s.status === "pending") s.status = "skipped";
  }
}

/**
 * Complete the cycle.
 */
export function completeCycle(cycle: RebalanceCycle): void {
  cycle.status = "completed";
  cycle.totalDurationMs = cycle.steps
    .filter((s) => s.durationMs)
    .reduce((sum, s) => sum + (s.durationMs ?? 0), 0);
}

/**
 * Detect drift between current and target allocations.
 */
export function detectDrift(
  currentAllocations: Record<string, number>,
  targetAllocations: Record<string, number>,
  thresholdPct: number = 5,
): DriftDetection {
  const allSymbols = new Set([
    ...Object.keys(currentAllocations),
    ...Object.keys(targetAllocations),
  ]);
  const drifted: DriftDetection["driftedPositions"] = [];
  let totalDrift = 0;

  for (const symbol of allSymbols) {
    const current = currentAllocations[symbol] ?? 0;
    const target = targetAllocations[symbol] ?? 0;
    const drift = Math.abs(current - target);
    totalDrift += drift;

    if (drift > thresholdPct) {
      drifted.push({
        symbol,
        targetWeightPct: target,
        actualWeightPct: current,
        driftPct: drift,
      });
    }
  }

  return {
    driftedPositions: drifted.sort((a, b) => b.driftPct - a.driftPct),
    totalDriftPct: totalDrift,
    needsRebalance: drifted.length > 0,
  };
}

/**
 * Format cycle status for terminal display.
 */
export function formatCycleStatus(cycle: RebalanceCycle): string {
  const lines: string[] = [];
  lines.push(`Rebalance Cycle: ${cycle.id} [${cycle.status.toUpperCase()}]`);

  for (const step of cycle.steps) {
    const icon =
      step.status === "success"
        ? "✓"
        : step.status === "failed"
          ? "✗"
          : step.status === "running"
            ? "●"
            : step.status === "skipped"
              ? "○"
              : "·";
    const time = step.durationMs ? ` (${(step.durationMs / 1000).toFixed(1)}s)` : "";
    const err = step.error ? ` — ${step.error}` : "";
    lines.push(`  ${icon} ${step.label}${time}${err}`);
  }

  if (cycle.totalDurationMs) {
    lines.push(`  Total: ${(cycle.totalDurationMs / 1000).toFixed(1)}s`);
  }

  return lines.join("\n");
}
