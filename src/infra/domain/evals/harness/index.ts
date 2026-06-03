/**
 * Eval Harness — agent-quality eval with LLM-as-judge.
 *
 * RULER-pattern relative scoring against hand-curated golden
 * scenarios, with optional tri-judge panel (Anthropic + OpenAI +
 * Google) for anti-bias averaging. Distinct from `evals/tradeEvaluator
 * .ts` which scores realized PnL after-the-fact; this harness scores
 * *agent behavior* before changes ship.
 *
 * Typical use (single judge):
 *   import { runEvalSuite, detectRegressions, ALL_SCENARIOS } from "...";
 *   const result = await runEvalSuite({ scenarios: ALL_SCENARIOS, variants });
 *   const report = detectRegressions(result.results[0], result.results[1], {
 *     writeReviewQueue: true,
 *   });
 *   if (report.hasBlockingRegression) process.exit(1);
 *
 * Tri-judge panel:
 *   const result = await runEvalSuite({
 *     scenarios: ALL_SCENARIOS,
 *     variants,
 *     panelOptions: {}, // uses DEFAULT_PANEL
 *   });
 */

export type {
  EvalCategory,
  EvalScenario,
  EvalTrajectory,
  JudgeResult,
  JudgeRequest,
  PanelJudgeEntry,
  PanelJudgeResult,
  ScoredTrajectory,
  VariantRunResult,
  RegressionReport,
} from "./types.ts";

export {
  judgeTrajectories,
  buildJudgePrompt,
  buildMockJudgeClient,
} from "./trajectoryJudge.ts";
export type { JudgeOptions, MockJudgeOptions } from "./trajectoryJudge.ts";

export { judgeTrajectoriesPanel, DEFAULT_PANEL } from "./panelJudge.ts";
export type { PanelJudgeOptions } from "./panelJudge.ts";

export {
  CATEGORY_RUBRICS,
  ALL_CATEGORIES,
  getCategoryRubric,
} from "./categoryRubrics.ts";

export { runEvalSuite } from "./runner.ts";
export type { RunVariantInput, RunSuiteInput, RunSuiteResult } from "./runner.ts";

export { detectRegressions, formatRegressionReport } from "./regression.ts";
export type { DetectOptions } from "./regression.ts";

export {
  appendToReviewQueue,
  readReviewQueue,
  defaultReviewQueuePath,
} from "./reviewQueue.ts";
export type { ReviewQueueEntry } from "./reviewQueue.ts";

export {
  ALL_SCENARIOS,
  ALL_SCENARIO_IDS,
  ADVERSARIAL_SCENARIOS,
  scenariosByTag,
  getScenarioById,
  scenariosByProvenance,
} from "./scenarios/index.ts";

// Scenario generator — derives the suite from the trading constitution,
// risk-classifier dimensions, the safety-critical deny-list, and the
// category rubrics. Replaces the hand-authored scenario fixtures.
export {
  generateScenarios,
  ALL_GENERATOR_SOURCES,
  constitutionScenarios,
  riskDimensionScenarios,
  denylistScenarios,
  rubricRedFlagScenarios,
  paraphraseScenarios,
  mergeParaphrased,
  loadScenariosWithParaphrase,
  writeParaphraseCache,
  readParaphraseCache,
  defaultParaphraseCachePath,
  buildMockParaphraseClient,
} from "./generator/index.ts";
export type {
  GeneratorSource,
  GenerateOptions,
  ParaphraseOptions,
  MockParaphraseOptions,
} from "./generator/index.ts";

// Structured category-rubric data (consumed by the rubric source).
export { CATEGORY_RUBRIC_DATA, renderCategoryRubric } from "./categoryRubrics.ts";
export type { CategoryRubricData } from "./categoryRubrics.ts";
