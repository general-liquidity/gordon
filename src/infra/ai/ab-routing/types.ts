/**
 * Model A/B routing + acceptance tracking — shared types.
 *
 * Inspired by Jane Street's AID (AI Development Environment) talk:
 * "we can do something like send 50% of the company to one model and
 * 50% to another and then determine which one gets the higher
 * acceptance rate."
 *
 * Operator-scale port: instead of routing 1700 developers between
 * two models, route a single operator's invocations probabilistically
 * between two model variants and track which one's outputs the
 * operator actually accepts. After enough samples, the Wilson CI on
 * acceptance rate tells the operator whether the choice matters.
 *
 * Composable with existing JSONL discipline (trade-ledger, skill-
 * usage, agent-feedback). Disable via `GORDON_MODEL_AB_DISABLED=1`.
 */

export interface ModelVariant {
  /** Stable identifier — used in ledger rows + summary text. */
  id: string;
  /** Actual model id passed to the LLM client (e.g., "claude-sonnet-4-6"). */
  modelId: string;
  /** Optional human-readable description for reports. */
  description?: string;
  /** Optional extended-thinking budget when the model supports it. */
  thinkingBudgetTokens?: number;
  /** Optional system-prompt suffix to inject for this variant. */
  systemPromptSuffix?: string;
}

export interface AbTestConfig {
  /** Stable identifier for this A/B test — used for ledger filtering. */
  testId: string;
  variantA: ModelVariant;
  variantB: ModelVariant;
  /**
   * Probability of routing to `variantA` (variantB gets 1 - this).
   * Default 0.5 (even split). Operator can bias toward a known-good
   * variant when running a long-tail experiment by tilting this.
   */
  trafficSplit?: number;
}

export interface AcceptanceOutcome {
  /** Whether the operator accepted the variant's output. */
  accepted: boolean;
  /** Optional free-form context label (e.g., "plan-approval", "tool-call"). */
  context?: string;
}

export interface AcceptanceRecord {
  /** ISO-8601 timestamp. */
  timestamp: string;
  testId: string;
  variantId: string;
  /** Caller-supplied invocation identifier (Mastra session, request id, etc.). */
  invocationId: string;
  outcome: AcceptanceOutcome;
}

export interface VariantStats {
  variantId: string;
  totalInvocations: number;
  acceptedCount: number;
  /** Empirical acceptance rate. */
  acceptanceRate: number;
  /** 95% Wilson CI on the acceptance rate. */
  acceptanceCi95: { lower: number; upper: number };
}

export interface AbTestStats {
  testId: string;
  totalRecords: number;
  variants: VariantStats[];
  /**
   * Variant id when one variant's CI lower bound clears the other's
   * upper bound (no overlap → clear winner under 95% confidence).
   * `null` when CIs overlap (not enough samples yet, OR variants
   * are genuinely indistinguishable).
   */
  significantWinner: string | null;
  summary: string;
}

export interface RecordOptions {
  /** Override ledger path (test-only or alt-storage). */
  path?: string;
}

export interface ReadOptions {
  path?: string;
  /** Filter records to those with timestamp ≥ this ISO date. */
  sinceIso?: string;
}
