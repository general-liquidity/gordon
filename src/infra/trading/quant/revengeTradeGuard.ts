/**
 * Revenge-Trade Guard — D2.
 *
 * Druckenmiller calls it a "death sentence": putting on a big trade
 * just because you need to recover from a loss. This primitive detects
 * the pattern.
 *
 * A revenge trade is flagged when BOTH:
 *   1. The prior closed trade was a loss (priorTradePnL < 0)
 *   2. The currently-proposed plan size is materially larger than the
 *      strategy's baseline/average size (proposedSize / baselineSize
 *      ≥ sizeIncreaseThreshold, default 1.5)
 *
 * In informational mode (default), the result is a `flag` with
 * reasoning — the agent / operator decides. In active mode, the
 * result escalates to `block` and the caller is expected to refuse
 * the trade.
 *
 * Composes naturally with the existing anti-trap surface in
 * `src/infra/safety/anti-trap/` (`explainFirstMode`, `riskAcknowledgement`,
 * `supervisionRust`) and with `swing-mandate.ts`'s consecutive-losses
 * stop. Those are coarse-grained — this is the targeted detector for
 * the specific size-escalation pattern.
 *
 * Pedigree: Druckenmiller (multiple interviews). Counterpart to
 * hotStreakSizer (D1) which encodes the other half of his sizing
 * asymmetry — "bet big when hot, never bet big to get even."
 *
 * Advisory, not an enforcement gate: the only caller is the agent-callable
 * `evaluate_revenge_trade_guard` tool. No order path consults it, so there is
 * no operator flag for it — see docs/archived/harness-deferred-wiring.md (D2)
 * for what wiring it into the permission engine would take.
 *
 * Pure compute. No I/O.
 */

export type GuardMode = "informational" | "active";

export interface RevengeTradeGuardInput {
  /** Size of the currently-proposed plan (any consistent unit — USD notional, units, contracts). */
  proposedPlanSize: number;
  /** Baseline / average size for this strategy in the same unit. Must be > 0. */
  baselineSize: number;
  /**
   * P&L of the prior closed trade (negative = loss). Same unit as size or normalized;
   * sign is what matters, magnitude is reported back for context.
   */
  priorTradePnL: number;
  /**
   * Multiplier above baseline that triggers the guard. Default 1.5
   * (i.e. proposing ≥150% of baseline after a loss is flagged).
   */
  sizeIncreaseThreshold?: number;
  /**
   * "informational" (default) → flag + reasoning. "active" → block.
   */
  mode?: GuardMode;
}

export interface RevengeTradeGuardResult {
  sizeMultipleVsBaseline: number;
  priorTradeWasLoss: boolean;
  sizeAboveThreshold: boolean;
  revengeTradeDetected: boolean;
  mode: GuardMode;
  recommendedAction: "proceed" | "flag" | "block";
  reasoning: string;
}

const DEFAULT_THRESHOLD = 1.5;

export function evaluateRevengeTradeGuard(input: RevengeTradeGuardInput): RevengeTradeGuardResult {
  if (input.proposedPlanSize < 0) {
    throw new Error("proposedPlanSize must be ≥ 0");
  }
  if (input.baselineSize <= 0) {
    throw new Error("baselineSize must be > 0");
  }
  if (!Number.isFinite(input.priorTradePnL)) {
    throw new Error("priorTradePnL must be finite");
  }
  const threshold = input.sizeIncreaseThreshold ?? DEFAULT_THRESHOLD;
  if (threshold <= 1) {
    throw new Error(
      "sizeIncreaseThreshold must be > 1 (this guards against UPsizing, not downsizing)",
    );
  }
  const mode: GuardMode = input.mode ?? "informational";

  const sizeMultipleVsBaseline = input.proposedPlanSize / input.baselineSize;
  const priorTradeWasLoss = input.priorTradePnL < 0;
  const sizeAboveThreshold = sizeMultipleVsBaseline >= threshold;
  const revengeTradeDetected = priorTradeWasLoss && sizeAboveThreshold;

  let recommendedAction: RevengeTradeGuardResult["recommendedAction"];
  if (!revengeTradeDetected) {
    recommendedAction = "proceed";
  } else if (mode === "active") {
    recommendedAction = "block";
  } else {
    recommendedAction = "flag";
  }

  const reasoning =
    `proposed=${input.proposedPlanSize} vs baseline=${input.baselineSize} ` +
    `(×${sizeMultipleVsBaseline.toFixed(2)}, threshold ≥×${threshold}); ` +
    `prior P&L=${input.priorTradePnL} (loss=${priorTradeWasLoss}); ` +
    `revenge detected=${revengeTradeDetected}, mode=${mode} → ${recommendedAction}` +
    `${revengeTradeDetected ? " — Druckenmiller calls this a death sentence; size escalation after a loss is the fastest way to blow up." : "."}`;

  return {
    sizeMultipleVsBaseline,
    priorTradeWasLoss,
    sizeAboveThreshold,
    revengeTradeDetected,
    mode,
    recommendedAction,
    reasoning,
  };
}

export function revengeTradeGuardToPayload(
  result: RevengeTradeGuardResult,
): Record<string, unknown> {
  return {
    kind: "revenge_trade_guard.evaluated",
    sizeMultipleVsBaseline: Number(result.sizeMultipleVsBaseline.toFixed(4)),
    priorTradeWasLoss: result.priorTradeWasLoss,
    sizeAboveThreshold: result.sizeAboveThreshold,
    revengeTradeDetected: result.revengeTradeDetected,
    mode: result.mode,
    recommendedAction: result.recommendedAction,
  };
}
