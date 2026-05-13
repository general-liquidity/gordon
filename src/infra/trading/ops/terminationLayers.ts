/**
 * Three-Layer Termination (GORDON_TERMINATION_LAYERS).
 *
 * Ports L09 + L10 from learn-harness-engineering — explicit three-layer
 * gate before a trade is considered "done." Skipping a layer = not done.
 *
 *   Layer 1 (pre-trade syntax/static):
 *     Risk classifier verdict + constitution check + mandate-scope check.
 *     Already wired across Gordon; this module aggregates the verdicts
 *     into a single structured pass/fail.
 *
 *   Layer 2 (runtime behavior):
 *     Order submitted, ack received within timeout, no broker reject.
 *     Today this lives ad-hoc inside execute_plan; aggregating here.
 *
 *   Layer 3 (system-level confirmation):
 *     Post-fill reconciliation: fill price within slippage tolerance,
 *     position matches expected size, audit-log entry exists.
 *
 * Each layer produces a `LayerResult` with a verdict and — critically
 * for L10's "red-pen markup" pattern — a `fixInstruction` field when
 * it fails. Error messages aren't just "X went wrong" — they include
 * the specific next step the agent should take. This turns failures
 * into self-correcting feedback loops.
 *
 * The module does NOT itself enforce the gate. Callers (execute_plan,
 * reconciliation worker) call into the relevant layer's `check*`
 * function and decide whether to proceed. Gating behavior is up to
 * the caller, which keeps this module testable and reusable.
 */

export type LayerStatus = "pass" | "fail" | "skip";

export interface LayerResult {
  layer: 1 | 2 | 3;
  name: string;
  status: LayerStatus;
  message: string;
  /**
   * When status === "fail", concrete next step. Following L10's
   * pattern: not just "X violated" but "X violated. To fix: do Y."
   */
  fixInstruction?: string;
  /** Evidence references — IDs of structured observations, etc. */
  evidence?: string[];
}

export interface TerminationResult {
  /** Highest layer reached. Subsequent layers are "skip" until earlier passes. */
  highestLayer: 1 | 2 | 3;
  /** Overall verdict: pass only if all attempted layers passed. */
  verdict: "pass" | "fail" | "partial";
  layers: [LayerResult, LayerResult, LayerResult];
  /** Composite next-step for the operator, derived from failing layers. */
  blockingFixInstruction?: string;
}

export function isTerminationLayersEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    env.GORDON_TERMINATION_LAYERS === "1" ||
    env.GORDON_TERMINATION_LAYERS === "true"
  );
}

// ============================================================================
// Layer 1 — pre-trade syntax/static
// ============================================================================

export interface PreTradeInput {
  /** From riskClassifier: tier and whether any hard rule blocks the trade. */
  riskTier: "low" | "medium" | "high" | "critical";
  riskClassifierVerdict: "auto_approve" | "prompt_user" | "require_confirmation" | "block";
  /** From tradingConstitution: list of violations, empty = ok. */
  constitutionViolations: string[];
  /** From strategyMandates/tradingUniverse: scope ok? Null = no mandate active. */
  mandateScopeOk: boolean | null;
  /** Optional thesis-coherence verdict. */
  thesisCoherenceOk: boolean | null;
}

export function checkPreTrade(input: PreTradeInput): LayerResult {
  const fails: string[] = [];
  const fixes: string[] = [];

  if (input.riskClassifierVerdict === "block") {
    fails.push("risk classifier returned block");
    fixes.push("Review the riskClassifier dimensions that pushed the score over threshold; adjust position size or cancel the plan.");
  }
  if (input.constitutionViolations.length > 0) {
    fails.push(`${input.constitutionViolations.length} constitution violation(s)`);
    fixes.push(`Resolve constitution violations: ${input.constitutionViolations.slice(0, 3).join("; ")}.`);
  }
  if (input.mandateScopeOk === false) {
    fails.push("mandate scope violation");
    fixes.push("The trade falls outside the active strategy mandate; switch mandates or stay in-scope.");
  }
  if (input.thesisCoherenceOk === false) {
    fails.push("thesis coherence below threshold");
    fixes.push("Trade direction contradicts the running thesis; update the thesis or skip.");
  }

  if (fails.length === 0) {
    return {
      layer: 1,
      name: "pre-trade",
      status: "pass",
      message: `Pre-trade checks pass (tier=${input.riskTier}, classifier=${input.riskClassifierVerdict}).`,
    };
  }

  return {
    layer: 1,
    name: "pre-trade",
    status: "fail",
    message: `Pre-trade gate blocks execution: ${fails.join("; ")}.`,
    fixInstruction: fixes.join(" "),
  };
}

