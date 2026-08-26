/**
 * External Hook Runner (GORDON_EXTERNAL_HOOK_RUNNER).
 *
 * Port of the command-handler pattern from dabit3/agent-hooks-in-depth
 * (2026):
 *
 *   "event → optional matcher/filter → handler → outcome"
 *
 * Gordon's existing hook engine runs TypeScript `HookHandler` functions
 * inside the same process. This module lets the operator wire an
 * *external* shell script as a handler at any Gordon lifecycle point.
 * Adds an extensibility surface: operators can encode custom policy
 * (regulatory checks, custom risk rules, external compliance calls)
 * without modifying Gordon source.
 *
 * Wire-protocol convention (matches dabit3's Python demo):
 *
 *   - JSON payload written to handler's stdin
 *   - Handler exits 0  → "allow"
 *   - Handler exits 2  → "block" with stderr as reason
 *   - Handler exits other non-zero → "block" with stderr as reason (treated as policy fail)
 *   - Handler writes JSON to stdout → parsed as a `HookResult` (overrides exit-code-based decision)
 *   - Handler times out → "block" with timeout reason
 *
 * The default-block-on-error posture is deliberate. An external handler
 * that crashes is treated as a failed policy check, not "ignore and
 * proceed." Operators who want fail-open semantics can return a JSON
 * `{ "action": "allow" }` on stdout from the handler's error path.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import type { HookPoint, HookResult, HookPayloadMap } from "./types.ts";
import { flagEnv } from "../config/flagResolver.ts";

export const EXTERNAL_HOOK_RUNNER_FLAG_ENV = "GORDON_EXTERNAL_HOOK_RUNNER";

export interface ExternalHookConfig<P extends HookPoint = HookPoint> {
  /** Stable id for logging / removal. */
  id: string;
  /** Hook lifecycle point. */
  point: P;
  /** Absolute or repo-relative path to the executable handler. */
  handlerPath: string;
  /** Arguments to pass to the handler before the JSON payload. */
  args?: string[];
  /** Max wall-clock time for the handler before timeout-as-block. Default 5000ms. */
  timeoutMs?: number;
  /** Environment variables to pass through (in addition to PROCESS env). */
  env?: Record<string, string>;
  /** Free-form description shown in audit logs. */
  description?: string;
}

export interface ExternalHookExecutionMeta {
  exitCode: number | null;
  durationMs: number;
  stderr: string;
  stdoutJsonParsed: boolean;
  timedOut: boolean;
  spawnFailed: boolean;
}

export interface ExternalHookRunResult {
  result: HookResult;
  meta: ExternalHookExecutionMeta;
}

export class ExternalHandlerMissingError extends Error {
  constructor(public readonly path: string) {
    super(`External hook handler not found: ${path}`);
    this.name = "ExternalHandlerMissingError";
  }
}

export function isExternalHookRunnerEnabled(env: NodeJS.ProcessEnv = flagEnv()): boolean {
  return (
    env[EXTERNAL_HOOK_RUNNER_FLAG_ENV] === "1" ||
    env[EXTERNAL_HOOK_RUNNER_FLAG_ENV] === "true"
  );
}

/**
 * Resolve handler path against `cwd` if relative; verify it exists.
 * Throws if missing — caller should catch and treat as a hook error.
 */
export function resolveHandlerPath(handlerPath: string, cwd: string = process.cwd()): string {
  const resolved = resolve(cwd, handlerPath);
  if (!existsSync(resolved)) {
    throw new ExternalHandlerMissingError(resolved);
  }
  return resolved;
}

interface SpawnOutcome {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  spawnError?: Error;
}

function runHandlerProcess(
  handlerPath: string,
  args: readonly string[],
  payloadJson: string,
  timeoutMs: number,
  extraEnv?: Record<string, string>,
): Promise<SpawnOutcome> {
  return new Promise<SpawnOutcome>((resolvePromise) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    let child;
    try {
      child = spawn(handlerPath, [...args], {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, ...(extraEnv ?? {}) },
        detached: process.platform !== "win32",
      });
    } catch (err) {
      resolvePromise({
        exitCode: null,
        stdout: "",
        stderr: err instanceof Error ? err.message : String(err),
        timedOut: false,
        spawnError: err instanceof Error ? err : new Error(String(err)),
      });
      return;
    }

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (err) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      resolvePromise({
        exitCode: null,
        stdout,
        stderr: stderr || err.message,
        timedOut,
        spawnError: err,
      });
    });

    child.on("close", (code) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      resolvePromise({ exitCode: code, stdout, stderr, timedOut });
    });

    timeoutHandle = setTimeout(() => {
      timedOut = true;
      try {
        if (process.platform !== "win32" && child.pid) {
          process.kill(-child.pid, "SIGTERM");
        } else {
          child.kill("SIGTERM");
        }
      } catch {
        try {
          child.kill("SIGTERM");
        } catch {
          // ignore
        }
      }
    }, timeoutMs);

    // A handler is free to ignore its stdin: `exit 0` without reading is a
    // legitimate allow. When it does, the payload write loses a race against the
    // child closing the pipe and the stream emits EPIPE asynchronously, which the
    // surrounding try/catch cannot see. Without this listener that error reaches
    // `child.on("error")` and a successful exit 0 is reported as a spawn failure,
    // which is a block: the fail-closed posture turning a working handler into a
    // refusal, intermittently and only under load.
    child.stdin.on("error", () => {
      // The child's exit code is the verdict. A pipe it declined to read is not.
    });

    try {
      child.stdin.write(payloadJson);
      child.stdin.end();
    } catch {
      // ignore; child.on('error') will fire
    }
  });
}

