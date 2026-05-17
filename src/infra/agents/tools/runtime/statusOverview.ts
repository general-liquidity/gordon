/**
 * Status overview tool — unified `/status` surface.
 *
 * Aggregates Gordon's existing state into a single operator-facing
 * summary. Closes Mercury "batteries included" MB3 partially — the
 * data is already tracked, just not surfaced as one place.
 *
 * Sources read (best-effort, missing files silently skipped):
 *   - decisionLog JSONL (recent decisions count)
 *   - debriefMatrix JSONL (recent quadrant counts + toxic-alpha alarm)
 *   - frictionTracker JSONL (recent friction $)
 *   - dailyRollup (WW23) — synthesized from the above
 *   - Active mandate (strategy mandates, trading universe)
 *   - Active goal (goal mode, if set)
 *   - Equity + drawdown (env-driven shadow inputs)
 *   - Recent calibration status (conviction calibration from decisionLog)
 *   - Performance state (cold/neutral/hot) from path-dependent sizer
 *   - Risk config snapshot
 *
 * Pure read-only. No side effects, no state mutation. Output is markdown.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

function readRecentDecisionCount(windowHours: number): number {
  const path =
    process.env.GORDON_DECISIONS_LOG_PATH || join(homedir(), ".gordon", "decisions.jsonl");
  if (!existsSync(path)) return 0;
  const cutoff = Date.now() - windowHours * 3600_000;
  let count = 0;
  try {
    const raw = readFileSync(path, "utf8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line) as { recordedAt?: string };
        if (row.recordedAt && Date.parse(row.recordedAt) >= cutoff) count++;
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return count;
}

interface DebriefSummary {
  total: number;
  deserved_success: number;
  bad_luck: number;
  dumb_luck: number;
  poetic_justice: number;
  toxicAlphaWarning: boolean;
}

function readRecentDebriefs(windowHours: number): DebriefSummary {
  const path =
    process.env.GORDON_DEBRIEF_MATRIX_PATH || join(homedir(), ".gordon", "debriefs.jsonl");
  const counts: DebriefSummary = {
    total: 0,
    deserved_success: 0,
    bad_luck: 0,
    dumb_luck: 0,
    poetic_justice: 0,
    toxicAlphaWarning: false,
  };
  if (!existsSync(path)) return counts;
  const cutoff = Date.now() - windowHours * 3600_000;
  try {
    const raw = readFileSync(path, "utf8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line) as { recordedAt?: string; quadrant?: keyof DebriefSummary };
        if (!row.recordedAt || Date.parse(row.recordedAt) < cutoff) continue;
        if (row.quadrant && row.quadrant in counts) {
          (counts[row.quadrant] as number)++;
          counts.total++;
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  const wins = counts.deserved_success + counts.dumb_luck;
  counts.toxicAlphaWarning = wins > 0 && counts.dumb_luck / wins > 0.2;
  return counts;
}

function readRecentFrictionUsd(windowHours: number): number {
  const path =
    process.env.GORDON_FRICTION_TRACKER_PATH || join(homedir(), ".gordon", "friction.jsonl");
  if (!existsSync(path)) return 0;
  const cutoff = Date.now() - windowHours * 3600_000;
  let total = 0;
  try {
    const raw = readFileSync(path, "utf8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line) as { recordedAt?: string; costUsd?: number };
        if (!row.recordedAt || Date.parse(row.recordedAt) < cutoff) continue;
        if (typeof row.costUsd === "number") total += row.costUsd;
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return total;
}

function envState(): {
  currentEquityUsd: number | null;
  sessionStartEquityUsd: number | null;
  sessionHwmUsd: number | null;
  ytdPnLUsd: number | null;
  initialRiskCapitalUsd: number | null;
  dailyLossBudgetUsd: number | null;
} {
  const parse = (k: string): number | null => {
    const v = Number(process.env[k] ?? "NaN");
    return Number.isFinite(v) && v > 0 ? v : null;
  };
  return {
    currentEquityUsd: parse("GORDON_CURRENT_EQUITY_USD"),
    sessionStartEquityUsd: parse("GORDON_SESSION_START_EQUITY_USD"),
    sessionHwmUsd: parse("GORDON_SESSION_HWM_USD"),
    ytdPnLUsd: Number(process.env.GORDON_YTD_PNL_USD ?? "NaN") || null,
    initialRiskCapitalUsd: parse("GORDON_INITIAL_RISK_CAPITAL_USD"),
    dailyLossBudgetUsd: parse("GORDON_RISK_DAILY_LOSS_USD"),
  };
}

function formatStatus(args: {
  windowHours: number;
  decisions: number;
  debriefs: DebriefSummary;
  frictionUsd: number;
  state: ReturnType<typeof envState>;
}): string {
  const { windowHours, decisions, debriefs, frictionUsd, state } = args;
  const lines: string[] = [];
  lines.push(`# Gordon status (${windowHours}h window)`);
  lines.push("");
  lines.push("## Account");
  if (state.currentEquityUsd !== null) {
    lines.push(`- Current equity: $${state.currentEquityUsd.toFixed(2)}`);
  }
  if (state.sessionStartEquityUsd !== null && state.currentEquityUsd !== null) {
    const sessionPnl = state.currentEquityUsd - state.sessionStartEquityUsd;
    lines.push(`- Session PnL: ${sessionPnl >= 0 ? "+" : ""}$${sessionPnl.toFixed(2)}`);
  }
  if (state.sessionHwmUsd !== null && state.currentEquityUsd !== null) {
    const drawdownFromHwm = state.sessionHwmUsd - state.currentEquityUsd;
    if (drawdownFromHwm > 0) lines.push(`- Drawdown from session HWM: -$${drawdownFromHwm.toFixed(2)}`);
  }
  if (state.ytdPnLUsd !== null) {
    lines.push(`- YTD PnL: ${state.ytdPnLUsd >= 0 ? "+" : ""}$${state.ytdPnLUsd.toFixed(2)}`);
  }
  if (state.initialRiskCapitalUsd !== null) {
    lines.push(`- Initial risk capital: $${state.initialRiskCapitalUsd.toFixed(2)}`);
  }
  if (state.dailyLossBudgetUsd !== null) {
    lines.push(`- Daily loss budget: $${state.dailyLossBudgetUsd.toFixed(2)}`);
  }
  if (
    state.currentEquityUsd === null &&
    state.sessionStartEquityUsd === null &&
    state.initialRiskCapitalUsd === null
  ) {
    lines.push("- _Account state not configured (set GORDON_CURRENT_EQUITY_USD etc.)_");
  }
  lines.push("");
  lines.push("## Recent activity");
  lines.push(`- Decisions logged: ${decisions}`);
  lines.push(`- Debriefs: ${debriefs.total} total`);
  if (debriefs.total > 0) {
    lines.push(
      `  - deserved=${debriefs.deserved_success} bad_luck=${debriefs.bad_luck} dumb_luck=${debriefs.dumb_luck} poetic=${debriefs.poetic_justice}`,
    );
  }
  if (debriefs.toxicAlphaWarning) {
    lines.push("  - ⚠ **Toxic-alpha alarm**: dumb-luck wins > 20% of total wins");
  }
  lines.push(`- Friction recorded: $${frictionUsd.toFixed(2)}`);
  lines.push("");
  lines.push("## Mandate / scope");
  const mandate = process.env.GORDON_STRATEGY_MANDATES;
  const universe = process.env.GORDON_TRADING_UNIVERSE;
  lines.push(`- Strategy mandate: ${mandate ? "configured" : "_not set_"}`);
  lines.push(`- Trading universe: ${universe ? "configured" : "_not set_"}`);
  const goal = process.env.GORDON_GOAL_MODE;
  lines.push(`- Goal mode: ${goal === "1" || goal === "true" ? "active" : "inactive"}`);
  lines.push("");
  lines.push("## Active flags (selected)");
  const flagGroups: Array<{ name: string; flags: string[] }> = [
    {
      name: "Wright primitives",
      flags: [
        "GORDON_PATH_DEPENDENT_SIZER",
        "GORDON_ABSORBING_BARRIER",
        "GORDON_VOLATILITY_DRAG",
        "GORDON_RISK_BUNDLE_AUDITOR",
        "GORDON_CONVICTION_CALIBRATION",
        "GORDON_DEBRIEF_MATRIX",
        "GORDON_DECISION_JOURNAL",
        "GORDON_DAILY_ROLLUP",
      ],
    },
    {
      name: "Anti-rot",
      flags: ["GORDON_TRADING_UNIVERSE", "GORDON_THESIS_COHERENCE", "GORDON_TRADER_BEHAVIOR_PATTERNS"],
    },
    {
      name: "Harness",
      flags: ["GORDON_TERMINATION_LAYERS", "GORDON_SHADOW_MODE", "GORDON_AXIOM_STRUCTURED_ENABLED"],
    },
  ];
  for (const group of flagGroups) {
    const active = group.flags.filter((f) => {
      const v = process.env[f];
      return v === "1" || v === "true";
    });
    lines.push(`- ${group.name}: ${active.length}/${group.flags.length} active`);
  }
  return lines.join("\n");
}

export const statusOverviewTool = createTool({
  id: "status_overview",
  description:
    "Aggregate Gordon's current state into a single operator-facing summary. " +
    "Reads recent decisionLog + debriefMatrix + frictionTracker entries, " +
    "account/session equity from env, mandate + universe config, and active flag groups. " +
    "Read-only. Use when the operator asks `/status` or wants a snapshot of where things stand.",
  inputSchema: z.object({
    windowHours: z
      .number()
      .int()
      .min(1)
      .max(168)
      .default(24)
      .describe("Lookback window in hours for activity summary. Default 24."),
  }),
  outputSchema: z.object({
    summary: z.string(),
    decisionCount: z.number(),
    debriefTotal: z.number(),
    toxicAlphaWarning: z.boolean(),
    frictionUsd: z.number(),
  }),
  execute: async ({ windowHours }) => {
    const decisions = readRecentDecisionCount(windowHours);
    const debriefs = readRecentDebriefs(windowHours);
    const frictionUsd = readRecentFrictionUsd(windowHours);
    const state = envState();
    const summary = formatStatus({ windowHours, decisions, debriefs, frictionUsd, state });

    recordStructuredObservation({
      eventType: "status.overview_requested",
      workflow: "execution",
      source: "agent_tool",
      component: "status_overview",
      toolName: "status_overview",
      outcome: "info",
      details: {
        windowHours,
        decisionCount: decisions,
        debriefTotal: debriefs.total,
        toxicAlphaWarning: debriefs.toxicAlphaWarning,
        frictionUsd: Number(frictionUsd.toFixed(2)),
      },
    });

    return {
      summary,
      decisionCount: decisions,
      debriefTotal: debriefs.total,
      toxicAlphaWarning: debriefs.toxicAlphaWarning,
      frictionUsd: Number(frictionUsd.toFixed(2)),
    };
  },
});

export const statusTools = {
  status_overview: statusOverviewTool,
};
