/**
 * Cognition primitives barrel.
 *
 * Stable import path for evaluator/reasoning helpers that callers wire
 * into their own hot-paths.
 *
 *   - adversarialEvaluator    — combat self-eval bias (V1)
 *   - evaluatorCalibration    — few-shot anchoring (V2)
 *   - citationAgent           — evidence trail for recommendations
 *   - effortCalibration       — token/fanout/depth budget per complexity
 *   - rationaleConsistency    — triangular evidence/reasoning/decision gate
 */

export {
  isAdversarialEvaluatorEnabled,
  buildAdversarialPrompt,
  acceptIfAdversarial,
  formatAdversarialReport,
} from "./adversarialEvaluator.ts";
export type {
  AdversarialReport,
  FailureMode,
  AdversarialGateResult,
} from "./adversarialEvaluator.ts";

export {
  registerCalibrationExample,
  loadCalibrationSet,
  selectRelevantExamples,
  buildCalibrationBlock as buildEvaluatorCalibrationBlock,
  detectDrift,
} from "./evaluatorCalibration.ts";
export type {
  CalibrationExample,
  DriftReport,
} from "./evaluatorCalibration.ts";

export {
  isCitationAgentEnabled,
  defaultCitationManifestPath,
  buildCitationManifest,
  detectUnsupportedClaims,
  findEvidenceForClaim,
  persistCitationManifest,
  readCitationManifests,
  formatCitationManifest,
  manifestToPayload as citationManifestToPayload,
} from "./citationAgent.ts";
export type {
  EvidenceRef,
  ClaimCitation,
  CitationManifest,
  BuildManifestInput,
} from "./citationAgent.ts";

export {
  classifyComplexity,
  budgetFor,
  buildCalibrationBlock as buildEffortCalibrationBlock,
  budgetToPayload,
} from "./effortCalibration.ts";
export type {
  ComplexityLevel,
  ComplexityHints,
  EffortBudget,
  ReasoningDepth,
} from "./effortCalibration.ts";

export {
  recursiveDecompose,
  chunkText,
} from "./recursiveDecompose.ts";
export type {
  DecomposeMessage,
  DecomposeLLM,
  RecursiveDecomposeRequest,
  RecursiveDecomposeResult,
  RecursiveDecomposeDeps,
} from "./recursiveDecompose.ts";

export {
  params as temperamentParams,
  normalizeDials,
  neutralTemperament,
  maxAggressionDials,
  paramsToPayload as temperamentParamsToPayload,
  TEMPERAMENT_CAPS,
} from "./temperament.ts";
export type {
  TemperamentDials,
  TemperamentParams,
} from "./temperament.ts";

export {
  buildLegPrompt,
  scoreTriangularConsistency,
  consistencyScoreOf,
  weakestLeg,
  symmetricOutcomeProduct,
  applyAsymmetricOutcomeGate,
  gateOutcomeByConsistency,
  narrowEvidence,
  formatConsistencyResult,
  consistencyResultToPayload,
  CONSISTENCY_LEGS,
  LEG_RELATION,
  UNSCORED_CONSISTENCY_SCORE,
} from "./rationaleConsistency.ts";
export type {
  ConsistencyLeg,
  EvidenceChunk,
  RationaleTriple,
  TriangularJudgeRequest,
  TriangularJudgeVerdict,
  TriangularJudge,
  LegScore,
  ScoredConsistencyResult,
  UnscoredConsistencyResult,
  TriangularConsistencyResult,
  OutcomeDirection,
  AsymmetricGateResult,
  EntityMatcher,
  ChunkRanker,
  NarrowEvidenceOptions,
  NarrowEvidenceResult,
} from "./rationaleConsistency.ts";
