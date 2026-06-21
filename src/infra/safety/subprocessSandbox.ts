/**
 * Subprocess sandbox wrapper — opt-in, no-op by default.
 *
 * Gordon launches subprocesses it does not author: MCP plugin servers
 * (`src/infra/ai/mcp/server-instance.ts`) and, externally, the MT5 bridge.
 * When the operator opts in AND a host sandbox tool is available, this
 * module rewrites the launch `command`/`args` to run the child confined:
 * read-only filesystem except an explicit writable work dir, network
 * denied unless requested. Mirrors Codex's approach — bubblewrap on
 * Linux, sandbox-exec/Seatbelt on macOS.
 *
 * INVARIANTS (this ships days before release — do not break these):
 *   - Default OFF. Without `GORDON_SANDBOX_SUBPROCESS` truthy, every
 *     entry point returns the command/args UNCHANGED — byte-identical to
 *     the current direct spawn.
 *   - Enabled but no sandbox tool on PATH → passthrough + a one-line
 *     warning. Never a hard failure: an unavailable sandbox must degrade
 *     to the current behavior, not block the launch.
 *   - argv form throughout. No shell. The wrapper prepends a launcher and
 *     its flags as discrete argv elements; it never builds a shell string.
 */

import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

import { createModuleLogger } from "../logger/index.ts";

const logger = createModuleLogger("subprocess-sandbox");

export type SandboxKind = "bwrap" | "sandbox-exec" | "none";

export interface SandboxDetection {
  kind: SandboxKind;
  available: boolean;
}

export interface WrapSandboxOptions {
  /**
   * Absolute paths the child may write to. Defaults to a single temp work
   * dir. NEVER defaults to the home directory or the directory holding
   * `.env` — the whole point is to keep credentials/config read-only.
   */
  writableRoots?: string[];
  /**
   * Allow outbound network. MCP servers usually need this (they call
   * vendor APIs), so callers wiring MCP pass `true`. Filesystem
   * confinement is the primary protection; network-deny is opt-in per
   * call because denying it breaks network MCP servers.
   */
  allowNetwork?: boolean;
}

export interface WrappedCommand {
  command: string;
  args: string[];
}

/**
 * True only when the operator has explicitly opted in. Default OFF.
 */
export function isSandboxEnabled(): boolean {
  const v = process.env.GORDON_SANDBOX_SUBPROCESS;
  if (!v) return false;
  const lowered = v.trim().toLowerCase();
  return lowered === "1" || lowered === "true" || lowered === "yes" || lowered === "on";
}

/**
 * Look up an executable on PATH using the platform's own resolver in
 * argv form (no shell). Returns true when found and exit code is 0.
 */
function isOnPath(executable: string): boolean {
  const probe = process.platform === "win32" ? "where" : "which";
  try {
    const res = spawnSync(probe, [executable], {
      stdio: "ignore",
      timeout: 3000,
      windowsHide: true,
    });
    return res.status === 0;
  } catch {
    return false;
  }
}

/**
 * Detect an available host sandbox tool: `bwrap` (bubblewrap) on Linux,
 * `sandbox-exec` (Seatbelt) on macOS. Returns `{ kind: "none" }` on any
 * other platform or when the tool is absent.
 */
export function detectSandbox(): SandboxDetection {
  if (process.platform === "linux") {
    return { kind: "bwrap", available: isOnPath("bwrap") };
  }
  if (process.platform === "darwin") {
    return { kind: "sandbox-exec", available: isOnPath("sandbox-exec") };
  }
  return { kind: "none", available: false };
}

/**
 * Test seam: override the detection result. Production code never sets
 * this; tests use it to force a bwrap/sandbox-exec/none result without
 * depending on what's actually installed on the CI host.
 */
let _detectOverride: (() => SandboxDetection) | null = null;

export function __setDetectOverrideForTesting(fn: (() => SandboxDetection) | null): void {
  _detectOverride = fn;
}

function resolveDetection(): SandboxDetection {
  return _detectOverride ? _detectOverride() : detectSandbox();
}

/** Default writable work dir when the caller doesn't supply one. */
function defaultWritableRoot(): string {
  return path.join(os.tmpdir(), "gordon-sandbox");
}

/**
 * Build a bubblewrap argv that runs `command args...` with `/` read-only,
 * the writable roots bind-mounted read/write, and the network unshared
 * unless allowed. `--die-with-parent` ties the child's lifetime to ours.
 */
function buildBwrapArgv(
  command: string,
  args: string[],
  writableRoots: string[],
  allowNetwork: boolean,
): WrappedCommand {
  const bwrapArgs: string[] = [
    "--ro-bind", "/", "/",
    "--dev", "/dev",
    "--proc", "/proc",
    "--die-with-parent",
  ];
  for (const root of writableRoots) {
    bwrapArgs.push("--bind", root, root);
  }
  if (!allowNetwork) {
    bwrapArgs.push("--unshare-net");
  }
  bwrapArgs.push("--", command, ...args);
  return { command: "bwrap", args: bwrapArgs };
}

/**
 * Build a `sandbox-exec` argv with an inline Seatbelt profile. The profile
 * denies by default, then allows process exec, read of the whole disk, and
 * write only under the writable roots. Network is allowed only when
 * requested.
 */
function buildSandboxExecArgv(
  command: string,
  args: string[],
  writableRoots: string[],
  allowNetwork: boolean,
): WrappedCommand {
  const clauses: string[] = [
    "(version 1)",
    "(deny default)",
    "(allow process-exec)",
    "(allow process-fork)",
    "(allow sysctl-read)",
    "(allow file-read*)",
  ];
  for (const root of writableRoots) {
    clauses.push(`(allow file-write* (subpath "${root}"))`);
  }
  if (allowNetwork) {
    clauses.push("(allow network*)");
  }
  const profile = clauses.join("");
  return { command: "sandbox-exec", args: ["-p", profile, command, ...args] };
}

/**
 * Wrap a launch command so the spawned child runs sandboxed, when both
 * (a) the operator opted in and (b) a host sandbox tool is available.
 *
 * Otherwise returns `{ command, args }` UNCHANGED. When enabled but the
 * tool is unavailable, logs a one-line warning and still passes through —
 * an unavailable sandbox falls back to the current direct spawn, never a
 * hard failure.
 */
export function wrapSandboxed(
  command: string,
  args: string[],
  opts: WrapSandboxOptions = {},
): WrappedCommand {
  if (!isSandboxEnabled()) {
    return { command, args };
  }

  const detection = resolveDetection();
  if (!detection.available) {
    logger.warn(
      `GORDON_SANDBOX_SUBPROCESS is enabled but no host sandbox tool is available (platform=${process.platform}, kind=${detection.kind}) — spawning "${command}" unsandboxed`,
    );
    return { command, args };
  }

  const writableRoots =
    opts.writableRoots && opts.writableRoots.length > 0
      ? opts.writableRoots
      : [defaultWritableRoot()];
  const allowNetwork = opts.allowNetwork === true;

  if (detection.kind === "bwrap") {
    return buildBwrapArgv(command, args, writableRoots, allowNetwork);
  }
  if (detection.kind === "sandbox-exec") {
    return buildSandboxExecArgv(command, args, writableRoots, allowNetwork);
  }

  // Unreachable: available implies a concrete kind. Passthrough for safety.
  return { command, args };
}
