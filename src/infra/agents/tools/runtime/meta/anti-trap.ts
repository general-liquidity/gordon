/**
 * Anti-trap tools — supervision-preservation primitives.
 *
 * Companion tools for the GORDON_EXPLAIN_FIRST / GORDON_SUPERVISION_RUST_RATE
 * flags. These let the agent capture the user's pre-articulated thesis
 * before execution and (optionally) record calibration outcomes for the
 * supervision-rust check.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { recordStructuredObservation } from "../../../../platform/observability/index.ts";
import {
  recordUserThesis,
  newSupervisionRecord,
  recordSupervisionResult,
  readSupervisionScore,
  saveUniverse,
  loadUniverse,
  checkUniverse,
  saveRunningThesis,
  loadRunningThesis,
  saveMandates,
  loadMandates,
  type FlawType,
  type StrategyMandate,
} from "../../../../safety/index.ts";

export const recordUserThesisTool = createTool({
  id: "record_user_thesis",
  description:
    "Record the user's own thesis for a plan BEFORE revealing Gordon's analysis. " +
    "Under GORDON_EXPLAIN_FIRST mode, execute_plan refuses to run until this is captured. " +
    "Ask the user to articulate why this setup makes sense in their own words (>=10 chars), " +
    "then call this tool with their verbatim response. This builds supervision skill instead of " +
    "eroding it — anti-atrophy defense from the 'agentic coding is a trap' critique applied to trading.",
  inputSchema: z.object({
    planId: z.string().min(1).describe("The plan ID this thesis belongs to."),
    thesis: z
      .string()
      .min(10, {
        message:
          "thesis must be at least 10 characters and reflect the USER'S reasoning (verbatim), " +
          "not the agent's summary. If the user did not articulate one, ask them — do not " +
          "fabricate it on their behalf.",
      })
      .describe("The user's verbatim thesis in their own words."),
    source: z.enum(["user_input", "agent_summarized"]).optional()
      .describe(
        "How the thesis was captured. Default 'user_input'. Use 'agent_summarized' " +
        "only if the user explicitly delegated summarization — divergence will be logged.",
      ),
  }),
  outputSchema: z.object({
    captured: z.boolean(),
    planId: z.string(),
    thesisLength: z.number(),
    source: z.string(),
    capturedAt: z.string(),
  }),
  execute: async ({ planId, thesis, source }) => {
    const entry = recordUserThesis(planId, thesis, source ?? "user_input");
    recordStructuredObservation({
      eventType: "execution.thesis_captured",
      workflow: "execution",
      source: "agent_tool",
      component: "record_user_thesis",
      toolName: "record_user_thesis",
      outcome: "info",
      planId,
      details: {
        thesisLength: entry.thesis.length,
        source: entry.source,
      },
    });
    return {
      captured: true,
      planId: entry.planId,
      thesisLength: entry.thesis.length,
      source: entry.source,
      capturedAt: entry.capturedAt,
    };
  },
});

export const recordSupervisionOutcomeTool = createTool({
  id: "record_supervision_outcome",
  description:
    "Record the outcome of a supervision-rust calibration check — whether the user " +
    "caught (rejected) or missed (accepted) a deliberately-flawed plan. Use ONLY when " +
    "the surrounding system signals a flaw was injected; do not call speculatively. " +
    "Persists to ~/.gordon/supervision-rust.jsonl for catch-rate analysis.",
  inputSchema: z.object({
    flawId: z.string().describe("Identifier of the injected flaw."),
    flawType: z
      .enum([
        "wrong_direction",
        "excessive_size",
        "missing_stop",
        "inverted_rr",
        "stale_data",
      ])
      .describe("Category of the injected flaw."),
    planId: z.string().describe("Plan the flaw was injected into."),
    userAccepted: z
      .boolean()
      .describe("true if the user rubber-stamped the flawed plan (missed); false if caught."),
  }),
  outputSchema: z.object({
    recorded: z.boolean(),
    catchRate: z.number(),
    totalChecks: z.number(),
  }),
  execute: async ({ flawId, flawType, planId, userAccepted }) => {
    const rec = newSupervisionRecord(
      flawId,
      flawType as FlawType,
      planId,
      userAccepted,
    );
    recordSupervisionResult(rec);
    const score = readSupervisionScore();
    return {
      recorded: true,
      catchRate: score.catchRate,
      totalChecks: score.total,
    };
  },
});

export const setTradingUniverseTool = createTool({
  id: "set_trading_universe",
  description:
    "Declare the trader's trade-able universe (allowed symbols, asset classes, venues). " +
    "Under GORDON_TRADING_UNIVERSE mode, execute_plan refuses instruments outside this universe. " +
    "Anti-scope-creep guard: defends against drifting from 'I trade BTC/ETH' into 'I trade 50 tokens'. " +
    "Each axis is independent — empty list on an axis means unrestricted on that axis.",
  inputSchema: z.object({
    symbols: z.array(z.string()).default([])
      .describe("Allowed symbols, e.g. ['BTCUSDT','ETHUSDT','AAPL']. Empty = unrestricted on this axis."),
    assetClasses: z.array(z.string()).default([])
      .describe("Allowed asset classes: 'crypto', 'us_equity', 'options', 'defi'. Empty = unrestricted."),
    venues: z.array(z.string()).default([])
      .describe("Allowed venues, e.g. ['binance','alpaca']. Empty = unrestricted."),
    note: z.string().optional().describe("Trader's note on why this universe."),
  }),
  outputSchema: z.object({
    saved: z.boolean(),
    symbolsCount: z.number(),
    assetClassesCount: z.number(),
    venuesCount: z.number(),
  }),
  execute: async ({ symbols, assetClasses, venues, note }) => {
    const saved = saveUniverse({
      symbols,
      assetClasses,
      venues,
      declaredAt: new Date().toISOString(),
      note,
    });
    recordStructuredObservation({
      eventType: "execution.universe_set",
      workflow: "execution",
      source: "agent_tool",
      component: "set_trading_universe",
      toolName: "set_trading_universe",
      outcome: "info",
      details: {
        symbols: saved.symbols,
        assetClasses: saved.assetClasses,
        venues: saved.venues,
      },
    });
    return {
      saved: true,
      symbolsCount: saved.symbols.length,
      assetClassesCount: saved.assetClasses.length,
      venuesCount: saved.venues.length,
    };
  },
});

export const checkUniverseTool = createTool({
  id: "check_universe",
  description:
    "Check whether a symbol/asset-class/venue is inside the trader's declared universe. " +
    "Use BEFORE generating a plan to avoid wasted work on out-of-universe ideas.",
  inputSchema: z.object({
    symbol: z.string().min(1),
    assetClass: z.string().optional(),
    venue: z.string().optional(),
  }),
  outputSchema: z.object({
    allowed: z.boolean(),
    matchedOn: z.array(z.string()),
    violations: z.array(z.string()),
    reason: z.string().optional(),
  }),
  execute: async ({ symbol, assetClass, venue }) => {
    const r = checkUniverse({ symbol, assetClass, venue });
    return {
      allowed: r.allowed,
      matchedOn: r.matchedOn as string[],
      violations: r.violations,
      reason: r.reason,
    };
  },
});

export const setRunningThesisTool = createTool({
  id: "set_running_thesis",
  description:
    "Declare the trader's running thesis with structured fields (bias, market focus, time horizon, " +
    "conviction floor) and a verbatim note. Under GORDON_THESIS_COHERENCE mode, execute_plan scores " +
    "each plan against this thesis and blocks below threshold. Anti-portfolio-rot guard: defends " +
    "against cumulative drift where each individual trade looks fine but the running portfolio drifts " +
    "incoherent. Ask the user to articulate the thesis — do not fabricate.",
  inputSchema: z.object({
    bias: z.enum(["long", "short", "neutral"]),
    marketFocus: z.array(z.string()).default([])
      .describe("Asset classes in focus: 'crypto', 'us_equity', 'options', 'defi'."),
    timeHorizon: z.enum(["intraday", "swing", "position"]),
    convictionMin: z.number().int().min(1).max(10)
      .describe("Minimum conviction (1-10) required for a plan."),
    note: z.string().min(10).describe("Trader's verbatim thesis note."),
    expiresAt: z.string().optional().describe("ISO timestamp when this thesis goes stale."),
  }),
  outputSchema: z.object({
    saved: z.boolean(),
    bias: z.string(),
    marketFocus: z.array(z.string()),
    timeHorizon: z.string(),
    convictionMin: z.number(),
    declaredAt: z.string(),
  }),
  execute: async ({ bias, marketFocus, timeHorizon, convictionMin, note, expiresAt }) => {
    const saved = saveRunningThesis({
      bias,
      marketFocus,
      timeHorizon,
      convictionMin,
      note,
      declaredAt: new Date().toISOString(),
      expiresAt,
    });
    recordStructuredObservation({
      eventType: "execution.thesis_set",
      workflow: "execution",
      source: "agent_tool",
      component: "set_running_thesis",
      toolName: "set_running_thesis",
      outcome: "info",
      details: {
        bias: saved.bias,
        marketFocus: saved.marketFocus,
        timeHorizon: saved.timeHorizon,
        convictionMin: saved.convictionMin,
      },
    });
    return {
      saved: true,
      bias: saved.bias,
      marketFocus: saved.marketFocus,
      timeHorizon: saved.timeHorizon,
      convictionMin: saved.convictionMin,
      declaredAt: saved.declaredAt,
    };
  },
});

export const setStrategyMandateTool = createTool({
  id: "set_strategy_mandate",
  description:
    "Declare or update a named strategy mandate with its own scope (asset classes, venues, strategy tags) " +
    "and risk budget (max position size, max allocation, max open positions). Plans route to the most " +
    "specific matching mandate. Anti-god-object guard: defends against one undifferentiated mandate " +
    "trying to cover crypto + equity + options + DeFi simultaneously. Each call replaces the full " +
    "mandate registry (idempotent re-declaration model).",
  inputSchema: z.object({
    mandates: z.array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        assetClasses: z.array(z.string()).default([]),
        venues: z.array(z.string()).default([]),
        strategyTags: z.array(z.string()).default([]),
        maxPositionPct: z.number().min(0).max(100),
        maxAllocationPct: z.number().min(0).max(100),
        maxOpenPositions: z.number().int().min(0),
        note: z.string().optional(),
      }),
    ).min(1),
  }),
  outputSchema: z.object({
    saved: z.boolean(),
    count: z.number(),
    mandateIds: z.array(z.string()),
  }),
  execute: async ({ mandates }) => {
    const now = new Date().toISOString();
    const records: StrategyMandate[] = mandates.map((m) => ({
      ...m,
      declaredAt: now,
    }));
    const saved = saveMandates(records);
    recordStructuredObservation({
      eventType: "execution.strategy_mandates_set",
      workflow: "execution",
      source: "agent_tool",
      component: "set_strategy_mandate",
      toolName: "set_strategy_mandate",
      outcome: "info",
      details: {
        mandateIds: saved.map((m) => m.id),
      },
    });
    return {
      saved: true,
      count: saved.length,
      mandateIds: saved.map((m) => m.id),
    };
  },
});

export const antiTrapTools = {
  record_user_thesis: recordUserThesisTool,
  record_supervision_outcome: recordSupervisionOutcomeTool,
  set_trading_universe: setTradingUniverseTool,
  check_universe: checkUniverseTool,
  set_running_thesis: setRunningThesisTool,
  set_strategy_mandate: setStrategyMandateTool,
} as const;
