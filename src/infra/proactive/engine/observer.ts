/**
 * Proactive Observer
 *
 * Bridges Gordon's event bus + a periodic timer into the ProactiveEngine's
 * observation intake. This is the layer that turns "proactive mode is
 * running" from scaffolding into "suggestions actually fire from real
 * events."
 *
 * Two observation sources:
 *   1. Event bus subscription — any Gordon event of interest is converted
 *      to a ProactiveObservation and fed to the engine, which dispatches
 *      to all registered producers.
 *   2. Periodic tick loop — a setInterval that emits synthetic observations
 *      every 60 seconds with different eventTypes (tick_session_review,
 *      tick_journal_prompt, tick_whale_drain, etc.) so periodic producers
 *      have something to react to.
 *
 * `startProactiveObserver()` is idempotent — calling it twice returns the
 * same teardown function. `stopProactiveObserver()` cleanly unsubscribes
 * and clears the interval.
 */

import { getEventBus } from "../../../events/index.ts";
import type { EventType, GordonEvent } from "../../../events/types.ts";
import { createModuleLogger } from "../../logger/index.ts";
import { getProactiveEngine, type ProactiveObservation } from "./proactiveEngine.ts";
import { registerAllProducers } from "../producers/index.ts";
import { getSuggestionStore, type FeedbackRecord } from "../storage/suggestionStore.ts";
import { getCategoryPolicy } from "../judges/categoryPolicy.ts";
import { getOutcomeTracker } from "../judges/outcomeEvals.ts";
import { loadProactiveState, saveProactiveStateNow, flushPendingSave } from "../storage/persistence.ts";

const logger = createModuleLogger("proactive-observer");

// Events the observer subscribes to on the Gordon event bus. Each one is
// translated into a ProactiveObservation. Kept explicit so adding/removing
// event types is a single-place change.
const SUBSCRIBED_EVENTS: EventType[] = [
  "trade:closed",
  "trade:opened",
  "scan:opportunity",
  "risk:rejected",
  "autonomous:mandate_breached",
  "alert:stop_approaching",
  "alert:tp_hit",
  "alert:stop_triggered",
];

// ============================================================================
// Observer state (singleton within the process)
// ============================================================================

let unsubscribeFns: Array<() => void> = [];
let tickHandle: ReturnType<typeof setInterval> | null = null;
let producerUnregister: (() => void) | null = null;

// Tick cadences in ms — each producer gets its own schedule
const TICK_INTERVALS = {
  whale_drain: 5 * 60 * 1000,       // 5 min — poll CDP webhook buffer
  session_review: 60 * 60 * 1000,   // 1 hour — checks time of week
  journal_prompt: 60 * 60 * 1000,   // 1 hour — checks time of day
  portfolio_drift: 30 * 60 * 1000,  // 30 min — position drift check
  regime_flip: 15 * 60 * 1000,      // 15 min — per-symbol regime polling
  chart_pattern: 15 * 60 * 1000,    // 15 min — per-symbol LMW chart-pattern scan
  volatility: 10 * 60 * 1000,       // 10 min — ATR expansion check
  funding: 30 * 60 * 1000,          // 30 min — perp funding scan
  news_event: 10 * 60 * 1000,       // 10 min — RSS headline polling
  stock_news_event: 15 * 60 * 1000, // 15 min — stock RSS + EDGAR + Finnhub
  // Stock event ticks (Finnhub-driven)
  earnings: 2 * 60 * 60 * 1000,     // 2 hours — upcoming earnings calendar
  insider_flow: 4 * 60 * 60 * 1000, // 4 hours — insider transaction clusters
  analyst: 6 * 60 * 60 * 1000,      // 6 hours — analyst rating shifts
  congressional: 24 * 60 * 60 * 1000, // 24 hours — STOCK Act disclosures are already lagged
};

const lastTickAt: Partial<Record<keyof typeof TICK_INTERVALS, number>> = {};

const TICK_LOOP_INTERVAL_MS = 60_000;
// If `setInterval` fires after more than this gap, treat it as a system-
// wake event (laptop closed for hours, suspend/resume) and reset the
// schedule rather than dumping every overdue tick into the engine queue
// at once. Heuristic: > 2× the loop interval = abnormal.
const CLOCK_JUMP_THRESHOLD_MS = TICK_LOOP_INTERVAL_MS * 2;
let lastTickLoopAt = 0;

// ============================================================================
// Start / stop
// ============================================================================