// ============================================================================
// Layer 2 — runtime behavior
// ============================================================================

export interface RuntimeInput {
  /** Order id returned by the broker, or null if submission failed. */
  orderId: string | null;
  /** Broker ack received? */
  ackReceived: boolean;
  /** Time to ack in ms; null if no ack. */
  ackLatencyMs: number | null;
  /** Configured timeout for acks. */
  ackTimeoutMs: number;
  /** Broker-reported error/reject reason if any. */
  brokerRejectReason: string | null;
}

export function checkRuntime(input: RuntimeInput): LayerResult {
  if (input.brokerRejectReason) {
    return {
      layer: 2,
      name: "runtime",
      status: "fail",
      message: `Broker rejected order: ${input.brokerRejectReason}.`,
      fixInstruction:
        `Inspect the broker's reject reason and either adjust order parameters (size, price band, time-in-force) or cancel. ` +
        `Do not retry blindly — the next attempt will likely fail the same way.`,
    };
  }
  if (!input.orderId) {
    return {
      layer: 2,
      name: "runtime",
      status: "fail",
      message: "Order submission returned no order ID.",
      fixInstruction:
        `The broker accepted the request but did not return an ID. Check broker connectivity, ` +
        `rate limits, and credential validity before retrying.`,
    };
  }
  if (!input.ackReceived) {
    return {
      layer: 2,
      name: "runtime",
      status: "fail",
      message: `No broker acknowledgement within ${input.ackTimeoutMs}ms.`,
      fixInstruction:
        `The order may have been placed but no ack arrived. Query order status by ID before retrying — ` +
        `a blind retry risks a duplicate fill.`,
    };
  }
  if (input.ackLatencyMs !== null && input.ackLatencyMs > input.ackTimeoutMs) {
    return {
      layer: 2,
      name: "runtime",
      status: "fail",
      message: `Ack arrived after timeout (${input.ackLatencyMs}ms > ${input.ackTimeoutMs}ms).`,
      fixInstruction:
        `Ack latency exceeded the configured timeout budget. Raise the timeout or investigate broker connectivity.`,
    };
  }
  return {
    layer: 2,
    name: "runtime",
    status: "pass",
    message: `Order ${input.orderId} acked in ${input.ackLatencyMs ?? "?"}ms.`,
  };
}

// ============================================================================
// Layer 3 — system-level confirmation
// ============================================================================

export interface SystemConfirmationInput {
  /** Expected fill price; null if market order without a target. */
  expectedFillPrice: number | null;
  /** Actual fill price reported by the broker. */
  actualFillPrice: number | null;
  /** Acceptable slippage as a fraction (e.g. 0.005 = 50bps). */
  maxSlippageFraction: number;
  /** Expected position size after fill. */
  expectedSize: number;
  /** Actual position size reconciled from broker. */
  actualSize: number;
  /** Audit log entry ID linked to this trade, null if missing. */
  auditLogEntryId: string | null;
}

