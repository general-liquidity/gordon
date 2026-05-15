/**
 * Filesystem Write Guard (GORDON_FILESYSTEM_WRITE_GUARD).
 *
 * Partial port of Claude Code's filesystem-isolation sandbox to Gordon's
 * TS-tool runtime. Gordon doesn't have OS-level sandboxing (tools are
 * Bun functions, not subprocesses), but it can still enforce a
 * path-allowlist at the application layer:
 *
 *   - writes to `~/.gordon/*` and `/tmp/gordon-*` are auto-approved
 *   - writes to the project working directory are auto-approved
 *     (consistent with Claude Code's "current working directory" rule)
 *   - everything else requires explicit allowlist entry or fails
 *
 * Two modes:
 *   - "warn"  — log a warning when a write path is outside the allowlist
 *   - "block" — throw `BlockedWriteError`
 *
 * Defense-in-depth — Gordon's TS tools don't usually open arbitrary
 * paths, but if a misbehaving tool tries to write `~/.ssh/authorized_keys`
 * or `/etc/passwd`, this catches it.
 */

import { resolve, sep } from "node:path";
import { homedir, tmpdir } from "node:os";

export const FILESYSTEM_WRITE_GUARD_FLAG_ENV = "GORDON_FILESYSTEM_WRITE_GUARD";
export const FILESYSTEM_WRITE_GUARD_MODE_ENV = "GORDON_FILESYSTEM_WRITE_GUARD_MODE";

export type GuardMode = "warn" | "block";

export interface PathRule {
  /** Absolute path prefix; matched after `path.resolve`. */
  prefix: string;
  /** Human-readable reason. */
  reason?: string;
}

export interface CheckWriteInput {
  /** Path the caller is about to write. May be relative; will be resolved. */
  path: string;
  /** Tool / caller id for diagnostics. */
  caller?: string;
}

export interface CheckWriteResult {
  allowed: boolean;
  /** Fully resolved absolute path. */
  resolvedPath: string;
  matchedRule?: PathRule;
  reason?: string;
  mode: GuardMode;
}

export class BlockedWriteError extends Error {
  constructor(public readonly result: CheckWriteResult) {
    super(
      `Filesystem write blocked: ${result.resolvedPath} (${result.reason ?? "outside allowlist"})`,
    );
    this.name = "BlockedWriteError";
  }
}

const _registry: PathRule[] = [];
let _initialized = false;

function ensureInitialized(): void {
  if (_initialized) return;
  _registry.push(
    { prefix: resolve(homedir(), ".gordon"), reason: "Gordon home directory" },
    { prefix: resolve(tmpdir(), "gordon-"), reason: "Gordon tmp scratch (prefix)" },
    { prefix: resolve(process.cwd()), reason: "current working directory" },
  );
  _initialized = true;
}

export function isFilesystemWriteGuardEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env[FILESYSTEM_WRITE_GUARD_FLAG_ENV] === "1" ||
    env[FILESYSTEM_WRITE_GUARD_FLAG_ENV] === "true"
  );
}

export function getGuardMode(env: NodeJS.ProcessEnv = process.env): GuardMode {
  return env[FILESYSTEM_WRITE_GUARD_MODE_ENV] === "block" ? "block" : "warn";
}

export function addAllowedPath(rule: PathRule): void {
  ensureInitialized();
  _registry.push({ ...rule, prefix: resolve(rule.prefix) });
}

export function listAllowedPaths(): readonly PathRule[] {
  ensureInitialized();
  return [..._registry];
}

export function resetGuardForTesting(): void {
  _registry.length = 0;
  _initialized = false;
}

function startsWithPathPrefix(path: string, prefix: string): boolean {
  // Exact match or proper subpath. Avoid "/foo/bar" matching prefix "/foo/b".
  if (path === prefix) return true;
  const withSep = prefix.endsWith(sep) ? prefix : prefix + sep;
  if (path.startsWith(withSep)) return true;
  // Special case: prefix may itself end with "-" (e.g. "/tmp/gordon-")
  // for "any path that starts with this exact string."
  if (prefix.endsWith("-") && path.startsWith(prefix)) return true;
  return false;
}

export function checkWrite(
  input: CheckWriteInput,
  opts: { mode?: GuardMode; rules?: readonly PathRule[] } = {},
): CheckWriteResult {
  ensureInitialized();
  const mode = opts.mode ?? getGuardMode();
  const rules = opts.rules ?? _registry;
  const resolvedPath = resolve(input.path);

  for (const rule of rules) {
    // Resolve the rule prefix so callers can pass relative or unresolved paths.
    const resolvedPrefix = resolve(rule.prefix);
    if (startsWithPathPrefix(resolvedPath, resolvedPrefix)) {
      return { allowed: true, resolvedPath, matchedRule: rule, mode };
    }
  }

  return {
    allowed: false,
    resolvedPath,
    reason: `path is outside the allowlist`,
    mode,
  };
}

export function enforceWrite(
  input: CheckWriteInput,
  opts: { mode?: GuardMode; rules?: readonly PathRule[] } = {},
): CheckWriteResult {
  const result = checkWrite(input, opts);
  if (!result.allowed && result.mode === "block") {
    throw new BlockedWriteError(result);
  }
  return result;
}

export function resultToPayload(result: CheckWriteResult, caller?: string): Record<string, unknown> {
  return {
    kind: "filesystem_write_guard.check_recorded",
    allowed: result.allowed,
    resolvedPath: result.resolvedPath,
    mode: result.mode,
    matchedRule: result.matchedRule?.prefix,
    reason: result.reason,
    caller,
  };
}
