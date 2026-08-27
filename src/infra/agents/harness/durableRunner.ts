/**
 * Native Durable Autonomous Runner (Mastra 1.51 durable-agents + goals + bg-tasks)
 *
 * ADDITIVE + FLAG-GATED, default-off. `GORDON_DURABLE_AGENTS=1` activates the
 * native durable-agent path for Gordon's autonomous loop:
 *   - durable agent   — `createDurableAgent({ agent, cache })`: the run survives
 *     a process restart, exposes `stream() -> { output, runId, cleanup, abort }`,
 *     `observe(runId)`, `resume(runId, ...)`, and `recoverActiveRuns()`.
 *   - background tasks — `durableAgent.stream(objective, { untilIdle: true })`
 *     keeps the outer stream open across background-task continuations instead of
 *     the hand-rolled interval scan cadence.
 *   - native goal loop — `durableAgent.setObjective(objective, { ... })` persists
 *     the objective; the agent's constructor `goal: { judge, maxRuns, prompt }`
 *     config drives the per-iteration LLM-judge continue/stop decision.
 *
 * When the flag is unset (default), this module is never engaged and Gordon's
 * existing autonomous-loop plumbing (`core/pipeline/autonomous-loop.ts`) stays the
 * default with IDENTICAL behavior.
 *
 * STORAGE / REDIS LIMITATION (beta): durable agents cache their stream events in
 * a `MastraServerCache`. Cross-restart durability of the live event stream needs
 * a shared cache/pubsub such as Redis. Gordon runs on libSQL storage with no
 * Redis, so this runner defaults to the in-process `InMemoryServerCache`. That
 * still gives resumable streams WITHIN a process and — because durable-run
 * workflow snapshots persist to the Mastra storage (libSQL) — `recoverActiveRuns`
 * can re-drive an orphaned run after a restart; only the in-flight event cache is
 * lost on restart, not the run itself. Point `cache` at a Redis-backed
 * `MastraServerCache` to make the live stream survive a restart too.
 *
 * BETA: Mastra flags agent goals as `@experimental` and the durable-agent surface
 * as beta; the symbols may change in a future release. This module isolates that
 * surface behind the flag so the money-path default is untouched.
 *
 * MONEY-PATH SAFETY (non-negotiable): the durable path does NOT bypass any gate.
 *   - kill switch    — `preflight()` evaluates `isExecutionAllowed()` for the
 *     mandate scope and refuses to start when any switch is tripped.
 *   - sprint contract — a `SprintContract` is recorded at run start (same artifact
 *     the existing loop seals) so an operator can diff scope vs actuals.
 *   - WIP-limit gate  — unchanged and still enforced downstream inside
 *     `execute_plan`; this runner never places orders itself, so the per-symbol /
 *     per-strategy / global WIP caps apply to every trade the durable run proposes
 *     exactly as they do on the default path. `preflight()` surfaces whether the
 *     WIP subsystem is enabled for observability.
 */

import { createModuleLogger } from "../../logger/index.ts";
import {
  isExecutionAllowed,
  isKillSwitchesEnabled,
  killSwitchesToPayload,
  type ExecutionContext,
  type ExecutionDecision,
} from "../../safety/killSwitches.ts";
import {
  createSprintContract,
  contractToPayload,
  type SprintContract,
} from "../../safety/sprintContract.ts";
import { isWipLimitEnabled } from "../../safety/wipLimit.ts";
import type { SwingMandate } from "../../../core/safety/swing-mandate.ts";

const logger = createModuleLogger("durable-runner");

/** Flag env — `GORDON_DURABLE_AGENTS=1` activates the native durable path. */
export const DURABLE_AGENTS_FLAG_ENV = "GORDON_DURABLE_AGENTS";

/**
 * Gate flag. Off (default) keeps the hand-rolled autonomous loop; on activates
 * the durable-agent + native-goal + background-task path. Accepts `1`/`true`/`yes`.
 */
