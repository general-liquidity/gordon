/**
 * Memory Infrastructure Module
 * Conversation summarization and context management
 */

// Summarizer
export {
  ConversationSummarizer,
  createSummarizer,
  createSummarizerConfigFromMemoryConfig,
  DEFAULT_SUMMARIZER_CONFIG,
} from "./summarizer.ts";

// Types
export type {
  SummarizerConfig,
  TradingContext,
  SummarizationResult,
} from "./summarizer.ts";

// Belief-revision ledger — deterministic contradiction resolution (M5).
export {
  BeliefLedger,
  makeBelief,
  flipBar,
  tensionWeight,
  tensionVerdict,
  tensionCrossed,
  renderBeliefTensionsBlock,
  BELIEF_TENSIONS_SECTION_KEY,
  DEFAULT_BAR,
} from "./beliefLedger.ts";
export type {
  Belief,
  BeliefStatus,
  Stance,
  Tension,
  Verdict,
  NewBeliefOptions,
  BeliefLedgerSnapshot,
} from "./beliefLedger.ts";
