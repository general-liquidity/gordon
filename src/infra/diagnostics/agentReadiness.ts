/**
 * Agent Readiness Gate (GORDON_AGENT_READINESS_GATE).
 *
 * Ports L06 from learn-harness-engineering — the bootstrap contract's
 * four conditions verified at session start, BEFORE the agent does
 * substantive work:
 *
 *   can_start       — the runtime can boot (doctor structural checks pass)
 *   can_test        — verification surface reachable (paper mode + eval-harness)
 *   can_see_progress — thread + ACE journal load
 *   can_hand_off    — last-session artifact present (or known-fresh state)
 *
 * Each condition returns pass/warn/fail with an actionable remediation
 * string. When the gate is enabled and ANY condition fails, the gate
 * blocks startup with the operator's specific next step.
 *
 * Independent of the clean-state gate (L12) — that one runs at SESSION
 * END to verify the exit is clean; this one runs at SESSION START to
 * verify the entry is sound.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface ReadinessCondition {
  id: "can_start" | "can_test" | "can_see_progress" | "can_hand_off";
  status: "pass" | "warn" | "fail";
  message: string;
  remediation?: string;
}

export interface ReadinessVerdict {
  ready: boolean;
  conditions: ReadinessCondition[];
  blockingMessage?: string;
}

export function isAgentReadinessGateEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    env.GORDON_AGENT_READINESS_GATE === "1" ||
    env.GORDON_AGENT_READINESS_GATE === "true"
  );
}

export interface ReadinessInputs {
  /** Filesystem path to the Gordon home dir (~/.gordon by default). */
  gordonHomeDir?: string;
  /** Path to the ACE lessons file. */
  aceLessonsPath?: string;
  /** Path to the Mastra storage DB. */
  mastraDbPath?: string;
  /** Path to the session-handoff artifact (if any). */
  sessionHandoffPath?: string;
  /** Whether a paper-mode broker/exchange is configured and reachable. */
  paperModeReachable?: boolean;
  /** Whether the eval-harness scenarios import cleanly. */
  evalHarnessReachable?: boolean;
  /** Number of action-log entries present (proxy for "see progress"). */
  actionLogEntryCount?: number;
}

function defaultInputs(env: NodeJS.ProcessEnv = process.env): ReadinessInputs {
  const home = env.GORDON_HOME || join(homedir(), ".gordon");
  return {
    gordonHomeDir: home,
    aceLessonsPath: env.GORDON_ACE_LESSONS_PATH || join(home, "ace-lessons.json"),
    mastraDbPath: env.DATABASE_URL?.startsWith("file:")
      ? env.DATABASE_URL.slice("file:".length)
      : "gordon.db",
    sessionHandoffPath: env.GORDON_SESSION_HANDOFF_PATH || join(home, "session-handoff.json"),
  };
}

function checkCanStart(inputs: ReadinessInputs): ReadinessCondition {
  const home = inputs.gordonHomeDir;
  if (!home) {
    return {
      id: "can_start",
      status: "fail",
      message: "Gordon home dir is undefined.",
      remediation: "Set GORDON_HOME or ensure ~/.gordon exists.",
    };
  }
  if (!existsSync(home)) {
    return {
      id: "can_start",
      status: "warn",
      message: `Gordon home dir not present at ${home}.`,
      remediation: "First-run will create it; not blocking, but the bootstrap contract is not yet established.",
    };
  }
  return { id: "can_start", status: "pass", message: `Gordon home dir at ${home}.` };
}

function checkCanTest(inputs: ReadinessInputs): ReadinessCondition {
  const paperReachable = inputs.paperModeReachable ?? null;
  const evalReachable = inputs.evalHarnessReachable ?? null;
  if (paperReachable === null && evalReachable === null) {
    return {
      id: "can_test",
      status: "warn",
      message: "Neither paper-mode reachability nor eval-harness reachability was probed.",
      remediation: "Pass paperModeReachable / evalHarnessReachable to the readiness inputs.",
    };
  }
  if (paperReachable === false && evalReachable === false) {
    return {
      id: "can_test",
      status: "fail",
      message: "Verification surfaces unreachable: paper mode failed, eval-harness failed.",
      remediation: "Configure paper-mode credentials OR ensure `bun test src/infra/domain/evals/harness/` runs.",
    };
  }
  if (paperReachable === true || evalReachable === true) {
    return {
      id: "can_test",
      status: "pass",
      message: `Verification reachable (paper=${paperReachable ?? "?"}, eval=${evalReachable ?? "?"}).`,
    };
  }
  return {
    id: "can_test",
    status: "warn",
    message: "Partial verification surface — one of paper/eval is unreachable.",
    remediation: "At least one verification path should be reliably reachable.",
  };
}