export function startProactiveObserver(): { started: boolean; subscriptions: number; loadedFromDisk: boolean } {
  const engine = getProactiveEngine();

  // Hydrate persisted state first — feedback ledger, category policy, and
  // outcome tracker are carried across restarts so acceptance rates and
  // auto-suppression rules accumulate historically.
  let loadedFromDisk = false;
  try {
    const saved = loadProactiveState();
    if (saved) {
      getSuggestionStore().deserialize({
        suggestions: saved.suggestions,
        feedback: saved.feedback as unknown as FeedbackRecord[],
      });
      getCategoryPolicy().deserialize(saved.categoryPolicies);
      getOutcomeTracker().deserialize(saved.outcomes);
      loadedFromDisk = true;
      logger.info("Hydrated proactive state from disk", {
        suggestions: saved.suggestions.length,
        feedback: saved.feedback.length,
        outcomes: saved.outcomes.length,
      });
    }
  } catch (err) {
    logger.warn("Failed to hydrate proactive state — starting fresh", { err: String(err) });
  }

  // Register producers first — the engine needs them before events land
  if (!producerUnregister) {
    producerUnregister = registerAllProducers(engine);
  }

  // Event bus subscriptions
  if (unsubscribeFns.length === 0) {
    const bus = getEventBus();
    for (const evType of SUBSCRIBED_EVENTS) {
      const unsub = bus.on(evType, (event: GordonEvent) => {
        try {
          const obs = eventToObservation(event);
          if (obs) void engine.observe(obs);
        } catch (err) {
          logger.warn("Failed to convert event to observation", {
            eventType: event.type,
            err: String(err),
          });
        }
      });
      unsubscribeFns.push(unsub);
    }
  }

  // Periodic tick loop — 60s internal heartbeat that dispatches tick
  // observations when each category's interval elapses
  if (!tickHandle) {
    lastTickLoopAt = Date.now();
    tickHandle = setInterval(() => {
      const now = Date.now();
      const sinceLastLoop = now - lastTickLoopAt;
      lastTickLoopAt = now;

      // Detect system-wake / clock jump (laptop closed, suspend/resume).
      // Without this guard, every category whose interval elapsed during
      // the sleep window fires on the same iteration — flooding the
      // engine queue with stale ticks the moment the user comes back.
      if (sinceLastLoop > CLOCK_JUMP_THRESHOLD_MS) {
        logger.info("Detected clock jump — resetting tick schedule", {
          sinceLastLoopMs: sinceLastLoop,
          thresholdMs: CLOCK_JUMP_THRESHOLD_MS,
        });
        for (const key of Object.keys(TICK_INTERVALS) as Array<keyof typeof TICK_INTERVALS>) {
          lastTickAt[key] = now;
        }
        return;
      }

      for (const [key, interval] of Object.entries(TICK_INTERVALS) as Array<
        [keyof typeof TICK_INTERVALS, number]
      >) {
        const last = lastTickAt[key] ?? 0;
        if (now - last < interval) continue;
        lastTickAt[key] = now;
        const obs: ProactiveObservation = {
          source: "monitor_loop",
          eventType: `tick_${key}`,
          timestamp: now,
        };
        void engine.observe(obs);
      }
    }, TICK_LOOP_INTERVAL_MS);
    // Don't let the tick loop keep the process alive
    if (tickHandle.unref) tickHandle.unref();
  }

  logger.info("Proactive observer started", {
    subscriptions: unsubscribeFns.length,
    tickIntervals: Object.keys(TICK_INTERVALS).length,
    loadedFromDisk,
  });

  return { started: true, subscriptions: unsubscribeFns.length, loadedFromDisk };
}

export function stopProactiveObserver(): { stopped: boolean; saved: boolean } {
  // Flush any pending debounced save + write current state synchronously
  // so we don't lose the final session's feedback on shutdown.
  let saved = false;
  try {
    const collector = () => ({
      version: 1,
      savedAt: new Date().toISOString(),
      suggestions: getSuggestionStore().serialize().suggestions,
      feedback: getSuggestionStore().serialize().feedback,
      categoryPolicies: getCategoryPolicy().serialize(),
      outcomes: getOutcomeTracker().serialize(),
    });
    flushPendingSave(collector);
    saveProactiveStateNow(collector());
    saved = true;
  } catch (err) {
    logger.warn("Failed to persist proactive state on shutdown", { err: String(err) });
  }

  for (const unsub of unsubscribeFns) {
    try {
      unsub();
    } catch {
      // Already unsubscribed or bus is down — ignore
    }
  }
  unsubscribeFns = [];

  if (tickHandle) {
    clearInterval(tickHandle);
    tickHandle = null;
  }
  lastTickLoopAt = 0;

  if (producerUnregister) {
    producerUnregister();
    producerUnregister = null;
  }

  for (const key of Object.keys(lastTickAt) as Array<keyof typeof TICK_INTERVALS>) {
    delete lastTickAt[key];
  }

  logger.info("Proactive observer stopped", { saved });
  return { stopped: true, saved };
}

export function isObserverRunning(): boolean {
  return unsubscribeFns.length > 0 || tickHandle !== null;
}

// ============================================================================
// Event → Observation conversion
// ============================================================================

function eventToObservation(event: GordonEvent): ProactiveObservation | null {
  const ts = Date.parse(event.timestamp);
  const timestamp = Number.isFinite(ts) ? ts : Date.now();

  // Extract symbol if present — many trade/alert events carry it on
  // different fields. Using unknown + defensive access so we don't depend
  // on specific event shapes.
  const raw = event as unknown as Record<string, unknown>;
  const symbol =
    (raw.symbol as string | undefined) ??
    ((raw.trade as Record<string, unknown> | undefined)?.symbol as string | undefined) ??
    ((raw.position as Record<string, unknown> | undefined)?.symbol as string | undefined);

  // Extract a price / change if present for downstream producers
  const price =
    (raw.currentPrice as number | undefined) ??
    (raw.price as number | undefined) ??
    (raw.exitPrice as number | undefined);

  const change =
    (raw.pnlPercent as number | undefined) ??
    (raw.change as number | undefined);

  return {
    source: "event_bus",
    eventType: event.type,
    symbol,
    price,
    change,
    timestamp,
    metadata: raw,
  };
}
