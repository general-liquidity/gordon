/**
 * Proactive Engine
 *
 * Orchestrates Gordon's proactive suggestion loop. Runs as a background
 * subsystem inside the Gordon process, independent from the permission mode
 * (ask / auto / strict). When enabled, the engine:
 *
 *   1. Observes events from the Gordon event bus (trade fills, position
 *      updates, regime flips, whale alerts, etc.)
 *   2. Constructs candidate suggestions via pluggable producers
 *   3. Submits each candidate to the judge (heuristic or LLM)
 *   4. Fires the suggestion (stores it + emits a proactive event) if the
 *      judge approves, updates category policy, auto-records the outcome
 *      when the user responds
 *
 * The engine is deliberately small. Candidate producers are functions that
 * take an observation event and return zero or more candidates — they're
 * the place to add new trigger types without touching the engine itself.
 */

import { createModuleLogger } from "../../logger/index.ts";
import type {
  ProactiveSuggestion,
  ProactiveCategory,
  ProactiveEngineStatus,
  ProactiveStatus,
  SuggestionOutcome,
} from "../types.ts";
import { getSuggestionStore } from "../storage/suggestionStore.ts";
import { getCategoryPolicy } from "../judges/categoryPolicy.ts";
import { getOutcomeTracker, autoRecordFromStore } from "../judges/outcomeEvals.ts";
import { judgeCandidate } from "../judges/proposalJudge.ts";
import {
  DeliveryPolicy,
  defaultSeverityForCategory,
  buildDedupeKey,
  type DeliveryDecision,
} from "./deliveryPolicy.ts";
import { getEventBus } from "../../../events/index.ts";
import { saveProactiveStateDebounced } from "../storage/persistence.ts";
import {
  recordDecision as recordCalibrationDecision,
  recordOutcome as recordCalibrationOutcome,
  type OutcomeResult,
} from "../../calibration/confidenceStore.ts";

const logger = createModuleLogger("proactive-engine");

// ============================================================================
// Candidate producer — inputs are observations, outputs are candidates
// ============================================================================

export interface ProactiveObservation {
  source: "event_bus" | "monitor_loop" | "webhook" | "regime" | "manual";
  eventType?: string;
  symbol?: string;
  price?: number;
  change?: number;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export type CandidateProducer = (
  obs: ProactiveObservation,
) => ProactiveSuggestion[] | Promise<ProactiveSuggestion[]>;

// ============================================================================
// Engine
// ============================================================================

export class ProactiveEngine {
  private running = false;
  private startedAt: number | null = null;
  private producers: CandidateProducer[] = [];
  private pendingEvents: ProactiveObservation[] = [];
  private processing = false;
  private delivery = new DeliveryPolicy();

  start(): { started: boolean; alreadyRunning?: boolean } {
    if (this.running) {
      return { started: false, alreadyRunning: true };
    }
    this.running = true;
    this.startedAt = Date.now();
    logger.info("Proactive engine started");
    return { started: true };
  }

  stop(): { stopped: boolean; wasRunning: boolean } {
    const wasRunning = this.running;
    this.running = false;
    this.startedAt = null;
    this.pendingEvents = [];
    this.delivery.reset();
    logger.info("Proactive engine stopped");
    return { stopped: wasRunning, wasRunning };
  }

  isRunning(): boolean {
    return this.running;
  }

  getStatus(): ProactiveEngineStatus {
    const store = getSuggestionStore();
    const counts = store.counts();
    return {
      running: this.running,
      startedAt: this.startedAt ? new Date(this.startedAt).toISOString() : null,
      totalSuggestions: counts.total,
      pendingCount: counts.pending,
      acceptedCount: counts.accepted,
      dismissedCount: counts.dismissed,
      suppressedCount: counts.suppressed,
      expiredCount: counts.expired,
    };
  }

  /**
   * Register a candidate producer. Producers are called in registration
   * order for each observation the engine processes.
   */
  registerProducer(producer: CandidateProducer): () => void {
    this.producers.push(producer);
    return () => {
      const i = this.producers.indexOf(producer);
      if (i >= 0) this.producers.splice(i, 1);
    };
  }

  /** List all registered producers (for diagnostics). */
  producerCount(): number {
    return this.producers.length;
  }

  /**
   * Feed an observation to the engine. If proactive mode is enabled, queue
   * the observation for processing; otherwise drop silently.
   */
  async observe(obs: ProactiveObservation): Promise<void> {
    if (!this.running) return;
    this.pendingEvents.push(obs);
    // Trim the queue so a burst of events doesn't grow unbounded
    if (this.pendingEvents.length > 200) {
      this.pendingEvents.shift();
    }
    if (!this.processing) {
      await this.drain();
    }
  }

