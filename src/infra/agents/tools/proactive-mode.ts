/**
 * Proactive Mode Tools
 *
 * Agent-facing tools that manage Gordon's proactive suggestion subsystem:
 * start/stop the engine, list suggestions, accept/dismiss, suppress
 * categories, query stats, fire manual suggestions, and configure policy.
 *
 * These are orthogonal to permission mode (ask / auto / strict) — proactive
 * mode is a separate toggle that can be combined with any permission level.
 * When proactive mode is off, the engine drops observations silently and
 * producers never run.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  getProactiveEngine,
  getSuggestionStore,
  getCategoryPolicy,
  getOutcomeTracker,
  autoRecordFromStore,
  buildCandidate,
  ALL_CATEGORIES,
  OUTCOME_LABELS,
  getActiveJudge,
  setActiveJudge,
  HeuristicJudge,
  LlmJudge,
  type ProactiveCategory,
  type SuggestionOutcome,
} from "../../proactive/index.ts";
import { startProactiveObserver, stopProactiveObserver, isObserverRunning } from "../../proactive/observer.ts";

const CATEGORY_SCHEMA = z.enum([
  "regime_flip",
  "whale_alert",
  "volatility_spike",
  "stop_loss_tighten",
  "portfolio_drift",
  "missed_entry",
  "position_review",
  "journal_prompt",
  "session_review",
  "risk_warning",
  "playbook_suggest",
  "funding_alert",
  "news_event",
]);

const STATUS_SCHEMA = z.enum([
  "pending", "accepted", "dismissed", "suppressed", "expired",
]);

// ============================================================================
// 1. start_proactive_mode
// ============================================================================

export const startProactiveModeTool = createTool({
  id: "start_proactive_mode",
  description:
    "Start Gordon's proactive mode — the subsystem that surfaces unsolicited " +
    "trading suggestions based on observed events (regime flips, whale moves, " +
    "volatility spikes, portfolio drift, etc.). Proactive mode is orthogonal " +
    "to permission mode: you can be in ask / auto / strict and still have " +
    "proactive suggestions flowing. Wires the producer registry and the " +
    "event-bus observer, so suggestions start firing automatically as Gordon " +
    "events land. Also starts a 60-second internal tick loop for time-based " +
    "producers (session review, end-of-day journal, whale buffer drain).",
  inputSchema: z.object({}),
  outputSchema: z.object({
    started: z.boolean(),
    alreadyRunning: z.boolean().optional(),
    startedAt: z.string().nullable(),
    producerCount: z.number(),
    observerSubscriptions: z.number(),
  }),
  execute: async () => {
    const engine = getProactiveEngine();
    const result = engine.start();
    // Start the observer regardless — it's idempotent and ensures producers
    // are registered even if the engine was already running.
    const observer = startProactiveObserver();
    const status = engine.getStatus();
    return {
      started: result.started,
      alreadyRunning: result.alreadyRunning,
      startedAt: status.startedAt,
      producerCount: engine.producerCount(),
      observerSubscriptions: observer.subscriptions,
    };
  },
});

// ============================================================================
// 2. stop_proactive_mode
// ============================================================================

export const stopProactiveModeTool = createTool({
  id: "stop_proactive_mode",
  description:
    "Stop Gordon's proactive mode. Unsubscribes the event-bus observer, " +
    "clears the periodic tick loop, unregisters all producers, and stops the " +
    "engine. Preserves the suggestion history and category policy state so " +
    "you can restart without losing your feedback ledger.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    stopped: z.boolean(),
    wasRunning: z.boolean(),
    observerStopped: z.boolean(),
  }),
  execute: async () => {
    const wasObserving = isObserverRunning();
    stopProactiveObserver();
    const result = getProactiveEngine().stop();
    return { ...result, observerStopped: wasObserving };
  },
});

// ============================================================================
// 3. get_proactive_status
// ============================================================================

export const getProactiveStatusTool = createTool({
  id: "get_proactive_status",
  description:
    "Get the current status of proactive mode: running state, start time, " +
    "total suggestions fired, counts by lifecycle (pending / accepted / " +
    "dismissed / suppressed / expired), and producer count. Use to check " +
    "whether proactive mode is on before telling the user 'I'm watching for X'.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    running: z.boolean(),
    startedAt: z.string().nullable(),
    totalSuggestions: z.number(),
    pendingCount: z.number(),
    acceptedCount: z.number(),
    dismissedCount: z.number(),
    suppressedCount: z.number(),
    expiredCount: z.number(),
    producerCount: z.number(),
  }),
  execute: async () => {
    const engine = getProactiveEngine();
    const status = engine.getStatus();
    return { ...status, producerCount: engine.producerCount() };
  },
});

// ============================================================================
// 4. list_proactive_suggestions
// ============================================================================

export const listProactiveSuggestionsTool = createTool({
  id: "list_proactive_suggestions",
  description:
    "List recent proactive suggestions (newest first). Optionally filter by " +
    "category or lifecycle status. Use to see what Gordon has been surfacing " +
    "and review the feedback ledger.",
  inputSchema: z.object({
    limit: z.number().int().min(1).max(100).optional().default(20),
    category: CATEGORY_SCHEMA.optional(),
    status: STATUS_SCHEMA.optional(),
  }),
  outputSchema: z.object({
    total: z.number(),
    suggestions: z.array(
      z.object({
        id: z.string(),
        category: z.string(),
        title: z.string(),
        body: z.string(),
        action: z.string().optional(),
        confidence: z.number(),
        createdAt: z.string(),
        status: z.string(),
        outcome: z.string().optional(),
        judgeReasoning: z.string().optional(),
        triggers: z.record(z.string(), z.unknown()),
      }),
    ),
  }),
  execute: async ({ limit, category, status }) => {
    const store = getSuggestionStore();
    const list = store.getRecent(limit ?? 20, {
      category: category as ProactiveCategory | undefined,
      status,
    });
    return {
      total: list.length,
      suggestions: list.map((s) => ({
        id: s.id,
        category: s.category,
        title: s.title,
        body: s.body,
        action: s.action,
        confidence: s.confidence,
        createdAt: s.createdAt,
        status: s.status,
        outcome: s.outcome,
        judgeReasoning: s.judgeReasoning,
        triggers: s.triggers as Record<string, unknown>,
      })),
    };
  },
});

// ============================================================================
// 5. accept_proactive_suggestion
// ============================================================================

export const acceptProactiveSuggestionTool = createTool({
  id: "accept_proactive_suggestion",
  description:
    "User accepts a proactive suggestion — marks it accepted, records a " +
    "Correct-Detection outcome, and shapes future category policy (accept " +
    "rate feeds the auto-tuning logic). Pass the suggestion id from " +
    "list_proactive_suggestions. If the suggestion carries a structured " +
    "`operation` (tool + args), that operation is returned in the response " +
    "so the agent can decide whether to auto-invoke it. Read-only operations " +
    "can be auto-invoked immediately; write operations should be previewed " +
    "with the user first.",
  inputSchema: z.object({
    id: z.string().describe("Suggestion id (from list_proactive_suggestions)."),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    error: z.string().optional(),
    operation: z
      .object({
        tool: z.string(),
        args: z.record(z.string(), z.unknown()),
        readOnly: z.boolean(),
        description: z.string(),
      })
      .optional(),
    autoInvokable: z.boolean().optional(),
  }),
  execute: async ({ id }) => {
    const engine = getProactiveEngine();
    const result = engine.accept(id);
    if (!result.ok) return result;

    const suggestion = getSuggestionStore().get(id);
    if (suggestion?.operation) {
      return {
        ok: true,
        operation: suggestion.operation,
        autoInvokable: suggestion.operation.readOnly,
      };
    }
    return { ok: true };
  },
});

// ============================================================================
// 6. dismiss_proactive_suggestion
// ============================================================================

export const dismissProactiveSuggestionTool = createTool({
  id: "dismiss_proactive_suggestion",
  description:
    "User dismisses a proactive suggestion — marks it dismissed, records a " +
    "False-Alarm outcome, and feeds the auto-suppression logic (3+ dismissals " +
    "in an hour auto-suppresses the category for an hour).",
  inputSchema: z.object({
    id: z.string().describe("Suggestion id to dismiss."),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    error: z.string().optional(),
  }),
  execute: async ({ id }) => {
    return getProactiveEngine().dismiss(id);
  },
});

// ============================================================================
// 7. suppress_proactive_category
// ============================================================================

export const suppressProactiveCategoryTool = createTool({
  id: "suppress_proactive_category",
  description:
    "Explicitly suppress an entire proactive category for a duration. Use " +
    "when the user says 'stop bothering me about whale alerts for the next " +
    "2 hours' or 'mute regime flips until tomorrow'. Suppression is category-" +
    "scoped and automatically expires.",
  inputSchema: z.object({
    category: CATEGORY_SCHEMA,
    durationMinutes: z.number().int().min(1).max(24 * 60).default(60),
  }),
  outputSchema: z.object({
    category: z.string(),
    suppressedUntil: z.string(),
  }),
  execute: async ({ category, durationMinutes }) => {
    const policy = getCategoryPolicy();
    const ms = (durationMinutes ?? 60) * 60 * 1000;
    policy.suppress(category as ProactiveCategory, ms);
    return {
      category,
      suppressedUntil: new Date(Date.now() + ms).toISOString(),
    };
  },
});

// ============================================================================
// 8. unsuppress_proactive_category
// ============================================================================

export const unsuppressProactiveCategoryTool = createTool({
  id: "unsuppress_proactive_category",
  description: "Remove an explicit suppression on a proactive category, restoring normal cooldown behavior.",
  inputSchema: z.object({
    category: CATEGORY_SCHEMA,
  }),
  outputSchema: z.object({
    category: z.string(),
    unsuppressed: z.boolean(),
  }),
  execute: async ({ category }) => {
    getCategoryPolicy().unsuppress(category as ProactiveCategory);
    return { category, unsuppressed: true };
  },
});

// ============================================================================
// 9. get_proactive_stats
// ============================================================================

export const getProactiveStatsTool = createTool({
  id: "get_proactive_stats",
  description:
    "Get aggregate stats on proactive mode performance: 4-outcome taxonomy " +
    "(Missed-Need, Correct-Detection, False-Alarm, Non-Response), precision, " +
    "recall, F1, and per-category breakdown. Use to answer 'how is proactive " +
    "mode doing?' — CD/FA ratios tell you which categories are worth keeping.",
  inputSchema: z.object({
    windowHours: z
      .number()
      .int()
      .min(1)
      .max(24 * 30)
      .optional()
      .describe("Time window in hours (default: all time)."),
  }),
  outputSchema: z.object({
    overall: z.object({
      missedNeed: z.number(),
      correctDetection: z.number(),
      falseAlarm: z.number(),
      nonResponse: z.number(),
      total: z.number(),
      precision: z.number(),
      recall: z.number(),
      f1: z.number(),
    }),
    byCategory: z.array(
      z.object({
        category: z.string(),
        total: z.number(),
        precision: z.number(),
        recall: z.number(),
        f1: z.number(),
      }),
    ),
    outcomeLegend: z.record(z.string(), z.string()),
  }),
  execute: async ({ windowHours }) => {
    // Make sure recent feedback is reflected in outcomes
    autoRecordFromStore();
    const tracker = getOutcomeTracker();
    const windowMs = windowHours ? windowHours * 60 * 60 * 1000 : undefined;
    const overall = tracker.stats(windowMs);
    const byCategory = tracker.breakdown(windowMs).map((entry) => ({
      category: entry.category,
      total: entry.stats.total,
      precision: entry.stats.precision,
      recall: entry.stats.recall,
      f1: entry.stats.f1,
    }));
    return {
      overall,
      byCategory,
      outcomeLegend: OUTCOME_LABELS as unknown as Record<string, string>,
    };
  },
});

// ============================================================================
// 10. fire_proactive_suggestion — manual / admin
// ============================================================================

export const fireProactiveSuggestionTool = createTool({
  id: "fire_proactive_suggestion",
  description:
    "Manually construct and fire a proactive suggestion. Useful for: testing " +
    "the end-to-end pipeline, surfacing a one-off observation the user should " +
    "consider, or pre-populating the store for a demo. Goes through the judge " +
    "like any other suggestion — if policy or confidence gates reject it, " +
    "it lands as suppressed.",
  inputSchema: z.object({
    category: CATEGORY_SCHEMA,
    title: z.string().min(1),
    body: z.string().min(1),
    action: z.string().optional(),
    confidence: z.number().min(0).max(1).default(0.75),
    symbol: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
  outputSchema: z.object({
    fired: z.boolean(),
    suggestionId: z.string().optional(),
    status: z.string().optional(),
    reason: z.string().optional(),
    judgeReasoning: z.string().optional(),
  }),
  execute: async ({ category, title, body, action, confidence, symbol, metadata }) => {
    const candidate = buildCandidate(
      category as ProactiveCategory,
      title,
      body,
      {
        action,
        confidence,
        triggers: {
          source: "manual",
          symbol,
          metadata,
        },
      },
    );
    const result = await getProactiveEngine().fireCandidate({
      category: candidate.category,
      title: candidate.title,
      body: candidate.body,
      action: candidate.action,
      confidence: candidate.confidence,
      triggers: candidate.triggers,
    });
    return {
      fired: result.fired,
      suggestionId: result.suggestion?.id,
      status: result.suggestion?.status,
      reason: result.reason,
      judgeReasoning: result.suggestion?.judgeReasoning,
    };
  },
});

// ============================================================================
// 11. configure_proactive_category
// ============================================================================

export const configureProactiveCategoryTool = createTool({
  id: "configure_proactive_category",
  description:
    "Tune a proactive category's policy: cooldown, minimum confidence, and " +
    "max per hour. Useful when the user says 'be more selective about whale " +
    "alerts' or 'let me see more regime flips'. Changes apply immediately.",
  inputSchema: z.object({
    category: CATEGORY_SCHEMA,
    cooldownMinutes: z.number().int().min(1).max(24 * 60).optional(),
    minConfidence: z.number().min(0).max(1).optional(),
    maxPerHour: z.number().int().min(0).max(100).optional(),
  }),
  outputSchema: z.object({
    category: z.string(),
    updatedFields: z.array(z.string()),
    currentPolicy: z.object({
      cooldownMs: z.number(),
      minConfidence: z.number(),
      maxPerHour: z.number(),
    }),
  }),
  execute: async ({ category, cooldownMinutes, minConfidence, maxPerHour }) => {
    const policy = getCategoryPolicy();
    const updatedFields: string[] = [];
    const changes: { cooldownMs?: number; minConfidence?: number; maxPerHour?: number } = {};
    if (cooldownMinutes !== undefined) {
      changes.cooldownMs = cooldownMinutes * 60 * 1000;
      updatedFields.push("cooldownMs");
    }
    if (minConfidence !== undefined) {
      changes.minConfidence = minConfidence;
      updatedFields.push("minConfidence");
    }
    if (maxPerHour !== undefined) {
      changes.maxPerHour = maxPerHour;
      updatedFields.push("maxPerHour");
    }
    policy.configure(category as ProactiveCategory, changes);
    const current = policy.get(category as ProactiveCategory);
    return {
      category,
      updatedFields,
      currentPolicy: {
        cooldownMs: current.cooldownMs,
        minConfidence: current.minConfidence,
        maxPerHour: current.maxPerHour,
      },
    };
  },
});

// ============================================================================
// 12. record_proactive_outcome — manual MN/NR reporting
// ============================================================================

export const recordProactiveOutcomeTool = createTool({
  id: "record_proactive_outcome",
  description:
    "Manually record a proactive outcome (CD / FA / MN / NR). Most outcomes " +
    "(CD from accept, FA from dismiss) are auto-recorded, so use this only " +
    "for the reverse cases: user says 'you missed this' (MN — record against " +
    "an affected category even without a fired suggestion id) or 'glad you " +
    "stayed quiet' (NR).",
  inputSchema: z.object({
    id: z.string().describe("Suggestion id, or a synthetic id for MN/NR."),
    outcome: z.enum(["CD", "FA", "MN", "NR"]),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    error: z.string().optional(),
  }),
  execute: async ({ id, outcome }) => {
    return getProactiveEngine().recordOutcome(id, outcome as SuggestionOutcome);
  },
});

// ============================================================================
// 13. list_proactive_categories — discovery
// ============================================================================

export const listProactiveCategoriesTool = createTool({
  id: "list_proactive_categories",
  description:
    "List all proactive categories with their current policy (cooldown, " +
    "min confidence, max per hour, suppression state). Zero-side-effect " +
    "discovery tool.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    total: z.number(),
    categories: z.array(
      z.object({
        category: z.string(),
        cooldownMinutes: z.number(),
        minConfidence: z.number(),
        maxPerHour: z.number(),
        suppressedUntil: z.string().optional(),
      }),
    ),
  }),
  execute: async () => {
    const policy = getCategoryPolicy();
    const all = policy.getAll();
    return {
      total: all.length,
      categories: all.map((p) => ({
        category: p.category,
        cooldownMinutes: Math.round(p.cooldownMs / 60_000),
        minConfidence: p.minConfidence,
        maxPerHour: p.maxPerHour,
        suppressedUntil: p.suppressedUntil ? new Date(p.suppressedUntil).toISOString() : undefined,
      })),
    };
  },
});

// ============================================================================
// 14. set_proactive_judge — swap between heuristic and LLM judge
// ============================================================================

export const setProactiveJudgeTool = createTool({
  id: "set_proactive_judge",
  description:
    "Swap the active proactive judge between the heuristic (fast, rule-based, " +
    "default) and the LLM judge (slower, uses Gordon's runtime model to " +
    "evaluate nuance). LLM judge always runs the heuristic first as a floor, " +
    "so policy / cooldown / duplicate rejections still apply cheaply. Use LLM " +
    "judge when you want higher quality proactive decisions and can accept " +
    "300-1500ms added latency per suggestion evaluation.",
  inputSchema: z.object({
    judge: z.enum(["heuristic", "llm"]),
  }),
  outputSchema: z.object({
    active: z.string(),
    previous: z.string(),
  }),
  execute: async ({ judge }) => {
    const previous = getActiveJudge().name;
    if (judge === "llm") {
      setActiveJudge(new LlmJudge());
    } else {
      setActiveJudge(new HeuristicJudge());
    }
    return { active: getActiveJudge().name, previous };
  },
});

// ============================================================================
// Export
// ============================================================================

export const proactiveModeTools = {
  start_proactive_mode: startProactiveModeTool,
  stop_proactive_mode: stopProactiveModeTool,
  get_proactive_status: getProactiveStatusTool,
  list_proactive_suggestions: listProactiveSuggestionsTool,
  accept_proactive_suggestion: acceptProactiveSuggestionTool,
  dismiss_proactive_suggestion: dismissProactiveSuggestionTool,
  suppress_proactive_category: suppressProactiveCategoryTool,
  unsuppress_proactive_category: unsuppressProactiveCategoryTool,
  get_proactive_stats: getProactiveStatsTool,
  fire_proactive_suggestion: fireProactiveSuggestionTool,
  configure_proactive_category: configureProactiveCategoryTool,
  record_proactive_outcome: recordProactiveOutcomeTool,
  list_proactive_categories: listProactiveCategoriesTool,
  set_proactive_judge: setProactiveJudgeTool,
};
