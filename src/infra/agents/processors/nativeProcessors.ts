/**
 * Gordon Native (Mastra-built-in) Processors
 *
 * Opt-in adapter that layers Mastra's built-in agent processors on top of
 * Gordon's existing safety stack. These COMPOSE WITH — they do not replace —
 * the regex `GordonInputGuard`, the orchestrator `guardrailEvaluator`, the
 * sovereign spend-gate, and the session cost budget (`costTracker`).
 *
 * Activated ONLY when `GORDON_MASTRA_PROCESSORS` is set. When the flag is
 * unset, both getters return `[]` and agent behavior is identical to today.
 *
 * Design choices (deliberate, to avoid double-enforcement / fighting the
 * existing guardrails):
 *  - PromptInjectionDetector / PIIDetector / ModerationProcessor run in
 *    `warn` mode (detect + log, never block/redact/rewrite). Hard enforcement
 *    stays with `GordonInputGuard` + `guardrailEvaluator`. The native layer
 *    adds LLM-based observability, not a second veto.
 *  - CostGuardProcessor mirrors the discoverable session cost budget from
 *    `costTracker.getCostBudget()` and also runs in `warn` mode — the existing
 *    `setCostBudget({ action: "halt" })` path remains the enforcer.
 */

import {
  BatchPartsProcessor,
  CostGuardProcessor,
  ModerationProcessor,
  PIIDetector,
  PromptInjectionDetector,
} from "@mastra/core/processors";
import { getFastMastraModel, type MastraModelConfig } from "../../runtime/providers/registry.ts";
import { getCostBudget } from "../../platform/costTracker.ts";
import { resolveFlag } from "../../config/flagResolver.ts";

/** True when the operator has opted into the native-processor layer. */
export function isNativeProcessorsEnabled(): boolean {
  const raw = process.env.GORDON_MASTRA_PROCESSORS?.toLowerCase();
  return raw === "1" || raw === "true";
}

/**
 * Model used by the LLM-based detection processors. A cheap/fast model is
 * appropriate for warn-mode detection; override via
 * `GORDON_MASTRA_PROCESSORS_MODEL`.
 */
function detectionModel(): MastraModelConfig {
  const override = process.env.GORDON_MASTRA_PROCESSORS_MODEL;
  if (override && override.length > 0) return override;
  return getFastMastraModel();
}

/**
 * Resolve the cost ceiling for the native CostGuardProcessor from Gordon's
 * discoverable session cost budget. Falls back to the raw env budget, then to
 * the same default (25) the bootstrap uses. Returns `undefined` when no
 * positive budget is discoverable, in which case the cost guard is omitted.
 */
export function discoverCostCeiling(): number | undefined {
  const budget = getCostBudget();
  if (budget?.sessionUsd !== undefined && budget.sessionUsd > 0) {
    return budget.sessionUsd;
  }
  const envRaw = resolveFlag("GORDON_COST_BUDGET_USD");
  if (envRaw !== undefined) {
    const parsed = Number(envRaw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

/**
 * Native INPUT processors, in the order they should run before the LLM call.
 * Empty unless the flag is set.
 */
export function getNativeInputProcessors(): Array<
  PromptInjectionDetector | PIIDetector | ModerationProcessor | CostGuardProcessor
> {
  if (!isNativeProcessorsEnabled()) return [];

  const model = detectionModel();
  const processors: Array<
    PromptInjectionDetector | PIIDetector | ModerationProcessor | CostGuardProcessor
  > = [
    new PromptInjectionDetector({
      model,
      strategy: "warn",
      lastMessageOnly: true,
      includeScores: true,
    }),
    new PIIDetector({
      model,
      strategy: "warn",
      lastMessageOnly: true,
      includeDetections: true,
    }),
    new ModerationProcessor({
      model,
      strategy: "warn",
      lastMessageOnly: true,
      includeScores: true,
    }),
  ];

  // CostGuard is only meaningful when a positive budget is discoverable, and
  // requires the Mastra instance to have observability storage configured
  // (throws at registration otherwise). Scoped per-thread to match a Gordon
  // session; warn-mode so it never double-aborts the existing halt budget.
  const ceiling = discoverCostCeiling();
  if (ceiling !== undefined) {
    processors.push(
      new CostGuardProcessor({
        maxCost: ceiling,
        scope: "thread",
        window: "24h",
        strategy: "warn",
      }),
    );
  }

  return processors;
}

/**
 * Native OUTPUT processors. The two hybrid detectors (PII, moderation) run on
 * the streamed output in warn mode, batched to reduce LLM calls. Empty unless
 * the flag is set.
 */
export function getNativeOutputProcessors(): Array<
  BatchPartsProcessor | PIIDetector | ModerationProcessor
> {
  if (!isNativeProcessorsEnabled()) return [];

  const model = detectionModel();
  return [
    new BatchPartsProcessor({ batchSize: 10 }),
    new PIIDetector({ model, strategy: "warn", includeDetections: true }),
    new ModerationProcessor({ model, strategy: "warn" }),
  ];
}