/**
 * Parse handler stdout as a HookResult. Returns null when stdout is
 * empty / unparseable — caller falls back to exit-code semantics.
 */
function tryParseHookResultJson(stdout: string): HookResult | null {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) return null;
  try {
    const parsed = JSON.parse(trimmed) as Partial<HookResult>;
    if (
      parsed &&
      typeof parsed === "object" &&
      (parsed.action === "allow" ||
        parsed.action === "block" ||
        parsed.action === "modify")
    ) {
      return {
        action: parsed.action,
        reason: typeof parsed.reason === "string" ? parsed.reason : undefined,
        replacement: parsed.replacement,
        metadata: parsed.metadata,
      };
    }
  } catch {
    // not JSON — fall through
  }
  return null;
}

function exitCodeToResult(
  exitCode: number | null,
  stderr: string,
  timedOut: boolean,
  spawnFailed: boolean,
): HookResult {
  if (spawnFailed) {
    return {
      action: "block",
      reason: `external hook spawn failed: ${stderr || "unknown error"}`,
    };
  }
  if (timedOut) {
    return { action: "block", reason: "external hook timed out" };
  }
  if (exitCode === 0) {
    return { action: "allow" };
  }
  if (exitCode === 2) {
    return {
      action: "block",
      reason: stderr.trim() || "external hook returned exit code 2",
    };
  }
  // Any other non-zero is treated as a policy failure — fail closed.
  return {
    action: "block",
    reason: stderr.trim() || `external hook exited ${exitCode}`,
  };
}

/**
 * Invoke an external handler at a Gordon lifecycle point. Returns a
 * `HookResult` the engine can apply, plus metadata for logs.
 */
export async function runExternalHook<P extends HookPoint>(
  config: ExternalHookConfig<P>,
  payload: HookPayloadMap[P],
  opts: { cwd?: string } = {},
): Promise<ExternalHookRunResult> {
  const timeoutMs = config.timeoutMs ?? 5_000;
  const args = config.args ?? [];
  const start = Date.now();

  let handlerPath: string;
  try {
    handlerPath = resolveHandlerPath(config.handlerPath, opts.cwd);
  } catch (err) {
    return {
      result: {
        action: "block",
        reason: err instanceof Error ? err.message : String(err),
      },
      meta: {
        exitCode: null,
        durationMs: Date.now() - start,
        stderr: err instanceof Error ? err.message : String(err),
        stdoutJsonParsed: false,
        timedOut: false,
        spawnFailed: true,
      },
    };
  }

  const payloadJson = JSON.stringify({
    point: config.point,
    payload,
    cwd: opts.cwd ?? process.cwd(),
    workspace_roots: [opts.cwd ?? process.cwd()],
  });

  const outcome = await runHandlerProcess(handlerPath, args, payloadJson, timeoutMs, config.env);

  // First try to parse stdout as a structured HookResult.
  const jsonResult = tryParseHookResultJson(outcome.stdout);
  const stdoutJsonParsed = jsonResult !== null;
  const result =
    jsonResult ??
    exitCodeToResult(
      outcome.exitCode,
      outcome.stderr,
      outcome.timedOut,
      !!outcome.spawnError,
    );

  return {
    result,
    meta: {
      exitCode: outcome.exitCode,
      durationMs: Date.now() - start,
      stderr: outcome.stderr,
      stdoutJsonParsed,
      timedOut: outcome.timedOut,
      spawnFailed: !!outcome.spawnError,
    },
  };
}

export function runMetaToPayload(
  config: ExternalHookConfig,
  meta: ExternalHookExecutionMeta,
  result: HookResult,
): Record<string, unknown> {
  return {
    kind: "external_hook.run_recorded",
    hookId: config.id,
    point: config.point,
    handlerPath: config.handlerPath,
    exitCode: meta.exitCode,
    durationMs: meta.durationMs,
    timedOut: meta.timedOut,
    spawnFailed: meta.spawnFailed,
    stdoutJsonParsed: meta.stdoutJsonParsed,
    action: result.action,
    reason: result.reason,
  };
}