function checkCanSeeProgress(inputs: ReadinessInputs): ReadinessCondition {
  const ace = inputs.aceLessonsPath;
  const db = inputs.mastraDbPath;
  const aceExists = ace ? existsSync(ace) : false;
  const dbExists = db ? existsSync(db) : false;
  const logCount = inputs.actionLogEntryCount ?? null;

  if (!aceExists && !dbExists && (logCount === null || logCount === 0)) {
    return {
      id: "can_see_progress",
      status: "warn",
      message: "No progress artifacts present (ACE lessons, Mastra DB, action log all empty).",
      remediation: "This is fine for first-ever startup; otherwise prior session state may have been lost.",
    };
  }
  if (!aceExists && !dbExists) {
    return {
      id: "can_see_progress",
      status: "warn",
      message: `Action log has entries (${logCount}) but ACE + Mastra DB are missing.`,
      remediation: "Working memory will start fresh — consider whether this was intentional.",
    };
  }
  return {
    id: "can_see_progress",
    status: "pass",
    message: `Progress visible: ace=${aceExists}, db=${dbExists}, log=${logCount ?? "?"}.`,
  };
}

function checkCanHandOff(inputs: ReadinessInputs): ReadinessCondition {
  const path = inputs.sessionHandoffPath;
  if (!path) {
    return {
      id: "can_hand_off",
      status: "warn",
      message: "Session handoff path not provided.",
      remediation: "Define GORDON_SESSION_HANDOFF_PATH or accept that handoff context is implicit.",
    };
  }
  if (!existsSync(path)) {
    // Treat as informational — a fresh repo legitimately has no handoff yet.
    return {
      id: "can_hand_off",
      status: "warn",
      message: `No handoff artifact at ${path}.`,
      remediation: "Assumed fresh-start; if this is a continuation, ensure prior session writes a handoff.",
    };
  }
  try {
    const stat = statSync(path);
    if (stat.size === 0) {
      return {
        id: "can_hand_off",
        status: "warn",
        message: `Handoff artifact exists at ${path} but is empty.`,
        remediation: "Treat as fresh-start; the previous session didn't write its closing state.",
      };
    }
    const raw = readFileSync(path, "utf8");
    JSON.parse(raw);
    return { id: "can_hand_off", status: "pass", message: `Handoff present at ${path} (${stat.size}B).` };
  } catch (err) {
    return {
      id: "can_hand_off",
      status: "fail",
      message: `Handoff artifact unparseable: ${err instanceof Error ? err.message : String(err)}.`,
      remediation: "Inspect the file or delete it to start fresh.",
    };
  }
}

/**
 * Run the four bootstrap-contract checks. Returns the verdict and
 * per-condition remediation.
 */
export function checkAgentReadiness(
  inputs: ReadinessInputs = defaultInputs(),
): ReadinessVerdict {
  const conditions = [
    checkCanStart(inputs),
    checkCanTest(inputs),
    checkCanSeeProgress(inputs),
    checkCanHandOff(inputs),
  ];
  const failing = conditions.filter((c) => c.status === "fail");
  const ready = failing.length === 0;
  return {
    ready,
    conditions,
    blockingMessage: ready
      ? undefined
      : `Agent readiness blocked by ${failing.length} condition(s): ${failing.map((f) => f.id).join(", ")}. ` +
        `Run the failed conditions' remediations or set GORDON_AGENT_READINESS_OVERRIDE=1.`,
  };
}

export function hasReadinessOverride(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env.GORDON_AGENT_READINESS_OVERRIDE === "1" ||
    env.GORDON_AGENT_READINESS_OVERRIDE === "true"
  );
}

export function readinessToPayload(verdict: ReadinessVerdict): Record<string, unknown> {
  return {
    kind: "agent_readiness.gate_recorded",
    ready: verdict.ready,
    conditions: verdict.conditions.map((c) => ({
      id: c.id,
      status: c.status,
      message: c.message,
      remediation: c.remediation,
    })),
    blockingMessage: verdict.blockingMessage,
  };
}
