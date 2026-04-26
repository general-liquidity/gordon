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
 *   - stdout: final assistant response, plain text (last line newline-terminated)
 *   - stderr: event-bus log lines as JSON, one per line, with timestamps —
 *             use `--quiet` to suppress
 *
 * Exit codes:
 *   0 — success, response printed
 *   1 — initialization or runtime failure
 *   2 — input/safety guardrail blocked the prompt
 */

import { createLLMClientFromEnv } from "../infra/ai/llm/client.ts";
import { loadConfig } from "../infra/storage/config.ts";
import { buildAppGordonContext } from "../gateway/ui/context.ts";
import { processSimpleMessage } from "../infra/agents/orchestrator.ts";
import { getEventBus } from "../events/bus.ts";

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
}

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

  if (!prompt || !prompt.trim()) {
    return {
      exitCode: 2,
      error: "Empty prompt — pass the message as the trailing argument: gordon --headless \"<prompt>\"",
    };
  }

  const unsubEventLog = emitEventLog(quiet);

  try {
    const config = await loadConfig();
    const llm = createLLMClientFromEnv();

    const threadId = options.threadId ?? `headless-${Date.now()}`;
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
    return { exitCode: 0, response };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, error: message };
  } finally {
    try {
      unsubEventLog();
    } catch {
      // Listener teardown failures are not fatal.
    }
  }
}

/**
 * Convenience driver — runs the prompt and prints the result, suitable
 * for direct CLI use. Caller passes process.argv slice and quiet flag.
 */
export async function runHeadlessAndPrint(args: string[], quiet: boolean): Promise<number> {
  const prompt = args.join(" ").trim();
  const result = await runHeadless({ prompt, quiet });

  if (result.exitCode === 0 && result.response !== undefined) {
    process.stdout.write(result.response.endsWith("\n") ? result.response : result.response + "\n");
  } else if (result.error) {
    process.stderr.write(`error: ${result.error}\n`);
  }
  return result.exitCode;
}
