/**
 * Headless mode — one-shot prompt execution without TUI.
 *
 * Invoked via `gordon --headless "<prompt>"`. Bypasses Ink/TUI bootstrap,
 * loads the same agent runtime the interactive mode uses, runs a single
 * prompt through the orchestrator, prints the assistant response to
 * stdout, and exits.
 *
 * Use cases:
 *   - cron-driven research / scan tasks
 *   - shell pipelines (e.g. `gordon --headless "regime on BTC" | jq …`)
 *   - CI / automation testing
 *
 * Output format:
 *   - default     : stdout = plain-text response, newline-terminated.
 *   - `--json`    : stdout = a single JSON object on one line with
 *                   { schemaVersion, exitCode, threadId, response,
 *                     startedAt, finishedAt, durationMs, error? }.
 *                   Suitable for cron pipelines: pipe directly into
 *                   `jq`, store as a GitHub Actions artifact, or feed
 *                   to a follow-up agent.
 *   - stderr      : event-bus log lines as JSONL with timestamps —
 *                   suppress with `--quiet`.
 *
 * Exit codes:
 *   0 — success, response printed
 *   1 — initialization or runtime failure
 *   2 — input/safety guardrail blocked the prompt
 */

import { createLLMClientFromEnv } from "../../infra/ai/llm/client.ts";
import { loadConfig } from "../../infra/storage/config/config.ts";
import { buildAppGordonContext } from "../../gateway/ui/context.ts";
import { processSimpleMessage } from "../../infra/agents/orchestrator.ts";
import { getEventBus } from "../../events/bus.ts";

export interface HeadlessOptions {
  /** The user prompt to run. */
  prompt: string;
  /** Suppress event-log output on stderr. */
  quiet?: boolean;
  /** Optional thread ID — generated if absent. */
  threadId?: string;
  /** Optional override for the user identifier (defaults to "headless"). */
  userId?: string;
}

export interface HeadlessResult {
  exitCode: 0 | 1 | 2;
  response?: string;
  error?: string;
  /** Resolved thread id used for the run (echoes input or generated). */
  threadId: string;
  /** Wall-clock start time (ISO 8601). */
  startedAt: string;
  /** Wall-clock finish time (ISO 8601). */
  finishedAt: string;
  /** Wall-clock duration in milliseconds. */
  durationMs: number;
}

/** Bump if the JSON report shape changes in a breaking way. */
export const HEADLESS_REPORT_SCHEMA_VERSION = 1;

function emitEventLog(quiet: boolean): () => void {
  if (quiet) return () => {};
  const bus = getEventBus();
  const unsub = bus.onAny((event) => {
    try {
      const line = JSON.stringify({ ts: new Date().toISOString(), event });
      process.stderr.write(line + "\n");
    } catch {
      // Swallow serialization failures — never crash the headless run.
    }
  });
  return unsub;
}

/**
 * Run a one-shot prompt and return the structured result. Caller is
 * responsible for translating the result into a process exit; this
 * function never calls process.exit so it stays testable.
 */
export async function runHeadless(options: HeadlessOptions): Promise<HeadlessResult> {
  const { prompt, quiet = false } = options;
  const startMs = Date.now();
  const startedAt = new Date(startMs).toISOString();
  const threadId = options.threadId ?? `headless-${startMs}`;

  function finish(partial: Pick<HeadlessResult, "exitCode" | "response" | "error">): HeadlessResult {
    const finishMs = Date.now();
    return {
      ...partial,
      threadId,
      startedAt,
      finishedAt: new Date(finishMs).toISOString(),
      durationMs: finishMs - startMs,
    };
  }

  if (!prompt || !prompt.trim()) {
    return finish({
      exitCode: 2,
      error: "Empty prompt — pass the message as the trailing argument: gordon --headless \"<prompt>\"",
    });
  }

  const unsubEventLog = emitEventLog(quiet);

  try {
    const config = await loadConfig();
    const llm = createLLMClientFromEnv();
    const userId = options.userId ?? "headless";

    const context = buildAppGordonContext({
      binance: null,
      exchange: null,
      broker: null,
      llm,
      config,
      portfolioValue: 0,
      availableCash: 0,
      userId,
      threadId,
    });

    const response = await processSimpleMessage(prompt, context);
    return finish({ exitCode: 0, response });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return finish({ exitCode: 1, error: message });
  } finally {
    try {
      unsubEventLog();
    } catch {
      // Listener teardown failures are not fatal.
    }
  }
}

/**
 * Serialize a HeadlessResult to the single-line JSON shape designed for
 * cron pipelines. Stable schema — bump HEADLESS_REPORT_SCHEMA_VERSION
 * before changing field names or removing fields.
 */
export function headlessResultToJson(result: HeadlessResult): string {
  const payload: Record<string, unknown> = {
    schemaVersion: HEADLESS_REPORT_SCHEMA_VERSION,
    exitCode: result.exitCode,
    threadId: result.threadId,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    durationMs: result.durationMs,
  };
  if (result.response !== undefined) payload.response = result.response;
  if (result.error !== undefined) payload.error = result.error;
  return JSON.stringify(payload);
}

/**
 * Convenience driver — runs the prompt and prints the result, suitable
 * for direct CLI use. Caller passes process.argv slice and quiet flag.
 *
 * When `json` is true, stdout receives the single-line JSON report and
 * the `error` field is part of that payload (no separate stderr message).
 * Stderr still carries the event-log unless `quiet` is also set.
 */
export async function runHeadlessAndPrint(
  args: string[],
  quiet: boolean,
  json = false,
): Promise<number> {
  const prompt = args.join(" ").trim();
  const result = await runHeadless({ prompt, quiet });

  if (json) {
    process.stdout.write(headlessResultToJson(result) + "\n");
    return result.exitCode;
  }

  if (result.exitCode === 0 && result.response !== undefined) {
    process.stdout.write(result.response.endsWith("\n") ? result.response : result.response + "\n");
  } else if (result.error) {
    process.stderr.write(`error: ${result.error}\n`);
  }
  return result.exitCode;
}