export function isDurableAgentsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[DURABLE_AGENTS_FLAG_ENV];
  if (typeof raw !== "string") return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

/**
 * Minimal structural view of a Mastra `DurableAgent` — only the members this
 * runner touches. Typed structurally (not as the concrete `DurableAgent`) so the
 * real `createDurableAgent` result satisfies it AND tests can inject a fake
 * without constructing a full Mastra instance.
 */
export interface DurableAgentLike {
  stream(messages: unknown, options?: Record<string, unknown>): Promise<DurableStreamResultLike>;
  setObjective?(
    objective: string,
    options: {
      threadId: string;
      resourceId?: string;
      judgeModelId?: string;
      maxRuns?: number;
      prompt?: string;
      id?: string;
    },
  ): Promise<unknown>;
  observe?(runId: string, options?: Record<string, unknown>): Promise<DurableStreamResultLike>;
  resume?(
    runId: string,
    resumeData: unknown,
    options?: Record<string, unknown>,
  ): Promise<DurableStreamResultLike>;
  recoverActiveRuns?(options?: Record<string, unknown>): Promise<{
    recovered: Array<{ runId: string; status: "success" | "failed" }>;
    succeeded: number;
    failed: number;
  }>;
}

/** Structural view of `DurableAgent.stream()`'s result. */
export interface DurableStreamResultLike {
  output: unknown;
  runId: string;
  threadId?: string;
  resourceId?: string;
  cleanup: () => void;
  abort?: (reason?: unknown) => void;
}

/** The Mastra Agent handle to wrap. Structural to avoid a hard type dependency. */
export interface WrappableAgent {
  id?: string;
  name?: string;
}

/** Injectable durable-agent factory. Defaults to the real `createDurableAgent`. */
export type CreateDurableFn = (opts: {
  agent: WrappableAgent;
  cache?: unknown;
  maxSteps?: number;
}) => DurableAgentLike;

/** Native goal-loop knobs forwarded to `setObjective` per run. */
export interface DurableGoalConfig {
  /** Judge model id. The agent's constructor `goal.judge` must also be set. */
  judgeModelId?: string;
  /** Max goal evaluations before the loop stops. Mastra default: 50. */
  maxRuns?: number;
  /** Extra judge guidance appended to the built-in goal-judge prompt. */
  prompt?: string;
}

export interface DurableRunnerConfig {
  /** The orchestrator agent to wrap (e.g. `getGordon()`). */
  agent: WrappableAgent;
  /** Active mandate — defines the safety scope (venue/strategy) + sprint scope. */
  mandate: SwingMandate;
  /** Memory thread the durable run + objective are scoped to. */
  threadId: string;
  /** Memory resource (user) the run + objective are scoped to. */
  resourceId: string;
  /**
   * Stream-event cache. Omit for the in-process `InMemoryServerCache` (default,
   * resolved lazily by `createDurableAgent`); pass a Redis-backed
   * `MastraServerCache` for cross-restart live-stream durability; `false` to
   * disable the resumable cache entirely.
   */
  cache?: unknown;
  /** Native goal-loop knobs forwarded to `setObjective`. */
  goal?: DurableGoalConfig;
  /** Max durable agentic steps. */
  maxSteps?: number;
  /**
   * Idle timeout for the background-task loop (`stream(..., { untilIdle })`).
   * `true` uses Mastra's default (5 min); a number sets `maxIdleMs`.
   */
  untilIdle?: boolean | number;
  /** Injectable factory (tests). Defaults to the real `createDurableAgent`. */
  createDurable?: CreateDurableFn;
}

/** Refusal returned when a safety preflight blocks the durable run. */
export interface DurablePreflightBlocked {
  allowed: false;
  reason: string;
  decision: ExecutionDecision;
  payload: Record<string, unknown>;
}

/** Approval returned when a safety preflight passes. */
export interface DurablePreflightAllowed {
  allowed: true;
  reason: string;
  killSwitchesEnabled: boolean;
  wipLimitEnabled: boolean;
}