  /**
   * Directly evaluate a candidate and fire it if the judge approves.
   * Useful for tests and for explicit "fire this suggestion now" tools.
   */
  async fireCandidate(
    candidate: Omit<ProactiveSuggestion, "id" | "createdAt" | "status">,
  ): Promise<{ fired: boolean; suggestion?: ProactiveSuggestion; reason?: string }> {
    const full: ProactiveSuggestion = {
      ...candidate,
      id: generateId(),
      createdAt: new Date().toISOString(),
      status: "pending",
    };

    const verdict = await judgeCandidate(full);
    full.judgeReasoning = verdict.reasoning;

    if (!verdict.shouldFire) {
      full.status = "suppressed";
      // Still store it for audit
      getSuggestionStore().add(full);
      return { fired: false, suggestion: full, reason: verdict.reasoning };
    }

    getCategoryPolicy().markFired(candidate.category);
    getSuggestionStore().add(full);
    this.recordCalibrationDecision(full);

    const decision = this.delivery.admit(full);
    await this.applyDeliveryDecision(full, decision);
    this.schedulePersist();

    if (decision.kind === "coalesce") {
      return { fired: false, suggestion: full, reason: `coalesced into ${decision.existingId}` };
    }
    if (decision.kind === "hold") {
      return { fired: false, suggestion: full, reason: "batched (held for summary rollup)" };
    }
    return { fired: true, suggestion: full };
  }

  /**
   * Act on a delivery-policy decision for a suggestion that passed the judge
   * and is already stored. Centralizes the emit-vs-hold-vs-coalesce-vs-rollup
   * branch shared by `fireCandidate` and `processObservation`.
   */
  private async applyDeliveryDecision(
    suggestion: ProactiveSuggestion,
    decision: DeliveryDecision,
  ): Promise<void> {
    switch (decision.kind) {
      case "deliver":
        logger.info("Proactive suggestion delivered", {
          id: suggestion.id,
          category: suggestion.category,
          severity: decision.severity,
        });
        await this.emitSuggestionFired(suggestion);
        return;
      case "hold":
        // Stored + queryable, but not rendered as a card yet. The next
        // batchable card past BATCH_THRESHOLD flushes a summary rollup.
        logger.debug("Proactive suggestion held for rollup", {
          id: suggestion.id,
          category: suggestion.category,
        });
        return;
      case "coalesce":
        // Same condition already pending-undelivered. Suppress the duplicate
        // (kept for audit, but out of the pending queue and never re-batched)
        // so it doesn't double-count against backpressure or render twice.
        suggestion.status = "suppressed";
        logger.debug("Proactive suggestion coalesced", {
          id: suggestion.id,
          into: decision.existingId,
        });
        return;
      case "rollup":
        // The synthetic digest is stored too, so /ack and /pass on the rollup
        // card resolve against a real suggestion id.
        getSuggestionStore().add(decision.rollup);
        logger.info("Proactive summary rollup emitted", {
          id: decision.rollup.id,
          count: decision.rolledUpIds.length,
        });
        await this.emitSuggestionFired(decision.rollup);
        return;
    }
  }

  /** User accepts a pending suggestion. */
  async accept(id: string): Promise<{ ok: boolean; error?: string }> {
    const store = getSuggestionStore();
    const updated = store.updateStatus(id, "accepted", "CD");
    if (!updated) return { ok: false, error: `suggestion ${id} not found` };
    const category = store.get(id)!.category;
    getOutcomeTracker().record(id, category, "CD");
    this.recordCalibrationOutcome(store.get(id)!, "CD");
    this.delivery.onResolved(id);
    await this.emitResolved(id, category, "accepted");
    this.schedulePersist();
    return { ok: true };
  }

  /** User dismisses a pending suggestion. */
  async dismiss(id: string): Promise<{ ok: boolean; error?: string }> {
    const store = getSuggestionStore();
    const s = store.get(id);
    if (!s) return { ok: false, error: `suggestion ${id} not found` };
    store.updateStatus(id, "dismissed", "FA");
    getOutcomeTracker().record(id, s.category, "FA");
    this.recordCalibrationOutcome(s, "FA");
    this.delivery.onResolved(id);
    await this.emitResolved(id, s.category, "dismissed");
    this.schedulePersist();
    return { ok: true };
  }

  private async emitResolved(
    suggestionId: string,
    category: ProactiveCategory,
    status: "accepted" | "dismissed" | "suppressed" | "expired",
  ): Promise<void> {
    try {
      await getEventBus().send("proactive:suggestion_resolved", {
        suggestionId,
        category,
        status,
      });
    } catch {
      // Best-effort — the bus may not be up in tests
    }
  }

  private schedulePersist(): void {
    saveProactiveStateDebounced(() => {
      const storeData = getSuggestionStore().serialize();
      return {
        version: 1,
        savedAt: new Date().toISOString(),
        suggestions: storeData.suggestions,
        feedback: storeData.feedback,
        categoryPolicies: getCategoryPolicy().serialize(),
        outcomes: getOutcomeTracker().serialize(),
      };
    });
  }

  /** Record a manually-observed outcome (usually for MN/NR reporting). */
  recordOutcome(id: string, outcome: SuggestionOutcome): { ok: boolean; error?: string } {
    const store = getSuggestionStore();
    const s = store.get(id);
    if (!s) return { ok: false, error: `suggestion ${id} not found` };
    s.outcome = outcome;
    getOutcomeTracker().record(id, s.category, outcome);
    this.recordCalibrationOutcome(s, outcome);
    return { ok: true };
  }

