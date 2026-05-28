/**
 * Orchestration load — quantify the operator's serial-review bottleneck.
 *
 * From "The Orchestration Tax". The operator is the single-threaded resource
 * (the GIL): producing proposals/cards is cheap, but *reviewing* them all has
 * to acquire one lock held by one person. Amdahl's Law caps throughput at the
 * serial fraction — spawning more producers doesn't speed up judgement, it
 * just deepens the queue feeding the bottleneck.
 *
 * This quantifies that: given how many items currently demand the operator's
 * serial attention (pending plan approvals + unacknowledged proactive cards)
 * and their sustainable review throughput, it returns the backlog in hours, a
 * load tier, and a backpressure recommendation — "the producer slows to match
 * the consumer."
 *
 * Pure function. No I/O.
 */

export type OrchestrationLoadTier = "slack" | "saturated" | "overloaded";

export interface OrchestrationLoadInput {
  /** Items awaiting the operator's serial review right now: pending plan
   *  approvals + unacknowledged proactive cards + any approval-gated work. */
  pendingReviewItems: number;
  /** The operator's sustainable review throughput, in items per hour. */
  reviewCapacityPerHour: number;
  /** Optional producer rate: items generated in the last hour. When supplied,
   *  surfaces whether the producer is outpacing the consumer (queue growing). */
  producedLastHour?: number;
  /** Backlog (hours) at/above which load is "saturated". Default 0.75. */
  saturatedThreshold?: number;
  /** Backlog (hours) at/above which load is "overloaded". Default 1.0. */
  overloadedThreshold?: number;
}

export interface OrchestrationLoadResult {
  pendingReviewItems: number;
  reviewCapacityPerHour: number;
  /** pendingReviewItems / reviewCapacityPerHour — hours of queued judgement. */
  backlogHours: number;
  tier: OrchestrationLoadTier;
  /** Null when producedLastHour wasn't supplied. True = queue will grow. */
  producerOutpacingConsumer: boolean | null;
  /** True when load is saturated or overloaded — slow the producer. */
  shouldApplyBackpressure: boolean;
  /** True when load is overloaded — pass only safety-critical items. */
  deferNonCritical: boolean;
  interpretation: string;
}

const DEFAULT_SATURATED = 0.75;
const DEFAULT_OVERLOADED = 1.0;

export function computeOrchestrationLoad(
  input: OrchestrationLoadInput,
): OrchestrationLoadResult {
  const { pendingReviewItems, reviewCapacityPerHour } = input;
  if (!Number.isFinite(pendingReviewItems) || pendingReviewItems < 0) {
    throw new Error("orchestrationLoad: pendingReviewItems must be a non-negative number");
  }
  if (!Number.isFinite(reviewCapacityPerHour) || reviewCapacityPerHour <= 0) {
    throw new Error("orchestrationLoad: reviewCapacityPerHour must be > 0");
  }
  const saturated = input.saturatedThreshold ?? DEFAULT_SATURATED;
  const overloaded = input.overloadedThreshold ?? DEFAULT_OVERLOADED;
  if (!(saturated > 0) || !(overloaded >= saturated)) {
    throw new Error("orchestrationLoad: require overloadedThreshold >= saturatedThreshold > 0");
  }

  const backlogHours = pendingReviewItems / reviewCapacityPerHour;
  const tier: OrchestrationLoadTier =
    backlogHours >= overloaded ? "overloaded" : backlogHours >= saturated ? "saturated" : "slack";

  const producerOutpacingConsumer =
    typeof input.producedLastHour === "number" && Number.isFinite(input.producedLastHour)
      ? input.producedLastHour > reviewCapacityPerHour
      : null;

  const shouldApplyBackpressure = tier !== "slack";
  const deferNonCritical = tier === "overloaded";

  const tierSentence =
    tier === "overloaded"
      ? `OVERLOADED — ${pendingReviewItems} items pending against ${reviewCapacityPerHour}/hr review capacity (${backlogHours.toFixed(1)}h backlog). You are the single serial reviewer and the queue exceeds an hour of judgement. Apply backpressure: pass only safety-critical items, batch the rest, and stop spawning producers — Amdahl's Law means more agents won't speed up your judgement.`
      : tier === "saturated"
        ? `SATURATED — ${backlogHours.toFixed(1)}h of review backlog. Approaching the limit of the serial bottleneck. Slow the producer to match your review rate; batch reviews rather than context-switching per item.`
        : `SLACK — ${backlogHours.toFixed(1)}h backlog, within review capacity. Room to take on more, but watch for cognitive surrender if the queue starts growing.`;

  const producerSentence =
    producerOutpacingConsumer === null
      ? ""
      : producerOutpacingConsumer
        ? ` Producer is outpacing the consumer (${input.producedLastHour}/hr produced > ${reviewCapacityPerHour}/hr reviewed) — the queue is growing.`
        : ` Producer rate (${input.producedLastHour}/hr) is within review capacity.`;

  return {
    pendingReviewItems,
    reviewCapacityPerHour,
    backlogHours,
    tier,
    producerOutpacingConsumer,
    shouldApplyBackpressure,
    deferNonCritical,
    interpretation: tierSentence + producerSentence,
  };
}
