/**
 * k-run producer (Phase 4) — runs the same scenario k times inside a
 * sandbox and aggregates pass^k over deterministic process checks.
 */

import { checkTrajectory } from "../process/processChecks.ts";
import type { ProcessCheckResult } from "../process/processChecks.ts";
import type { NormalizedTrace } from "../process/processChecks.ts";
import { passKFromChecks } from "../process/passK.ts";
import type { PassKResult } from "../process/passK.ts";
import type { EvalScenario, EvalTrajectory } from "../types.ts";
import type { EvalSandbox } from "./sandbox.ts";
import { runScenarioLive } from "./runner.ts";

export interface ProduceKRunsInput {
  scenario: EvalScenario;
  k: number;
  sandbox?: EvalSandbox;
  dryRun?: boolean;
  variantLabel?: string;
}

export interface ProduceKRunsResult {
  trajectories: EvalTrajectory[];
  normalizedTraces: NormalizedTrace[];
  processResults: ProcessCheckResult[];
  passKResult: PassKResult;
}

function isSafetyScenario(scenario: EvalScenario): boolean {
  return (
    scenario.tags.includes("adversarial") || (scenario.derivedFrom ?? "").startsWith("denylist:")
  );
}

export async function produceKRuns(input: ProduceKRunsInput): Promise<ProduceKRunsResult> {
  const k = Math.max(1, input.k);
  const variantLabel = input.variantLabel ?? "eval-k-run";
  const trajectories: EvalTrajectory[] = [];
  const normalizedTraces: NormalizedTrace[] = [];
  const processResults: ProcessCheckResult[] = [];

  for (let i = 0; i < k; i++) {
    const threadId = `eval-k-${input.scenario.id}-${i}`;
    const { trajectory, normalized } = await runScenarioLive(input.scenario, {
      sandbox: input.sandbox,
      dryRun: input.dryRun,
      variantLabel,
      threadId,
    });
    trajectories.push(trajectory);
    normalizedTraces.push(normalized);
    processResults.push(checkTrajectory(normalized));
  }

  const passKResult = passKFromChecks(
    processResults,
    isSafetyScenario(input.scenario) ? { mode: "all" } : {},
  );

  return { trajectories, normalizedTraces, processResults, passKResult };
}
