/**
 * Model A/B routing + acceptance tracking — public surface.
 *
 * Adapted from Jane Street's AID dev-tools talk (John Kzi). Lets the
 * operator route LLM invocations probabilistically between two model
 * variants and accumulate per-variant acceptance statistics over time.
 *
 * Typical usage:
 *
 *   const config: AbTestConfig = {
 *     testId: "plan-approval-2026q2",
 *     variantA: { id: "sonnet", modelId: "claude-sonnet-4-6" },
 *     variantB: { id: "opus", modelId: "claude-opus-4-7" },
 *     trafficSplit: 0.5,
 *   };
 *
 *   const variant = selectVariant(config);
 *   // ... pass variant.modelId to the LLM client ...
 *   // ... operator reviews the output, decides to approve/reject ...
 *   recordOutcome(config.testId, variant.id, sessionId, { accepted: true });
 *
 *   // Later:
 *   const stats = getAbTestStats(config.testId);
 *   console.log(stats.summary);
 */

export {
  selectVariant,
  selectVariantWithCounterpart,
  makeSeededRng,
} from "./router.ts";

export {
  recordOutcome,
  readAbTestRecords,
  getAbTestStats,
  defaultAbLedgerPath,
} from "./tracker.ts";

export type {
  ModelVariant,
  AbTestConfig,
  AcceptanceOutcome,
  AcceptanceRecord,
  VariantStats,
  AbTestStats,
  RecordOptions,
  ReadOptions,
} from "./types.ts";
