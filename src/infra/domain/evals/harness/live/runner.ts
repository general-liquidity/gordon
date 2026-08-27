/**
 * Live eval runner (Phase 4) — generates trajectories by driving Gordon
 * inside an eval sandbox, then feeds them into the existing judge pipeline.
 *
 * dryRun mode synthesizes deterministic trajectories from scenario metadata
 * (no LLM, no side effects) for CI and unit tests. Live mode calls
 * processMessage with a paper-mode context and captures audit traces when
 * available, falling back to response-text-only trajectories.
 */

import { randomUUID } from "node:crypto";

import { processMessage } from "../../../../agents/orchestrator.ts";
import type { GordonContext } from "../../../../agents/types.ts";
import type { Message } from "../../../../ai/llm/types.ts";
import { runEvalSuite } from "../runner.ts";
import type { RunSuiteInput, RunSuiteResult, RunVariantInput } from "../runner.ts";
import type { JudgeOptions } from "../trajectoryJudge.ts";
import type { PanelJudgeOptions } from "../panelJudge.ts";
import type { EvalScenario, EvalTrajectory } from "../types.ts";
import type { NormalizedTrace, NormalizedToolCall } from "../process/processChecks.ts";
import { auditTraceToNormalized, auditTraceToTrajectory } from "../traces/traceAdapter.ts";
import { buildPaperContext, EVAL_DRY_RUN_ENV, type EvalSandbox } from "./sandbox.ts";

export interface RunScenarioLiveOptions {
  sandbox?: EvalSandbox;
  dryRun?: boolean;
  variantLabel?: string;
  threadId?: string;
  context?: GordonContext;
}

export interface ScenarioLiveResult {
  trajectory: EvalTrajectory;
  normalized: NormalizedTrace;
}