export function checkSystemConfirmation(input: SystemConfirmationInput): LayerResult {
  const fails: string[] = [];
  const fixes: string[] = [];
  const evidence: string[] = [];

  if (input.auditLogEntryId) {
    evidence.push(input.auditLogEntryId);
  } else {
    fails.push("no audit-log entry");
    fixes.push("Emit an action-log entry for this trade before marking complete.");
  }

  if (input.actualFillPrice === null) {
    fails.push("no actual fill price reported");
    fixes.push("Reconciliation must capture the actual fill price from the broker.");
  } else if (input.expectedFillPrice !== null && input.expectedFillPrice > 0) {
    const slippage = Math.abs(input.actualFillPrice - input.expectedFillPrice) / input.expectedFillPrice;
    if (slippage > input.maxSlippageFraction) {
      fails.push(`slippage ${(slippage * 100).toFixed(2)}% exceeds tolerance ${(input.maxSlippageFraction * 100).toFixed(2)}%`);
      fixes.push(`Fill slipped beyond tolerance. Investigate (likely thin book or rapid market move) and consider tightening the price band on retries.`);
    }
  }

  if (Math.abs(input.actualSize - input.expectedSize) > Math.max(1e-9, Math.abs(input.expectedSize) * 0.001)) {
    fails.push(`size mismatch: expected ${input.expectedSize}, got ${input.actualSize}`);
    fixes.push(`Partial or oversized fill. Reconcile position manually before continuing.`);
  }

  if (fails.length === 0) {
    return {
      layer: 3,
      name: "system",
      status: "pass",
      message: `System confirmation passed (fill ${input.actualFillPrice ?? "?"} for size ${input.actualSize}).`,
      evidence,
    };
  }

  return {
    layer: 3,
    name: "system",
    status: "fail",
    message: `System confirmation failed: ${fails.join("; ")}.`,
    fixInstruction: fixes.join(" "),
    evidence,
  };
}

// ============================================================================
// Composite — run all layers
// ============================================================================

export interface TerminationCheckInput {
  preTrade: PreTradeInput;
  runtime: RuntimeInput | null;
  system: SystemConfirmationInput | null;
}

/**
 * Run all three layers. Layer N only runs if all earlier layers passed.
 * Missing later-layer inputs are recorded as `skip`, not failure — the
 * caller's responsibility is to make sure to supply each layer's input
 * once it has the data.
 */
export function runTerminationLayers(input: TerminationCheckInput): TerminationResult {
  const layer1 = checkPreTrade(input.preTrade);
  let layer2: LayerResult;
  let layer3: LayerResult;
  let highest: 1 | 2 | 3 = 1;

  if (layer1.status !== "pass") {
    layer2 = { layer: 2, name: "runtime", status: "skip", message: "Skipped — layer 1 did not pass." };
    layer3 = { layer: 3, name: "system", status: "skip", message: "Skipped — layer 1 did not pass." };
  } else if (!input.runtime) {
    layer2 = { layer: 2, name: "runtime", status: "skip", message: "Skipped — runtime input not provided yet." };
    layer3 = { layer: 3, name: "system", status: "skip", message: "Skipped — depends on layer 2." };
  } else {
    layer2 = checkRuntime(input.runtime);
    if (layer2.status === "pass") highest = 2;
    if (layer2.status !== "pass" || !input.system) {
      layer3 = {
        layer: 3,
        name: "system",
        status: "skip",
        message: layer2.status !== "pass"
          ? "Skipped — layer 2 did not pass."
          : "Skipped — system input not provided yet.",
      };
    } else {
      layer3 = checkSystemConfirmation(input.system);
      if (layer3.status === "pass") highest = 3;
    }
  }

  const layers: TerminationResult["layers"] = [layer1, layer2, layer3];
  const anyFailed = layers.some((l) => l.status === "fail");
  const allPassed = layers.every((l) => l.status === "pass");
  const verdict: TerminationResult["verdict"] = allPassed ? "pass" : anyFailed ? "fail" : "partial";

  const blockingFix = layers
    .filter((l) => l.status === "fail" && l.fixInstruction)
    .map((l) => `[L${l.layer}] ${l.fixInstruction}`)
    .join(" ");

  return {
    highestLayer: highest,
    verdict,
    layers,
    blockingFixInstruction: blockingFix || undefined,
  };
}

export function terminationToPayload(result: TerminationResult): Record<string, unknown> {
  return {
    kind: "termination.layers_recorded",
    highestLayer: result.highestLayer,
    verdict: result.verdict,
    layers: result.layers.map((l) => ({
      layer: l.layer,
      name: l.name,
      status: l.status,
      message: l.message,
      fixInstruction: l.fixInstruction,
      evidence: l.evidence,
    })),
    blockingFixInstruction: result.blockingFixInstruction,
  };
}
