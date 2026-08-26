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
  ScenarioTurn,
  EvalTrajectory,
  TrajectoryCost,
  JudgeResult,
  JudgeRequest,
  PanelJudgeEntry,
  PanelJudgeResult,
  ScoredTrajectory,
  FailureMode,
  VariantRunResult,
  RegressionReport,
} from "./types.ts";
export { FAILURE_MODES } from "./types.ts";

export {
  judgeTrajectories,
  buildJudgePrompt,
  buildMockJudgeClient,
} from "./trajectoryJudge.ts";
export type { JudgeOptions, MockJudgeOptions } from "./trajectoryJudge.ts";

export { judgeTrajectoriesPanel, DEFAULT_PANEL } from "./panelJudge.ts";
export type { PanelJudgeOptions } from "./panelJudge.ts";
export type { PanelJudgeResultWithDissent } from "./panelJudge.ts";
export { computePanelDissent, detectDissentConvergence } from "./panelDissent.ts";
export type {
  JudgeScoreEntry,
  DissentPattern,
  PanelVerdict,
  AgreementMode,
  TrajectoryDissent,
  PanelDissentReport,
  PanelDissentOptions,
  DissentTrend,
} from "./panelDissent.ts";

export {
  CATEGORY_RUBRICS,
  ALL_CATEGORIES,
  getCategoryRubric,
} from "./categoryRubrics.ts";

export { runEvalSuite } from "./runner.ts";
export type { RunVariantInput, RunSuiteInput, RunSuiteResult } from "./runner.ts";

// Prompt-optimization loop — rewrite/score/keep-best against a labeled set,
// gated train/holdout + plateau brake. Thin orchestration over holdoutAccessGate
// + detectStagnation.
export { optimizePrompt, appendFragmentMutator } from "./promptOptimizer.ts";
export type {
  PromptCandidate,
  PromptMutator,
  PromptScorer,
  PromptOptimizerOptions,
  PromptTrial,
  PromptOptimizerStopReason,
  PromptOptimizerResult,
} from "./promptOptimizer.ts";

export { detectRegressions, formatRegressionReport } from "./regression.ts";
export type { DetectOptions } from "./regression.ts";

// Statistical ranking of N variants — Bradley-Terry strength + Wilson-score
// CIs over per-scenario pairwise judgments, with an overlap->tie flag.
export {
  rankVariants,
  rankVariantResults,
  formatLeaderboard,
  wilsonInterval,
  bradleyTerry,
  zForConfidence,
} from "./ranking.ts";
export type {
  RankingVariant,
  RankingInput,
  RankedVariant,
  Leaderboard,
} from "./ranking.ts";

// Judge-vs-human agreement — Cohen's kappa + Spearman rho reliability report.
export {
  cohensKappa,
  spearmanRho,
  binarizeByThreshold,
  computeJudgeAgreement,
  agreementFromScores,
  formatAgreementReport,
} from "./judgeAgreement.ts";
export type {
  LabelPair,
  JudgeAgreementInput,
  JudgeAgreementReport,
} from "./judgeAgreement.ts";

export {
  appendToReviewQueue,
  readReviewQueue,
  defaultReviewQueuePath,
  rollupFailureModes,
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
  memoryScenarios,
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

// Spec→eval orphan detection (reverse of prompt-drift; ANCHORS traceability).
export { findOrphanRules, formatOrphans } from "./orphanCoverage.ts";
export type { OrphanRule } from "./orphanCoverage.ts";

// Process-level trajectory checks + pass^k reliability (Phase 3).
export { checkTrajectory, checkScenarioAssertions } from "./process/processChecks.ts";
export type {
  NormalizedTrace,
  NormalizedToolCall,
  RecalledRecord,
  RecallInfo,
  ProcessViolation,
  ProcessSeverity,
  ProcessCheckResult,
} from "./process/processChecks.ts";
export { computePassK, passKFromChecks } from "./process/passK.ts";
export type { PassKResult, PassKMode, PassKOptions } from "./process/passK.ts";

// Production-trace → eval loop (Phase 1).
export {
  auditTraceToNormalized,
  auditTraceToTrajectory,
  promoteTraceToScenario,
} from "./traces/traceAdapter.ts";
export type { PromoteOptions, TrajectoryFromTraceOptions } from "./traces/traceAdapter.ts";
export { scoreTrace, scoreRecentTraces } from "./traces/traceScorer.ts";
export type { TraceScore, ScoreTracesOptions, ScoreTracesResult } from "./traces/traceScorer.ts";
export {
  appendToPromotionQueue,
  readPromotionQueue,
  defaultPromotionQueuePath,
} from "./traces/promotionQueue.ts";
export type { PromotionEntry } from "./traces/promotionQueue.ts";

// Sandboxed live runner + k-run producer (Phase 4).
export {
  EvalSandbox,
  createEvalSandbox,
  withEvalSandbox,
  buildPaperContext,
  EVAL_SANDBOX_MARKER_ENV,
  EVAL_DRY_RUN_ENV,
} from "./live/sandbox.ts";
export type { EvalSandboxOptions, EvalSandboxPaths } from "./live/sandbox.ts";
export { runScenarioLive, runVariantLive, runLiveEvalSuite } from "./live/runner.ts";
export type {
  RunScenarioLiveOptions,
  ScenarioLiveResult,
  LiveVariantInput,
  RunLiveEvalSuiteInput,
} from "./live/runner.ts";
export { produceKRuns } from "./live/kRunProducer.ts";
export type { ProduceKRunsInput, ProduceKRunsResult } from "./live/kRunProducer.ts";
export { runUnattendedBurnIn, defaultBurnInEvidencePath } from "./live/burnIn.ts";
export type {
  BurnInHeartbeat,
  UnattendedBurnInOptions,
  UnattendedBurnInResult,
} from "./live/burnIn.ts";
