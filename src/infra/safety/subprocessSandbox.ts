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
 * Enabling: either the env var `GORDON_SANDBOX_SUBPROCESS` (truthy) OR the
 * settings-layer toggle `sandbox.subprocess: true` (any layer of the 7-level
 * priority chain — project/local/profile/policy). Both default to absent →
 * OFF. The env var wins when set; otherwise the merged config is consulted.
 *
 * INVARIANTS (this ships days before release — do not break these):
 *   - Default OFF. Without the env var truthy AND without the config toggle,
 *     every entry point returns the command/args UNCHANGED — byte-identical
 *     to the current direct spawn.
 *   - Enabled but no sandbox tool on PATH → passthrough + a one-line
 *     warning. Never a hard failure: an unavailable sandbox must degrade
 *     to the current behavior, not block the launch.
 *   - argv form throughout. No shell. The wrapper prepends a launcher and
 *     its flags as discrete argv elements; it never builds a shell string.
 *   - Network stays ALLOWED for MCP servers (they call vendor APIs). The
 *     primary protection is filesystem-write confinement, not network deny.
 */

import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

import { loadLayeredSettings } from "../config/settingsLayers.ts";
import { createModuleLogger } from "../logger/index.ts";

const logger = createModuleLogger("subprocess-sandbox");

export type SandboxKind = "bwrap" | "sandbox-exec" | "none";

export interface SandboxDetection {
  kind: SandboxKind;
  available: boolean;
}

export interface WrapSandboxOptions {
  /**
   * Absolute paths the child may write to. Defaults to the OS temp dir AND
   * the current working/project dir (MCP servers write caches/logs/lockfiles
   * to both). NEVER includes the home-directory root or `/` — the whole point
   * is to keep credentials (`.env`, `~/.gordon`, ssh keys) read-only. Any
   * caller-supplied list is filtered the same way: home root and `/` are
   * dropped even if passed explicitly.
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

function isTruthyFlag(v: unknown): boolean {
  if (v === true) return true;
  if (typeof v !== "string") return false;
  const lowered = v.trim().toLowerCase();
  return lowered === "1" || lowered === "true" || lowered === "yes" || lowered === "on";
}

/**
 * Read the settings-layer toggle `sandbox.subprocess`. Returns true only when
 * a layer explicitly sets it truthy. Failures (no config, parse error) degrade
 * to false — this is a safety gate, an unreadable config must NOT enable it.
 */
function isSandboxEnabledViaConfig(): boolean {
  try {
    const { config } = loadLayeredSettings();
    const sandbox = config.sandbox;
    if (sandbox && typeof sandbox === "object" && !Array.isArray(sandbox)) {
      return isTruthyFlag((sandbox as Record<string, unknown>).subprocess);
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * True only when the operator has explicitly opted in — via the env var
 * `GORDON_SANDBOX_SUBPROCESS` OR the settings-layer toggle
 * `sandbox.subprocess: true`. Default OFF. The env var takes precedence when
 * set to any value (truthy enables; an explicit falsy value disables and does
 * NOT fall through to config — env is the per-run override).
 */
export function isSandboxEnabled(): boolean {
  const v = process.env.GORDON_SANDBOX_SUBPROCESS;
  if (v !== undefined && v !== "") {
    return isTruthyFlag(v);
  }
  return isSandboxEnabledViaConfig();
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

/**
 * Default writable roots when the caller doesn't supply any. Real MCP servers
 * write caches/logs/lockfiles into both the OS temp dir AND the current
 * project/working directory — confining writes to only a single scratch dir
 * breaks them. So the default grants write to BOTH, but NEVER the home-dir
 * root (credentials, dotfiles) — `/` stays read-only, so servers can still
 * READ node_modules / their package / config; they just can't write outside
 * tmp + cwd.
 */
function defaultWritableRoots(): string[] {
  const roots = [os.tmpdir(), process.cwd()];
  return dedupeAndFilterRoots(roots);
}

/**
 * Reject writable roots that would expose credentials: the home-dir root and
 * the filesystem root. A child confined for filesystem-write must not be able
 * to write `.env`, `~/.gordon`, ssh keys, or shell rc files. We allow SUBpaths
 * of home (e.g. cwd under home, a project's own cache) but never home itself
 * or `/`. Duplicates collapse so the bwrap/seatbelt argv stays minimal.
 *
 * The emitted string is the caller's ORIGINAL path, not a re-resolved one:
 * the sandbox launcher (bwrap/sandbox-exec) only ever runs on Linux/macOS, so
 * an absolute POSIX root must reach the argv verbatim. Resolution is used only
 * to build a comparison key (dedup + home/`/` rejection).
 */
function dedupeAndFilterRoots(roots: string[]): string[] {
  const homeKey = path.resolve(os.homedir());
  const fsRoot = path.parse(os.homedir()).root;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of roots) {
    if (!raw) continue;
    const key = path.resolve(raw);
    if (key === homeKey) continue; // home root — credentials live here
    if (key === fsRoot) continue; // never grant write to `/`
    // A `"` would break the Seatbelt SBPL string literal (no escape form);
    // such a path can't be expressed safely, so drop it rather than emit a
    // malformed profile.
    if (raw.includes('"')) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(raw);
  }
  return out;
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

  // Caller-supplied roots are still filtered: even an explicit list must not
  // grant write to the home root or `/`. If filtering empties the list, fall
  // back to the safe default (tmp + cwd) rather than running with no writable
  // path (which would break any server that writes a cache/log).
  const requested =
    opts.writableRoots && opts.writableRoots.length > 0
      ? dedupeAndFilterRoots(opts.writableRoots)
      : defaultWritableRoots();
  const writableRoots = requested.length > 0 ? requested : defaultWritableRoots();
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