export type DurablePreflight = DurablePreflightAllowed | DurablePreflightBlocked;

/** Blocked start — no agent call was made. */
export interface DurableStartBlocked {
  ok: false;
  reason: string;
  preflight: DurablePreflightBlocked;
}

/** Live durable run handle. */
export interface DurableStartStarted {
  ok: true;
  runId: string;
  output: unknown;
  threadId?: string;
  resourceId?: string;
  cleanup: () => void;
  abort: (reason?: unknown) => void;
  sprintContract: SprintContract;
}

export type DurableStartResult = DurableStartBlocked | DurableStartStarted;

/** The runner surface consumed by the autonomous-loop entry (flag-gated). */
export interface DurableAutonomousRunner {
  /** Evaluate the money-path gates without starting anything. */
  preflight(): DurablePreflight;
  /**
   * Start a durable, goal-driven autonomous run for `objective`. Runs the
   * safety preflight first and REFUSES (no agent call) when a kill switch is
   * tripped. On approval: records the sprint contract, sets the native goal
   * objective, and opens the durable background-task idle stream.
   */
  start(objective: string): Promise<DurableStartResult>;
  /** Reattach to a live/finished durable run's event stream. */
  observe(runId: string): Promise<DurableStreamResultLike>;
  /** Resume a suspended durable run (e.g. after a tool-approval gate). */
  resume(runId: string, resumeData: unknown): Promise<DurableStreamResultLike>;
  /** Re-drive durable runs orphaned by a process restart (boot-time hook). */
  recover(): Promise<{ succeeded: number; failed: number }>;
}

/** Build the kill-switch execution context for a mandate's scope. */
function mandateExecutionContext(mandate: SwingMandate): ExecutionContext {
  return {
    strategyId: mandate.id,
    // Symbols scope the run; the firm-wide switch always applies regardless.
    instrument: mandate.symbols.length === 1 ? mandate.symbols[0] : undefined,
  };
}

/**
 * Build the flag-gated native durable autonomous runner. Pure construction — no
 * side effects until `start()` / `recover()` is called. `createDurable` defaults
 * to the real `createDurableAgent`; tests inject a fake.
 */
