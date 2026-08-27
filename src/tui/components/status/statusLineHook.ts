/**
 * User-defined status-line hook — pure execution + sanitization.
 *
 * Port of Claude Code's `statusLine.command` pattern into Gordon's TUI: the
 * operator declares a shell command in settings, its stdout renders as an
 * additional segment in the persistent status row (custom P&L feed, venue
 * latency, margin headroom, …).
 *
 * Safety posture (the status row must NEVER break on a bad hook):
 *   - short wall-clock timeout (default 2000ms), killed on overrun
 *   - stdout captured, capped, collapsed to a single line
 *   - control chars / ANSI escapes stripped (a hook can't corrupt the frame)
 *   - any error / timeout / non-zero exit → `null` (segment renders nothing)
 *
 * Throttling (don't spawn per render frame) lives in the React hook that wraps
 * this module — see `useStatusLineHook.ts`. This file is deliberately
 * runner-injectable so tests drive it with a fake exec instead of a real
 * subprocess.
 */

import { spawn } from "node:child_process";

export const DEFAULT_STATUS_LINE_TIMEOUT_MS = 2_000;
/** Hard cap on stdout we read before truncating — a runaway hook can't flood. */
export const STATUS_LINE_OUTPUT_CAP = 512;
/** Cap on the rendered single-line segment (status row is space-constrained). */
export const STATUS_LINE_RENDER_CAP = 120;

export interface StatusLineRunResult {
  /** Raw stdout (already capped to STATUS_LINE_OUTPUT_CAP). */
  stdout: string;
  exitCode: number | null;
  timedOut: boolean;
  /** Set when the process failed to spawn at all. */
  spawnFailed: boolean;
}

/** Pluggable runner — real impl spawns a shell; tests inject a fake. */
export type StatusLineRunner = (command: string, timeoutMs: number) => Promise<StatusLineRunResult>;

// ESC (0x1B) followed by a CSI/OSC/other escape sequence.
const ANSI_ESCAPE_RE = /\u001B(?:\[[0-9;?]*[ -/]*[@-~]|\][^\u0007]*\u0007|[@-Z\\-_])/g;
// C0 (0x00-0x1F), DEL (0x7F), and C1 (0x80-0x9F) control characters.
const CONTROL_CHAR_RE = /[\u0000-\u001F\u007F-\u009F]/g;

/**
 * Strip control characters and ANSI escapes, collapse all whitespace runs to a
 * single space, take the first line only, and clamp to the render cap. Returns
 * `null` when nothing renderable survives — caller renders no segment.
 */
export function sanitizeStatusLineOutput(raw: string): string | null {
  if (!raw) return null;
  // First physical line only — a multi-line hook collapses to its first line.
  const firstLine = raw.split(/\r?\n/, 1)[0] ?? "";
  const collapsed = firstLine
    .replace(ANSI_ESCAPE_RE, "")
    .replace(CONTROL_CHAR_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (collapsed.length === 0) return null;
  return collapsed.length > STATUS_LINE_RENDER_CAP
    ? `${collapsed.slice(0, STATUS_LINE_RENDER_CAP - 1)}…`
    : collapsed;
}

/**
 * Default runner: spawn the command through the platform shell, capture stdout,
 * enforce the timeout, and cap output. Never throws — failures surface as
 * `spawnFailed`/`timedOut` flags so the caller can render nothing.
 */
export const defaultStatusLineRunner: StatusLineRunner = (command, timeoutMs) =>
  new Promise<StatusLineRunResult>((resolvePromise) => {
    let stdout = "";
    let settled = false;
    let timedOut = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    const settle = (r: StatusLineRunResult) => {
      if (settled) return;
      settled = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      resolvePromise(r);
    };

    let child: ReturnType<typeof spawn>;
    try {
      const isWin = process.platform === "win32";
      child = isWin
        ? spawn("cmd.exe", ["/d", "/s", "/c", command], { stdio: ["ignore", "pipe", "ignore"] })
        : spawn("/bin/sh", ["-c", command], {
            stdio: ["ignore", "pipe", "ignore"],
            detached: true,
          });
    } catch {
      settle({ stdout: "", exitCode: null, timedOut: false, spawnFailed: true });
      return;
    }

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length < STATUS_LINE_OUTPUT_CAP) {
        stdout += chunk.toString("utf8");
        if (stdout.length > STATUS_LINE_OUTPUT_CAP) {
          stdout = stdout.slice(0, STATUS_LINE_OUTPUT_CAP);
        }
      }
    });

    child.on("error", () => {
      settle({ stdout, exitCode: null, timedOut, spawnFailed: true });
    });

    child.on("close", (code) => {
      settle({ stdout, exitCode: code, timedOut, spawnFailed: false });
    });

    timeoutHandle = setTimeout(() => {
      timedOut = true;
      try {
        if (process.platform !== "win32" && child.pid) {
          process.kill(-child.pid, "SIGKILL");
        } else {
          child.kill("SIGKILL");
        }
      } catch {
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore — process already gone
        }
      }
      settle({ stdout, exitCode: null, timedOut: true, spawnFailed: false });
    }, timeoutMs);
  });

export interface RunStatusLineHookOptions {
  timeoutMs?: number;
  runner?: StatusLineRunner;
}

/**
 * Run the operator's status-line command and return a render-ready single line,
 * or `null` when nothing should render (no command, error, timeout, empty).
 * This function is the single safety boundary — it never throws.
 */
export async function runStatusLineHook(
  command: string | undefined,
  opts: RunStatusLineHookOptions = {},
): Promise<string | null> {
  const trimmed = command?.trim();
  if (!trimmed) return null;

  const runner = opts.runner ?? defaultStatusLineRunner;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_STATUS_LINE_TIMEOUT_MS;

  let result: StatusLineRunResult;
  try {
    result = await runner(trimmed, timeoutMs);
  } catch {
    // A runner should never reject, but defend the status row regardless.
    return null;
  }

  if (result.spawnFailed || result.timedOut) return null;
  if (result.exitCode !== 0 && result.exitCode !== null) return null;

  return sanitizeStatusLineOutput(result.stdout);
}
