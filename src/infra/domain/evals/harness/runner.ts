/**
 * Eval Runner — orchestrates scenarios → trajectories → judge → scores.
 *
 * The runner is *trajectory-agnostic*: callers supply pre-recorded
 * trajectories per variant per scenario. The runner doesn't drive
 * Mastra agent.generate() — that wiring is deferred (see the
 * Mastra runtime integration backlog).
 *
 * Why no auto-generation today: invoking Gordon's full orchestrator
 * during an eval has side effects (tool calls hit live exchanges,
 * audit log gets stamped, trust trajectory updates). For a clean
 * eval harness, callers record trajectories ahead of time (manual
 * runs, paper-mode captures, or fixture files) and feed them in.
 *
 * Once eval coverage is trusted, a follow-up commit can add an
 * auto-runner that spawns a sandboxed Gordon instance per variant.
 */

import { judgeTrajectories } from "./trajectoryJudge.ts";
import type { JudgeOptions } from "./trajectoryJudge.ts";
import type { EvalScenario, EvalTrajectory, VariantRunResult } from "./types.ts";

export interface RunVariantInput {
  /** Stable label for this variant — used in reports + regression diffs. */
  variantLabel: string;
  /**
   * Trajectories keyed by scenario id. Each entry is one trajectory
   * (one assistant response sequence) the variant produced for that
   * scenario.
   *
   * For each scenario in the suite, the variant must contribute at
   * least one trajectory; scenarios without a trajectory are skipped
   * and surface as a warning.
   */
  trajectoriesByScenario: ReadonlyMap<string, EvalTrajectory>;
}

export interface RunSuiteInput {
  scenarios: ReadonlyArray<EvalScenario>;
  /** At least 2 variants required for relative ranking to be meaningful. */
  variants: ReadonlyArray<RunVariantInput>;
  judgeOptions?: JudgeOptions;
}

export interface RunSuiteResult {
  /** One result per variant. */
  results: ReadonlyArray<VariantRunResult>;
  /** Scenarios where one or more variants were missing a trajectory. */
  skippedScenarios: ReadonlyArray<{ scenarioId: string; missingVariants: string[] }>;
}

/**
 * Run the suite. For each scenario, collect one trajectory from each
 * variant, send them as a group to the judge, then aggregate per-
 * variant scores across scenarios.
 */
export async function runEvalSuite(input: RunSuiteInput): Promise<RunSuiteResult> {
  if (input.variants.length < 2) {
    throw new Error(
      "runEvalSuite requires at least 2 variants for relative ranking. " +
        `Got ${input.variants.length}.`,
    );
  }

  // Build accumulators per variant.
  const perVariantScenarios: Map<
    string,
    Array<{ scenarioId: string; score: number; rank: number; explanation: string }>
  > = new Map();
  for (const v of input.variants) perVariantScenarios.set(v.variantLabel, []);

  const skipped: Array<{ scenarioId: string; missingVariants: string[] }> = [];
  const ranAt = new Date().toISOString();
  let judgeModelSeen = "";

  for (const scenario of input.scenarios) {
    const missing: string[] = [];
    const trajectories: EvalTrajectory[] = [];
    for (const v of input.variants) {
      const traj = v.trajectoriesByScenario.get(scenario.id);
      if (!traj) {
        missing.push(v.variantLabel);
      } else {
        trajectories.push({ ...traj, id: v.variantLabel });
      }
    }
    if (trajectories.length < 2) {
      skipped.push({ scenarioId: scenario.id, missingVariants: missing });
      continue;
    }

    const judgeResult = await judgeTrajectories(
      { scenario, trajectories },
      input.judgeOptions,
    );
    judgeModelSeen = judgeResult.judgeModel;

    for (const scored of judgeResult.scored) {
      const bucket = perVariantScenarios.get(scored.id);
      if (!bucket) continue;
      bucket.push({
        scenarioId: scenario.id,
        score: scored.score,
        rank: scored.rank,
        explanation: scored.explanation,
      });
    }
  }

  const results: VariantRunResult[] = input.variants.map((v) => {
    const perScenario = perVariantScenarios.get(v.variantLabel) ?? [];
    const aggregate =
      perScenario.length === 0
        ? 0
        : perScenario.reduce((s, p) => s + p.score, 0) / perScenario.length;
    const winCount = perScenario.filter((p) => p.rank === 1).length;
    return {
      variantLabel: v.variantLabel,
      judgeModel: judgeModelSeen,
      ranAt,
      perScenario,
      aggregate: Number(aggregate.toFixed(4)),
      winCount,
      scenarioCount: perScenario.length,
    };
  });

  return { results, skippedScenarios: skipped };
}
