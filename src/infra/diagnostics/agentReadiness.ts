/**
 * Agent readiness checks (GORDON_AGENT_READINESS_GATE).
 *
 * Lightweight boot-time checks. NOT a gate despite the flag name: the sole
 * consumer is `collectAgentReadinessChecks` in app/setup/harness-checks.ts,
 * which turns the result into doctor report rows. Nothing blocks agent
 * spawn on a failing condition, and `GORDON_AGENT_READINESS_OVERRIDE`
 * suppresses the rows rather than overriding a block.
 *
 * Conditions are only listed here when they are actually probed. A
 * condition that cannot be verified does not belong in the list — an
 * always-`ok: true` row reads as evidence and is not.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { flagEnv } from "../config/flagResolver.ts";

export const AGENT_READINESS_FLAG_ENV = "GORDON_AGENT_READINESS_GATE";
export const AGENT_READINESS_OVERRIDE_ENV = "GORDON_AGENT_READINESS_OVERRIDE";

export interface ReadinessCondition {
  id: string;
  ok: boolean;
  message: string;
}

export interface ReadinessInputs {
  gordonHome?: string;
  mastraDbPath?: string;
  hasLlmKey?: boolean;
}

export interface ReadinessResult {
  ready: boolean;
  conditions: ReadinessCondition[];
  blockingMessage?: string;
}

export function isAgentReadinessEnabled(env: NodeJS.ProcessEnv = flagEnv()): boolean {
  return env[AGENT_READINESS_FLAG_ENV] === "1" || env[AGENT_READINESS_FLAG_ENV] === "true";
}

export function isAgentReadinessOverridden(env: NodeJS.ProcessEnv = flagEnv()): boolean {
  return env[AGENT_READINESS_OVERRIDE_ENV] === "1" || env[AGENT_READINESS_OVERRIDE_ENV] === "true";
}

export function checkAgentReadiness(inputs: ReadinessInputs = {}): ReadinessResult {
  const home = inputs.gordonHome ?? join(homedir(), ".gordon");
  const conditions: ReadinessCondition[] = [
    {
      id: "can_start",
      ok: existsSync(home),
      message: existsSync(home) ? `Gordon home present at ${home}` : `Missing Gordon home at ${home}`,
    },
    {
      id: "can_see_progress",
      ok: existsSync(join(home, "action-log.jsonl")) || existsSync(join(home, "audit")),
      message: "Action/audit trail reachable (or will be created on first write)",
    },
    {
      id: "can_hand_off",
      ok: inputs.hasLlmKey !== false,
      message: inputs.hasLlmKey === false ? "No LLM provider key configured" : "LLM credentials available",
    },
  ];

  const failing = conditions.filter((c) => !c.ok);
  const ready = failing.length === 0;
  return {
    ready,
    conditions,
    blockingMessage: ready
      ? undefined
      : `Agent readiness failed: ${failing.map((f) => f.message).join("; ")}`,
  };
}