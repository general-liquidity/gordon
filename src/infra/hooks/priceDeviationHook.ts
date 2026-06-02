/**
 * Built-in PreOrderPlacement hook: fat-finger / stale-quote price-deviation gate.
 *
 * Deterministic pre-placement sanity check. When the order carries both a
 * `limitPrice` and a `referencePrice` (mid / last / mark), it runs the pure
 * `checkPriceDeviation` primitive and translates the verdict into the hooks
 * engine's allow/block contract:
 *
 *   - verdict "block" (breach in the dangerous direction — buy far above /
 *     sell far below reference) → HookResult.action = "block".
 *   - verdict "warn"  (breach in the benign direction, or no side context) →
 *     "allow" with metadata.priceDeviation.requiresConfirmation = true so the
 *     orchestrator / TUI can surface an ask-confirm prompt. The engine has no
 *     native ask-confirm action, so we keep teeth only on the block path and
 *     leave benign breaches as a flagged-allow.
 *   - verdict "ok" or inputs missing → "allow".
 *
 * No-op (allow) when limitPrice or referencePrice is absent — market orders
 * and callers that don't pass a reference are unaffected (backward-compatible).
 *
 * NOT auto-registered. The orchestrator owns registration — see the note at
 * the bottom of this file.
 */

import type { HookDefinition, HookResult, PreOrderPlacementPayload } from "./types.ts";
import { checkPriceDeviation } from "../../core/alpha/price-deviation-guard.ts";

export const PRICE_DEVIATION_HOOK_ID = "builtin.price-deviation-guard";

/** Default tolerance (%) when the hook isn't constructed with an override. */
export const DEFAULT_PRICE_DEVIATION_THRESHOLD_PCT = 2;

/**
 * The exported hook handler. Pure aside from the primitive call — no I/O.
 * `thresholdPct` defaults to {@link DEFAULT_PRICE_DEVIATION_THRESHOLD_PCT}.
 */
export function priceDeviationHook(
  payload: PreOrderPlacementPayload,
  thresholdPct: number = DEFAULT_PRICE_DEVIATION_THRESHOLD_PCT,
): HookResult {
  const { limitPrice, referencePrice, side, symbol } = payload;

  // No limit price or no reference → nothing to compare; allow untouched.
  if (limitPrice == null || referencePrice == null) {
    return { action: "allow" };
  }

  const check = checkPriceDeviation({
    orderPrice: limitPrice,
    referencePrice,
    thresholdPct,
    side,
  });

  // Primitive returned null (non-positive / non-finite prices) → don't gate on
  // garbage; allow and let the downstream order layer reject malformed prices.
  if (check == null) {
    return { action: "allow" };
  }

  if (check.verdict === "block") {
    return {
      action: "block",
      reason: `${symbol}: ${check.interpretation}`,
      metadata: {
        priceDeviation: {
          verdict: check.verdict,
          deviationPct: check.deviationPct,
          limitPrice,
          referencePrice,
          thresholdPct,
        },
      },
    };
  }

  if (check.verdict === "warn") {
    return {
      action: "allow",
      metadata: {
        priceDeviation: {
          verdict: check.verdict,
          deviationPct: check.deviationPct,
          limitPrice,
          referencePrice,
          thresholdPct,
          requiresConfirmation: true,
          message: check.interpretation,
        },
      },
    };
  }

  return { action: "allow" };
}

/**
 * Convenience factory producing the full HookDefinition to hand to
 * `registerHook`. The orchestrator should register this once at startup:
 *
 *   import { registerHook } from "../hooks/index.ts";
 *   import { createPriceDeviationHookDefinition } from "../hooks/priceDeviationHook.ts";
 *   registerHook(createPriceDeviationHookDefinition());
 *
 * Optionally pass a calibrated threshold (e.g. wider for low-liquidity venues).
 */
export function createPriceDeviationHookDefinition(
  thresholdPct: number = DEFAULT_PRICE_DEVIATION_THRESHOLD_PCT,
): HookDefinition<"PreOrderPlacement"> {
  return {
    id: PRICE_DEVIATION_HOOK_ID,
    point: "PreOrderPlacement",
    // Run early — cheap deterministic gate, no reason to pay later hooks first.
    priority: 10,
    source: "builtin",
    statusMessage: "Checking order price vs live reference…",
    handler: (payload) => priceDeviationHook(payload, thresholdPct),
  };
}
