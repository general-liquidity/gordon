/**
 * Agent Feedback Tool
 *
 * Lets the agent proactively signal when it's stuck or hitting a pattern
 * that isn't working. Borrowed from the "Designing for Agents" pattern
 * Ramp ships in their MCP — the LLM has context the system doesn't, and
 * a dedicated channel for it to report back is more useful than waiting
 * for a doom-loop detector to catch the symptom.
 *
 * Differs from the existing doom-loop detector (runtimeHarness.ts):
 *   - Doom-loop = REACTIVE: fingerprint-based, fires after identical
 *     calls repeat 3+ times in a 20-call window. Catches symptoms.
 *   - This tool = PROACTIVE: the agent self-reports BEFORE the loop
 *     trips, with structured intent + attempts + blocker context that
 *     fingerprint matching cannot produce.
 *
 * Output is twofold:
 *   1. Appended to ~/.gordon/agent-feedback.jsonl (review-queue pattern,
 *      same as the eval-failures bucket) so the user can grep/triage.
 *   2. Recorded as a structured observation so the audit log + Axiom
 *      see it correlated with the surrounding trace.
 *
 * Recovery-tier integration: when this tool fires, callers (recovery
 * tiers, /context surface, supervisor logic) can skip the "Notify" tier
 * and jump directly to Redirect — the agent has already self-reported,
 * so silently re-trying is wasted effort.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";

import { recordStructuredObservation } from "../../../../platform/observability/index.ts";
import { appendActionLogEntry } from "../../../../action-log/index.ts";
import { createModuleLogger } from "../../../../logger/index.ts";

const logger = createModuleLogger("agent-feedback");

export interface AgentFeedbackEntry {
  intent: string;
  approachesTried: ReadonlyArray<string>;
  blocker: string;
  suggestedNext?: string;
  severity: "low" | "medium" | "high";
  appendedAt: string;
}

export function defaultAgentFeedbackPath(): string {
  const fromEnv = process.env.GORDON_AGENT_FEEDBACK_PATH;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return join(homedir(), ".gordon", "agent-feedback.jsonl");
}

export function appendAgentFeedback(
  entry: Omit<AgentFeedbackEntry, "appendedAt">,
  path: string = defaultAgentFeedbackPath(),
): { written: boolean; path: string; error?: string } {
  try {
    const dir = dirname(path);
    mkdirSync(dir, { recursive: true });
    const row: AgentFeedbackEntry = {
      ...entry,
      appendedAt: new Date().toISOString(),
    };
    appendFileSync(path, JSON.stringify(row) + "\n", { encoding: "utf-8" });
    return { written: true, path };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("Agent-feedback append failed — continuing without persistence", {
      path,
      err: msg,
    });
    return { written: false, path, error: msg };
  }
}

export function readAgentFeedback(
  path: string = defaultAgentFeedbackPath(),
): ReadonlyArray<AgentFeedbackEntry> {
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, { encoding: "utf-8" });
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    const out: AgentFeedbackEntry[] = [];
    for (const line of lines) {
      try {
        out.push(JSON.parse(line));
      } catch {
        // Skip malformed line, keep going.
      }
    }
    return out.reverse();
  } catch (err) {
    logger.warn("Agent-feedback read failed", {
      path,
      err: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

export const reportBlockedTool = createTool({
  id: "report_blocked",
  description:
    "Signal that you are stuck on the current task. Use BEFORE retrying the same approach again — " +
    "if you're about to call the same tool with the same arguments for the third time, call this " +
    "instead. The user / supervisor sees your structured report and can redirect you. Do NOT use " +
    "this tool as a substitute for thinking harder on the first or second try; only use when a " +
    "real blocker exists that no further attempts will resolve.",
  inputSchema: z.object({
    intent: z
      .string()
      .min(10)
      .describe(
        "What you were trying to accomplish, in one sentence (e.g. 'Place a BTC long after the user confirmed the plan')",
      ),
    approachesTried: z
      .array(z.string().min(5))
      .min(1)
      .max(10)
      .describe(
        "List the specific approaches you've already attempted, each as a short phrase (e.g. ['called execute_plan with planId=p1, got risk_rejected', 'retried after adjusting size, got same rejection'])",
      ),
    blocker: z
      .string()
      .min(10)
      .describe(
        "What specifically is preventing progress (e.g. 'Risk classifier blocks every variant because portfolio drawdown is at 4.8% of the 5% daily cap')",
      ),
    suggestedNext: z
      .string()
      .optional()
      .describe(
        "Optional: what would unblock you. Caller decides whether to act on it (e.g. 'User would need to raise the daily drawdown cap or close the existing position first')",
      ),
    severity: z
      .enum(["low", "medium", "high"])
      .default("medium")
      .describe(
        "low = curiosity, medium = task can't complete cleanly, high = safety-critical or user-blocking",
      ),
  }),
  outputSchema: z.object({
    acknowledged: z.boolean(),
    path: z.string(),
    severity: z.string(),
    error: z.string().optional(),
  }),
  execute: async ({ intent, approachesTried, blocker, suggestedNext, severity }) => {
    const result = appendAgentFeedback({
      intent,
      approachesTried,
      blocker,
      suggestedNext,
      severity,
    });

    recordStructuredObservation({
      eventType: "agent.reported_blocked",
      workflow: "recovery",
      source: "agent_tool",
      component: "report_blocked",
      toolName: "report_blocked",
      outcome: severity === "high" ? "failure" : "info",
      status: `severity_${severity}`,
      reason: blocker,
      details: {
        intent,
        approachesTried: [...approachesTried],
        suggestedNext,
        feedbackPath: result.path,
        persisted: result.written,
      },
    });

    // Bridge into the action log so ACE Reflector can extract self-block
    // patterns. The new agent_self_block rule keys on "reported blocked"
    // markers in title + blocker text in content.
    try {
      appendActionLogEntry({
        entryType: "run_status",
        title: `Agent reported blocked (severity: ${severity})`,
        content: `Agent reported blocked while attempting: "${intent}". Blocker: ${blocker}. Approaches tried: ${approachesTried.join("; ")}.${suggestedNext ? ` Suggested next: ${suggestedNext}.` : ""}`,
        payload: {
          intent,
          blocker,
          approachesTried: [...approachesTried],
          suggestedNext,
          severity,
        },
      });
    } catch {
      // Non-critical — JSONL persistence + structured observation already covered.
    }

    return {
      acknowledged: true,
      path: result.path,
      severity,
      ...(result.error ? { error: result.error } : {}),
    };
  },
});

export const agentFeedbackTools = {
  report_blocked: reportBlockedTool,
};
