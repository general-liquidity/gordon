/**
 * Eval Harness — agent-quality eval with LLM-as-judge.
 *
 * RULER-pattern relative scoring against hand-curated golden
 * scenarios. Distinct from `evals/tradeEvaluator.ts` which scores
 * realized PnL after-the-fact; this harness scores *agent behavior*
 * before changes ship.
 *
 * Typical use:
 *   import { runEvalSuite, detectRegressions, ALL_SCENARIOS } from "...";
 *   const result = await runEvalSuite({ scenarios: ALL_SCENARIOS, variants });
 *   const report = detectRegressions(result.results[0], result.results[1]);
 *   if (report.hasBlockingRegression) process.exit(1);
 */

export type {
  EvalScenario,
  EvalTrajectory,
  JudgeResult,
  JudgeRequest,
  ScoredTrajectory,
  VariantRunResult,
  RegressionReport,
} from "./types.ts";

export { judgeTrajectories, buildMockJudgeClient } from "./trajectoryJudge.ts";
export type { JudgeOptions, MockJudgeOptions } from "./trajectoryJudge.ts";

export { runEvalSuite } from "./runner.ts";
export type { RunVariantInput, RunSuiteInput, RunSuiteResult } from "./runner.ts";

export { detectRegressions, formatRegressionReport } from "./regression.ts";
export type { DetectOptions } from "./regression.ts";

export {
  ALL_SCENARIOS,
  ALL_SCENARIO_IDS,
  planCardBtc,
  regimeFlip,
  riskGate,
  scenariosByTag,
  getScenarioById,
} from "./scenarios/index.ts";
