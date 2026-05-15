/**
 * Silent Tool Result Formatter (GORDON_SILENT_TOOL_FORMATTER).
 *
 * Port of HumanLayer's `run_silent` pattern from "Context-Efficient
 * Backpressure" (2026). Extends Gordon's R2 error-only filter posture
 * with the *minimum-viable-output* shape that wraps any tool/command:
 *
 *   ✓ description              (on success — single line, zero noise)
 *   ✗ description              (on failure)
 *   <full output ...>          (only when failed OR alwaysShowOutput)
 *
 * The point: many tools (test runners, linters, type-checkers, paper-mode
 * verifications) produce hundreds of lines of "all good" output. The
 * agent doesn't need to see any of it. Anthropic's empirical anchor:
 *
 *   "Models trained via RL show over-corrected conservatism, sometimes
 *    using more tokens through defensive wrapping than would occur with
 *    straightforward output."
 *
 * Deterministic is better than non-deterministic.
 */

export const SILENT_TOOL_FORMATTER_FLAG_ENV = "GORDON_SILENT_TOOL_FORMATTER";

export interface SilentFormatInput {
  /** Human-friendly summary of what the tool did. */
  description: string;
  /** Raw output (stdout + stderr or equivalent). */
  output: string;
  /** Exit code or status — 0 / null = success, anything else = failure. */
  exitCode: number | null;
  /**
   * When true, show full output even on success. Default false — silence
   * is the whole point.
   */
  alwaysShowOutput?: boolean;
  /**
   * Truncation cap on the output that gets included on failure. Default
   * 4000 chars. Output beyond is replaced with a "...N more lines..." marker.
   */
  maxFailureOutputChars?: number;
}

export interface SilentFormatResult {
  /** The formatted single-or-multi-line string to surface. */
  formatted: string;
  /** True on success (exitCode 0 or null). */
  succeeded: boolean;
  /** True if any truncation was applied. */
  truncated: boolean;
  /** Bytes removed by the formatter. */
  bytesSaved: number;
}

export function isSilentToolFormatterEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env[SILENT_TOOL_FORMATTER_FLAG_ENV] === "1" ||
    env[SILENT_TOOL_FORMATTER_FLAG_ENV] === "true"
  );
}

/**
 * Format a tool result in `run_silent` style.
 *
 * On success (exitCode 0 or null), the output is replaced with a single
 * "✓ description" line — unless `alwaysShowOutput` is set.
 *
 * On failure, the output is preserved (up to `maxFailureOutputChars`)
 * after a "✗ description" header.
 */
export function formatSilent(input: SilentFormatInput): SilentFormatResult {
  const succeeded = input.exitCode === 0 || input.exitCode === null;
  const maxChars = input.maxFailureOutputChars ?? 4000;
  const inputBytes = Buffer.byteLength(input.output, "utf8");

  if (succeeded && !input.alwaysShowOutput) {
    const formatted = `✓ ${input.description}`;
    return {
      formatted,
      succeeded: true,
      truncated: inputBytes > 0,
      bytesSaved: inputBytes,
    };
  }

  const header = succeeded ? `✓ ${input.description}` : `✗ ${input.description}`;
  let body = input.output;
  let truncated = false;
  if (body.length > maxChars) {
    const visible = body.slice(0, maxChars);
    const skipped = body.length - maxChars;
    // Approximate dropped-line count for the marker.
    const skippedLines = body.slice(maxChars).split(/\r?\n/).length;
    body = `${visible}\n...${skipped} chars / ~${skippedLines} lines truncated...`;
    truncated = true;
  }
  const formatted = `${header}\n${body}`;
  return {
    formatted,
    succeeded,
    truncated,
    bytesSaved: succeeded ? 0 : Math.max(0, inputBytes - Buffer.byteLength(body, "utf8")),
  };
}

/**
 * Bulk-format multiple step results into a single block. Useful for
 * pipelines (typecheck → lint → test): each step shows ✓/✗, only the
 * failing step's output is included.
 */
export function formatSilentPipeline(steps: readonly SilentFormatInput[]): SilentFormatResult {
  const results = steps.map(formatSilent);
  const succeeded = results.every((r) => r.succeeded);
  const formatted = results.map((r) => r.formatted).join("\n");
  const truncated = results.some((r) => r.truncated);
  const bytesSaved = results.reduce((s, r) => s + r.bytesSaved, 0);
  return { formatted, succeeded, truncated, bytesSaved };
}

export function resultToPayload(result: SilentFormatResult): Record<string, unknown> {
  return {
    kind: "silent_tool_format.result_recorded",
    succeeded: result.succeeded,
    truncated: result.truncated,
    bytesSaved: result.bytesSaved,
    formattedLength: result.formatted.length,
  };
}