export interface LiveVariantInput {
  variantLabel: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface RunLiveEvalSuiteInput {
  scenarios: ReadonlyArray<EvalScenario>;
  variants: ReadonlyArray<LiveVariantInput>;
  sandbox?: EvalSandbox;
  dryRun?: boolean;
  judgeOptions?: JudgeOptions;
  panelOptions?: PanelJudgeOptions;
}

function isSafetyScenario(scenario: EvalScenario): boolean {
  return (
    scenario.tags.includes("adversarial") || (scenario.derivedFrom ?? "").startsWith("denylist:")
  );
}

function isExecutionLike(scenario: EvalScenario): boolean {
  return (
    scenario.category === "execution" ||
    /\b(order|trade|execute|buy|sell|withdraw|transfer)\b/i.test(scenario.userInput)
  );
}

function synthesizeDryRunTrace(
  scenario: EvalScenario,
  variantLabel: string,
  threadId: string,
): ScenarioLiveResult {
  const toolCalls: NormalizedToolCall[] = [];
  let order = 0;
  const add = (name: string) => toolCalls.push({ name, ok: true, order: order++ });

  const safety = isSafetyScenario(scenario);
  const executionLike = isExecutionLike(scenario);

  if (safety) {
    add("get_market_data");
  } else if (executionLike) {
    add("classify_trade_risk");
    if (scenario.tags.includes("plan-card") || scenario.userInput.toLowerCase().includes("plan")) {
      add("approve_plan");
    }
  } else {
    add("get_market_data");
    if (scenario.category === "analysis" || scenario.category === "scan") {
      add("compute_indicator");
    }
  }

  const assistant = safety
    ? `[${variantLabel}] Refusing unsafe action. Policy requires human approval and risk gating before any fund-moving or order tool.`
    : `[${variantLabel}] Dry-run analysis for ${scenario.id}: completed read-only / gated checks without live execution.`;

  const messages: Message[] = [
    { role: "system", content: scenario.systemPrompt },
    { role: "user", content: scenario.userInput },
    { role: "assistant", content: assistant },
  ];

  const outcomeType = safety
    ? "trade_rejected"
    : executionLike
      ? "analysis_complete"
      : "analysis_complete";

  return {
    trajectory: {
      id: variantLabel,
      messages,
      metadata: {
        mode: "dry-run",
        threadId,
        scenarioId: scenario.id,
        toolCalls: toolCalls.map((t) => t.name).join(","),
      },
    },
    normalized: {
      toolCalls,
      outcomeType,
      agentId: "eval-dry-run",
    },
  };
}

function responseOnlyTrajectory(
  scenario: EvalScenario,
  variantLabel: string,
  response: string,
  threadId: string,
  auditCapture: boolean,
): ScenarioLiveResult {
  return {
    trajectory: {
      id: variantLabel,
      messages: [
        { role: "system", content: scenario.systemPrompt },
        { role: "user", content: scenario.userInput },
        { role: "assistant", content: response },
      ],
      metadata: { mode: "live", threadId, scenarioId: scenario.id, auditCapture },
    },
    normalized: { toolCalls: [], outcomeType: "analysis_complete" },
  };
}

async function captureFromAudit(
  scenario: EvalScenario,
  variantLabel: string,
  response: string,
  threadId: string,
): Promise<ScenarioLiveResult> {
  try {
    const { getRecentTraces } = await import("../../../../../core/audit/store.ts");
    const traces = getRecentTraces(8);
    const snippet = scenario.userInput.slice(0, 40);
    const match = traces.find((t) => t.trigger.payload_summary.includes(snippet)) ?? traces[0];
    if (!match) {
      return responseOnlyTrajectory(scenario, variantLabel, response, threadId, false);
    }
    return {
      trajectory: auditTraceToTrajectory(match, variantLabel),
      normalized: auditTraceToNormalized(match),
    };
  } catch {
    return responseOnlyTrajectory(scenario, variantLabel, response, threadId, false);
  }
}

export async function runScenarioLive(
  scenario: EvalScenario,
  opts: RunScenarioLiveOptions = {},
): Promise<ScenarioLiveResult> {
  const dryRun = opts.dryRun ?? process.env[EVAL_DRY_RUN_ENV] === "1";
  const variantLabel = opts.variantLabel ?? "eval-live";
  const threadId = opts.threadId ?? `eval-${scenario.id}-${randomUUID()}`;

  if (dryRun) {
    return synthesizeDryRunTrace(scenario, variantLabel, threadId);
  }

  const sandbox = opts.sandbox;
  const context =
    opts.context ??
    (sandbox ? buildPaperContext(sandbox, { threadId, userId: "eval-user" }) : undefined);

  if (!context) {
    throw new Error(
      "runScenarioLive in live mode requires opts.sandbox or opts.context to avoid polluting production state.",
    );
  }

  const { response } = await processMessage(scenario.userInput, context, threadId, context.userId);
  return captureFromAudit(scenario, variantLabel, response, threadId);
}

export async function runVariantLive(
  variantLabel: string,
  scenarios: ReadonlyArray<EvalScenario>,
  opts: RunScenarioLiveOptions = {},
): Promise<Map<string, EvalTrajectory>> {
  const map = new Map<string, EvalTrajectory>();
  for (const scenario of scenarios) {
    const result = await runScenarioLive(scenario, {
      ...opts,
      variantLabel,
      threadId: opts.threadId ?? `eval-${variantLabel}-${scenario.id}-${randomUUID()}`,
    });
    map.set(scenario.id, {
      ...result.trajectory,
      id: variantLabel,
      metadata: { ...result.trajectory.metadata, variantLabel },
    });
  }
  return map;
}

export async function runLiveEvalSuite(input: RunLiveEvalSuiteInput): Promise<RunSuiteResult> {
  const dryRun = input.dryRun ?? process.env[EVAL_DRY_RUN_ENV] === "1";
  const variants: RunVariantInput[] = [];

  for (const variant of input.variants) {
    const trajectoriesByScenario = await runVariantLive(variant.variantLabel, input.scenarios, {
      sandbox: input.sandbox,
      dryRun,
    });
    for (const [scenarioId, traj] of trajectoriesByScenario) {
      if (variant.metadata) {
        trajectoriesByScenario.set(scenarioId, {
          ...traj,
          metadata: { ...traj.metadata, ...variant.metadata },
        });
      }
    }
    variants.push({ variantLabel: variant.variantLabel, trajectoriesByScenario });
  }

  const suiteInput: RunSuiteInput = {
    scenarios: input.scenarios,
    variants,
    ...(input.judgeOptions !== undefined && { judgeOptions: input.judgeOptions }),
    ...(input.panelOptions !== undefined && { panelOptions: input.panelOptions }),
  };
  return runEvalSuite(suiteInput);
}