export function buildDurableAutonomousRunner(config: DurableRunnerConfig): DurableAutonomousRunner {
  const createDurable = config.createDurable ?? defaultCreateDurable;

  let durable: DurableAgentLike | null = null;
  function ensureDurable(): DurableAgentLike {
    if (!durable) {
      durable = createDurable({
        agent: config.agent,
        cache: config.cache,
        maxSteps: config.maxSteps,
      });
    }
    return durable;
  }

  function preflight(): DurablePreflight {
    const decision = isExecutionAllowed(mandateExecutionContext(config.mandate));
    if (!decision.allowed) {
      return {
        allowed: false,
        reason: `${decision.reason}. Reset the relevant kill switch before starting the durable run.`,
        decision,
        payload: killSwitchesToPayload(decision),
      };
    }
    return {
      allowed: true,
      reason: decision.reason,
      killSwitchesEnabled: isKillSwitchesEnabled(),
      wipLimitEnabled: isWipLimitEnabled(),
    };
  }

  async function start(objective: string): Promise<DurableStartResult> {
    const gate = preflight();
    if (!gate.allowed) {
      logger.warn("Durable autonomous run refused by kill-switch preflight", {
        mandateId: config.mandate.id,
        reason: gate.reason,
      });
      return { ok: false, reason: gate.reason, preflight: gate };
    }

    // Record the sprint-contract intent artifact (same shape the default loop
    // seals) so scope vs actuals stays inspectable on the durable path too.
    const venues: string[] = [];
    const sprintContract = createSprintContract({
      scope: {
        symbols: config.mandate.symbols ?? [],
        venues,
        strategies: [config.mandate.id],
      },
      verificationStandards: [
        `min confidence above ${config.mandate.minConfidence}`,
        `max drawdown within ${config.mandate.maxDrawdown}%`,
        `mandate ${config.mandate.id} not breached`,
      ],
      exclusions: [`no trading outside mandate ${config.mandate.id}`],
      intent: `durable autonomous loop on mandate ${config.mandate.id}`,
    });
    logger.info("Sprint contract recorded (durable path)", contractToPayload(sprintContract));

    const agent = ensureDurable();

    // Native goal loop: persist the objective for this thread. The judge/stop
    // decision is driven by the agent's constructor `goal.judge` config; a judge
    // model (here or there) is required for the goal to gate anything.
    if (agent.setObjective) {
      try {
        await agent.setObjective(objective, {
          threadId: config.threadId,
          resourceId: config.resourceId,
          judgeModelId: config.goal?.judgeModelId,
          maxRuns: config.goal?.maxRuns,
          prompt: config.goal?.prompt,
        });
      } catch (error) {
        // Objective persistence needs memory-backed storage; a failure must not
        // silently drop into a runaway loop — refuse the run.
        const reason = `Failed to set durable goal objective: ${(error as Error).message}`;
        logger.warn(reason, { mandateId: config.mandate.id });
        return {
          ok: false,
          reason,
          preflight: {
            allowed: false,
            reason,
            decision: { allowed: false, blockingKeys: [], reason },
            payload: {},
          },
        };
      }
    }

    const untilIdle =
      typeof config.untilIdle === "number"
        ? { maxIdleMs: config.untilIdle }
        : (config.untilIdle ?? true);

    const result = await agent.stream(objective, {
      untilIdle,
      memory: { thread: config.threadId, resource: config.resourceId },
    });

    logger.info("Durable autonomous run started", {
      mandateId: config.mandate.id,
      runId: result.runId,
      maxRuns: config.goal?.maxRuns,
    });

    return {
      ok: true,
      runId: result.runId,
      output: result.output,
      threadId: result.threadId,
      resourceId: result.resourceId,
      cleanup: result.cleanup,
      abort: result.abort ?? (() => {}),
      sprintContract,
    };
  }

  async function observe(runId: string): Promise<DurableStreamResultLike> {
    const agent = ensureDurable();
    if (!agent.observe) {
      throw new Error("Durable agent does not support observe()");
    }
    return agent.observe(runId);
  }

  async function resume(runId: string, resumeData: unknown): Promise<DurableStreamResultLike> {
    const agent = ensureDurable();
    if (!agent.resume) {
      throw new Error("Durable agent does not support resume()");
    }
    return agent.resume(runId, resumeData, {
      memory: { thread: config.threadId, resource: config.resourceId },
    });
  }

  async function recover(): Promise<{ succeeded: number; failed: number }> {
    const agent = ensureDurable();
    if (!agent.recoverActiveRuns) {
      return { succeeded: 0, failed: 0 };
    }
    const res = await agent.recoverActiveRuns({ resourceId: config.resourceId });
    logger.info("Durable autonomous runs recovered", {
      succeeded: res.succeeded,
      failed: res.failed,
    });
    return { succeeded: res.succeeded, failed: res.failed };
  }

  return { preflight, start, observe, resume, recover };
}

/**
 * Default durable-agent factory. Lazily imports the Mastra durable surface so the
 * heavy dependency is only paid when the flag is on and a run actually starts.
 */
const defaultCreateDurable: CreateDurableFn = (opts) => {
  // Lazy require keeps the durable/beta surface out of the default (flag-off)
  // import graph. `createDurableAgent` inherits its cache from the Mastra
  // instance when `cache` is undefined (in-process InMemoryServerCache here,
  // since Gordon has no Redis).
  const { createDurableAgent } =
    require("@mastra/core/agent/durable") as typeof import("@mastra/core/agent/durable");
  return createDurableAgent({
    agent: opts.agent as never,
    ...(opts.cache !== undefined ? { cache: opts.cache as never } : {}),
    ...(opts.maxSteps !== undefined ? { maxSteps: opts.maxSteps } : {}),
  }) as unknown as DurableAgentLike;
};
