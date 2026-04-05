import type { GordonConfig } from "../../types/index.ts";
import { getFastMastraModel, getMastraModel, type MastraModelConfig } from "../runtime/providers/registry.ts";
import type { GordonContext } from "./types.ts";
import type { LLMProvider } from "../llm/types.ts";

export type WorkflowPhase =
  | "scan"
  | "analysis"
  | "planning"
  | "execution"
  | "critique"
  | "compaction"
  | "ops";

const CRITIQUE_ACTION_HINTS = [
  "compare",
  "validate",
  "review",
  "diagnose",
  "decay",
  "health",
];

const EXECUTION_ACTION_IDS = new Set([
  "trading.market_order",
  "trading.place_market_order",
  "trading.execute_plan",
  "trading.cancel_order",
]);

const PLANNING_ACTION_IDS = new Set([
  "trading.plan",
  "trading.preview_market_order",
]);

export function determineWorkflowPhase(context: Pick<GordonContext, "requestedActionId" | "requestedTaskScope">): WorkflowPhase {
  const actionId = context.requestedActionId ?? "";

  if (EXECUTION_ACTION_IDS.has(actionId) || context.requestedTaskScope === "execution") {
    return "execution";
  }

  if (PLANNING_ACTION_IDS.has(actionId) || context.requestedTaskScope === "planning") {
    return "planning";
  }

  if (context.requestedTaskScope === "scan") {
    return "scan";
  }

  if (context.requestedTaskScope === "analysis") {
    return "analysis";
  }

  if (context.requestedTaskScope === "ops" || context.requestedTaskScope === "setup" || context.requestedTaskScope === "system") {
    return "ops";
  }

  if (CRITIQUE_ACTION_HINTS.some((hint) => actionId.includes(hint))) {
    return "critique";
  }

  return "analysis";
}

export function resolveModelForWorkflowPhase(
  config: GordonConfig,
  phase: WorkflowPhase,
): MastraModelConfig {
  switch (phase) {
    case "scan":
    case "ops":
    case "compaction":
      return getFastMastraModel();
    case "analysis":
    case "planning":
    case "execution":
    case "critique":
    default: {
      const provider = config.modelConfig?.provider ?? process.env.GORDON_PROVIDER;
      const model = config.modelConfig?.model ?? process.env.GORDON_MODEL;
      return getMastraModel(provider, model);
    }
  }
}

export function resolveLegacyModelRouteForWorkflowPhase(phase: WorkflowPhase): { provider: LLMProvider; model: string } {
  switch (phase) {
    case "compaction":
    case "scan":
    case "ops":
      if (process.env.DEDALUS_API_KEY) {
        return { provider: "dedalus", model: "google/gemini-3-flash-preview" };
      }
      if (process.env.OPENAI_API_KEY) {
        return { provider: "openai", model: "gpt-5.4" };
      }
      return { provider: "dedalus", model: "openai/gpt-5.2" };
    case "analysis":
    case "planning":
    case "execution":
    case "critique":
    default:
      if (process.env.DEDALUS_API_KEY) {
        return { provider: "dedalus", model: "openai/gpt-5.2" };
      }
      if (process.env.OPENAI_API_KEY) {
        return { provider: "openai", model: "gpt-5.4" };
      }
      return { provider: "dedalus", model: "openai/gpt-5.2" };
  }
}

export function getPhasePromptGuidance(phase: WorkflowPhase): string[] {
  switch (phase) {
    case "scan":
      return [
        "Prefer the shortest path to factual market coverage and ranked findings.",
        "Do not over-explain routine scan output unless the user asks for detail.",
      ];
    case "planning":
      return [
        "Stay in planning mode. Build and critique the plan before any live execution path.",
        "Call out blockers, sizing, and venue constraints before suggesting action.",
      ];
    case "execution":
      return [
        "Treat execution as a separate phase from planning.",
        "Only proceed with live-execution guidance when the plan is explicit, the venue is ready, and policy checks pass.",
      ];
    case "critique":
      return [
        "Challenge assumptions, compare alternatives, and surface edge decay or validation risks.",
      ];
    case "compaction":
      return [
        "Compress aggressively while preserving stable project truth and active operator state.",
      ];
    case "ops":
      return [
        "Be concrete and operational. Prefer status, settings, diagnostics, and exact next steps.",
      ];
    case "analysis":
    default:
      return [
        "Prefer direct evidence, venue-aware interpretation, and concise analytical conclusions.",
      ];
  }
}

export function isExecutionPhase(phase: WorkflowPhase): boolean {
  return phase === "execution";
}