  // ---- internal ----

  private async drain(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.pendingEvents.length > 0 && this.running) {
        const obs = this.pendingEvents.shift()!;
        await this.processObservation(obs);
      }
    } finally {
      this.processing = false;
    }
  }

  private async processObservation(obs: ProactiveObservation): Promise<void> {
    for (const producer of this.producers) {
      try {
        const candidates = await producer(obs);
        for (const candidate of candidates) {
          candidate.id = candidate.id || generateId();
          candidate.createdAt = candidate.createdAt || new Date().toISOString();
          candidate.status = candidate.status || "pending";

          const verdict = await judgeCandidate(candidate);
          candidate.judgeReasoning = verdict.reasoning;

          if (verdict.shouldFire) {
            getCategoryPolicy().markFired(candidate.category);
            getSuggestionStore().add(candidate);
            this.recordCalibrationDecision(candidate);
            const decision = this.delivery.admit(candidate);
            await this.applyDeliveryDecision(candidate, decision);
            this.schedulePersist();
          } else {
            candidate.status = "suppressed";
            getSuggestionStore().add(candidate);
          }
        }
      } catch (err) {
        logger.warn("Proactive producer threw", {
          err: String(err),
          source: obs.source,
        });
      }
    }
  }

  private async emitSuggestionFired(suggestion: ProactiveSuggestion): Promise<void> {
    // Emit on the Gordon event bus so TUI chat subscribers (and anything
    // else that wants to react) can surface the suggestion to the user.
    // Awaited so synchronous subscribers observe the event before the caller
    // returns — prevents races in tests and keeps chat/cards in order.
    try {
      await getEventBus().send("proactive:suggestion_fired", {
        suggestionId: suggestion.id,
        category: suggestion.category,
        title: suggestion.title,
        body: suggestion.body,
        confidence: suggestion.confidence,
        action: suggestion.action,
        operation: suggestion.operation,
        triggers: suggestion.triggers as unknown as Record<string, unknown>,
      });
    } catch (err) {
      logger.debug("Failed to emit proactive:suggestion_fired", { err: String(err) });
    }
  }

  private recordCalibrationDecision(suggestion: ProactiveSuggestion): void {
    recordCalibrationDecision({
      decisionId: suggestion.id,
      domain: "proactive_suggestion",
      confidence: suggestion.confidence,
      decision: `${suggestion.category}: ${suggestion.title}`,
      reasoning: suggestion.judgeReasoning ?? suggestion.observationSummary,
      tags: {
        category: suggestion.category,
        source: suggestion.triggers.source,
        ...(suggestion.triggers.eventType ? { eventType: suggestion.triggers.eventType } : {}),
        ...(suggestion.triggers.symbol ? { symbol: suggestion.triggers.symbol } : {}),
      },
    });
  }

  private recordCalibrationOutcome(
    suggestion: ProactiveSuggestion,
    outcome: SuggestionOutcome,
  ): void {
    recordCalibrationOutcome({
      decisionId: suggestion.id,
      result: proactiveOutcomeToCalibrationResult(outcome),
      notes: `proactive outcome=${outcome}; status=${suggestion.status}`,
    });
  }
}

// ============================================================================
// Singleton
// ============================================================================

const engine = new ProactiveEngine();

export function getProactiveEngine(): ProactiveEngine {
  return engine;
}

/**
 * Build a pending suggestion object without firing it. Used by producers and
 * by tools that want to construct a candidate before submission.
 */
export function buildCandidate(
  category: ProactiveCategory,
  title: string,
  body: string,
  options: Partial<
    Omit<ProactiveSuggestion, "id" | "createdAt" | "status" | "category" | "title" | "body">
  > = {},
): ProactiveSuggestion {
  const suggestion: ProactiveSuggestion = {
    id: generateId(),
    category,
    title,
    body,
    action: options.action,
    operation: options.operation,
    confidence: options.confidence ?? 0.7,
    severity: options.severity ?? defaultSeverityForCategory(category),
    createdAt: new Date().toISOString(),
    status: "pending" as ProactiveStatus,
    triggers: options.triggers ?? { source: "manual" },
    observationSummary: options.observationSummary,
    judgeReasoning: options.judgeReasoning,
    outcome: options.outcome,
  };
  // Derive a coalescing key from the resolved triggers when the caller
  // didn't supply one explicitly (category:symbol:trigger).
  suggestion.dedupeKey = options.dedupeKey ?? buildDedupeKey(suggestion);
  return suggestion;
}

// Re-export for convenience
export { autoRecordFromStore };

function generateId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `ps_${ts}_${rand}`;
}

function proactiveOutcomeToCalibrationResult(outcome: SuggestionOutcome): OutcomeResult {
  switch (outcome) {
    case "CD":
    case "NR":
      return "correct";
    case "FA":
    case "MN":
      return "wrong";
    default:
      return "unknown";
  }
}
