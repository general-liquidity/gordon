/**
 * Context Management Module
 *
 * Combined toolbox for agent context lifecycle:
 *   - microcompact:      cheap per-turn marker-based trimming
 *   - memory flush:      durable semantic snapshot before compaction
 *   - tool result spill: large results → disk with preview
 *   - run context:       per-query state + real token anchoring
 */

export {
  microcompactMessages,
  registerCompactableTool,
  isToolCompactable,
  MC_CLEARED_MARKER,
  COUNT_TRIGGER_THRESHOLD,
  COUNT_KEEP_RECENT,
  TOKEN_TRIGGER_THRESHOLD,
} from "./microcompact.ts";
export type {
  CompactableToolMessage,
  MicrocompactResult,
} from "./microcompact.ts";

// Memory flush merged into existing conversation summarizer —
// see src/infra/domain/memory/summarizer.ts ("Durable User Facts" section).

export {
  persistLargeResult,
  buildPersistedContent,
  exceedsSizeCap,
  enforceResultBudget,
  spillOversized,
  MAX_TOOL_RESULT_CHARS,
  MAX_TURN_RESULT_CHARS,
  PREVIEW_CHARS,
} from "./toolResultStorage.ts";
export type {
  PersistedResult,
  ToolResultEntry,
  SpillDecision,
} from "./toolResultStorage.ts";

export {
  createRunContext,
  recordApiUsage,
  TokenCounter,
} from "./runContext.ts";
export type { RunContext } from "./runContext.ts";

export {
  projectUsage,
  classifyUsage,
  growthRate,
  TokenProjector,
  DEFAULT_PROJECTION_CONFIG,
} from "./tokenProjection.ts";
export type {
  ProjectionConfig,
  ProjectionResult,
  TokenSample,
  ThresholdStage,
} from "./tokenProjection.ts";

// Compaction auto-trigger (wires TokenProjector into agent loop)
export {
  CompactionTrigger,
  getCompactionTrigger,
  resetCompactionTrigger,
} from "./compactionTrigger.ts";
export type { CompactionAction, CompactionDecision } from "./compactionTrigger.ts";

// Conversation-wide tool result budget
export {
  ConversationBudget,
  getConversationBudget,
  resetConversationBudget,
  DEFAULT_CONVERSATION_BUDGET_CHARS,
} from "./conversationBudget.ts";
export type { TrackedResult, BudgetStats } from "./conversationBudget.ts";

// Message tombstones for audit trail
export {
  recordTombstone,
  recordTombstones,
  countTombstones,
} from "./tombstones.ts";
export type { Tombstone, TombstoneReason } from "./tombstones.ts";
