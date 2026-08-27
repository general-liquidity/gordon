/**
 * Peer-Agent Delegation (GORDON_PEER_DELEGATION).
 *
 * Lets Gordon delegate a task to an external CLI agent — Cursor's
 * `cursor-agent -p`, Warp's `oz agent run`, Claude Code's headless mode,
 * Codex CLI, Hermes, OpenClaw — anything that exposes a non-interactive
 * "take a prompt, do work, return output" surface.
 *
 * Design rationale (from the May 2026 docs scan):
 *
 *   Both Warp and Cursor are MCP clients, NOT MCP servers. Neither
 *   speaks A2A or ACP for inbound calls. What they DO expose is:
 *     (a) HTTP REST API (Warp Oz `/api/v1/agent/run`, Cursor Cloud
 *         Agents API) — richer, but requires API keys + network +
 *         polling/webhooks.
 *     (b) Headless CLI subprocess (`cursor-agent -p`, `oz agent run`)
 *         — simpler, no API key for some flows, local subprocess.
 *
 *   The CLI-subprocess surface converges across editors AND CLI agents.
 *   It's the right abstraction: spawn → write prompt → capture stdout
 *   → return. No ACP/A2A complexity.
 *
 * Operator-driven, not autonomous:
 *
 *   Gordon's executor instructions intentionally do NOT autonomously
 *   delegate. The operator drives this via `/delegate <peer> <prompt>`.
 *   This avoids the cold-prompt-engineering problem ("when should
 *   Gordon decide to use Cursor vs do it itself?") until concrete use
 *   cases land.
 *
 * Composes with the existing safety stack:
 *
 *   - withResultSanitizer (commit 51b9d0f6) strips injection patterns
 *     from the peer's stdout before it enters Gordon's context.
 *   - Tool offload limits (1800 chars default) apply.
 *   - costTracker doesn't see the peer's internal LLM cost — that's
 *     billed to the peer's own subscription/account, not Gordon's.
 *
 * Pure compute on the interface + value types. Subprocess I/O isolated
 * in `CliSubprocessPeer.delegate()`.
 */

import { spawn as nodeSpawn, type SpawnOptionsWithoutStdio } from "node:child_process";
import { createModuleLogger } from "../../logger/index.ts";
import { flagEnv } from "../../config/flagResolver.ts";

const logger = createModuleLogger("peer-delegation");

export const PEER_DELEGATION_FLAG_ENV = "GORDON_PEER_DELEGATION";

export function isPeerDelegationEnabled(env: NodeJS.ProcessEnv = flagEnv()): boolean {
  const raw = env[PEER_DELEGATION_FLAG_ENV];
  return raw === "1" || raw === "true";
}

// -------------------- types --------------------

export interface DelegateOptions {
  /** Override timeout for this call. Default from peer config. */
  timeoutMs?: number;
  /** Working directory for the subprocess. Default from peer config or `process.cwd()`. */
  workdir?: string;
  /** Caller-supplied abort signal (e.g. user pressed Ctrl-C). */
  signal?: AbortSignal;
  /** Additional env vars layered on top of the peer's default env. */
  env?: Record<string, string>;
}

export interface PeerResult {
  /** True if exit code 0 AND not aborted AND not timed-out. */
  success: boolean;
  /** Captured stdout from the peer. Sanitization happens at the tool
   *  wrapper layer (withResultSanitizer), not here. */
  output: string;
  /** Captured stderr — useful for diagnostics; surfaced separately so
   *  the model sees real output content vs incidental warning noise. */
  stderr: string;
  /** Process exit code. `null` when the process was killed (timeout / abort). */
  exitCode: number | null;
  /** Wall-clock duration of the delegation. */
  durationMs: number;
  /** Reason for failure if `success === false`. */
  error?: "timeout" | "aborted" | "output_limit" | "exit_nonzero" | "spawn_error";
  /** Human-readable detail (peer's stderr tail or spawn error message). */
  errorDetail?: string;
}

export interface PeerAgent {
  readonly id: string;
  readonly description: string;
  delegate(prompt: string, opts?: DelegateOptions): Promise<PeerResult>;
}

// -------------------- CliSubprocessPeer --------------------

export interface CliSubprocessPeerConfig {
  id: string;
  description: string;
  /** Executable name or absolute path (`cursor-agent`, `oz`, `claude`, etc.). */
  command: string;
  /** Static args prepended to every invocation (e.g. `["agent", "run"]` for `oz agent run`). */
  args: string[];
  /**
   * How the prompt is passed to the command:
   *   - "flag-then-value" — `[...args, promptFlag, prompt]` (most common: `-p "<prompt>"`)
   *   - "stdin"           — prompt written to stdin after spawn (some interactive CLIs)
   */
  promptMode: "flag-then-value" | "stdin";
  /** Flag for prompt when promptMode = "flag-then-value". */
  promptFlag?: string;
  /** Default timeout. Per-call override possible. Default 5 minutes. */
  defaultTimeoutMs?: number;
  /** Default working directory. Per-call override possible. */
  defaultWorkdir?: string;
  /** Env vars merged onto `process.env` for the child. */
  defaultEnv?: Record<string, string>;
  /** Additional process-env keys this peer needs, typically its own API key. */
  inheritedEnvKeys?: string[];
  /** Combined stdout/stderr cap. Default 1 MiB. */
  maxOutputBytes?: number;
}

/**
 * Spawn-function shape — injected for tests. Defaults to `node:child_process` spawn.
 */
type SpawnFn = typeof nodeSpawn;

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const BASE_CHILD_ENV_KEYS = [
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "TEMP",
  "TMP",
  "SHELL",
  "TERM",
  "LANG",
  "LC_ALL",
] as const;

function selectChildEnv(keys: readonly string[]): Record<string, string> {
  const selected: Record<string, string> = {};
  for (const key of keys) {
    const value = process.env[key];
    if (value !== undefined) selected[key] = value;
  }
  return selected;
}

function appendWithinLimit(current: string, chunk: Buffer, remainingBytes: number): string {
  if (remainingBytes <= 0) return current;
  return current + chunk.subarray(0, remainingBytes).toString("utf-8");
}

export class CliSubprocessPeer implements PeerAgent {
  readonly id: string;
  readonly description: string;
  private readonly config: CliSubprocessPeerConfig;
  private readonly spawnFn: SpawnFn;

  constructor(config: CliSubprocessPeerConfig, spawnFn: SpawnFn = nodeSpawn) {
    if (config.promptMode === "flag-then-value" && !config.promptFlag) {
      throw new Error(`Peer ${config.id}: promptMode="flag-then-value" requires promptFlag`);
    }
    this.id = config.id;
    this.description = config.description;
    this.config = config;
    this.spawnFn = spawnFn;
  }

  async delegate(prompt: string, opts: DelegateOptions = {}): Promise<PeerResult> {
    const started = Date.now();
    if (!prompt || prompt.length < 1) {
      return {
        success: false,
        output: "",
        stderr: "",
        exitCode: null,
        durationMs: 0,
        error: "spawn_error",
        errorDetail: "empty prompt",
      };
    }
    if (opts.signal?.aborted) {
      return {
        success: false,
        output: "",
        stderr: "",
        exitCode: null,
        durationMs: 0,
        error: "aborted",
        errorDetail: "delegation aborted by caller",
      };
    }

    const timeoutMs = opts.timeoutMs ?? this.config.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    const workdir = opts.workdir ?? this.config.defaultWorkdir ?? process.cwd();
    const childEnv: Record<string, string> = {
      ...selectChildEnv([...BASE_CHILD_ENV_KEYS, ...(this.config.inheritedEnvKeys ?? [])]),
      ...(this.config.defaultEnv ?? {}),
      ...(opts.env ?? {}),
    };
    const maxOutputBytes = this.config.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes <= 0) {
      throw new Error(`Peer ${this.id}: maxOutputBytes must be a positive safe integer`);
    }

    const args = [...this.config.args];
    if (this.config.promptMode === "flag-then-value") {
      args.push(this.config.promptFlag!, prompt);
    }

    const spawnOptions: SpawnOptionsWithoutStdio = {
      cwd: workdir,
      env: childEnv,
      // Inherit stdio off — we capture stdout/stderr explicitly.
      stdio: ["pipe", "pipe", "pipe"],
    };

    return new Promise<PeerResult>((resolve) => {
      let child: ReturnType<SpawnFn>;
      try {
        child = this.spawnFn(this.config.command, args, spawnOptions);
      } catch (err) {
        resolve({
          success: false,
          output: "",
          stderr: "",
          exitCode: null,
          durationMs: Date.now() - started,
          error: "spawn_error",
          errorDetail: err instanceof Error ? err.message : String(err),
        });
        return;
      }

      let stdout = "";
      let stderr = "";
      let outputBytes = 0;
      let settled = false;

      const settle = (result: PeerResult) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(result);
      };

      const onAbort = () => {
        try {
          child?.kill("SIGTERM");
        } catch {
          /* child already exited */
        }
        settle({
          success: false,
          output: stdout,
          stderr,
          exitCode: null,
          durationMs: Date.now() - started,
          error: "aborted",
          errorDetail: "delegation aborted by caller",
        });
      };

      const timer = setTimeout(() => {
        try {
          child?.kill("SIGTERM");
        } catch {
          /* already exited */
        }
        settle({
          success: false,
          output: stdout,
          stderr,
          exitCode: null,
          durationMs: Date.now() - started,
          error: "timeout",
          errorDetail: `delegation exceeded ${timeoutMs}ms`,
        });
      }, timeoutMs);

      const cleanup = () => {
        clearTimeout(timer);
        opts.signal?.removeEventListener("abort", onAbort);
      };

      opts.signal?.addEventListener("abort", onAbort, { once: true });

      const capture = (stream: "stdout" | "stderr", buf: Buffer) => {
        if (settled) return;
        const remaining = maxOutputBytes - outputBytes;
        if (stream === "stdout") stdout = appendWithinLimit(stdout, buf, remaining);
        else stderr = appendWithinLimit(stderr, buf, remaining);
        outputBytes += Math.min(buf.byteLength, Math.max(remaining, 0));
        if (buf.byteLength <= remaining) return;
        try {
          child?.kill("SIGTERM");
        } catch {
          /* child already exited */
        }
        settle({
          success: false,
          output: stdout,
          stderr,
          exitCode: null,
          durationMs: Date.now() - started,
          error: "output_limit",
          errorDetail: `peer output exceeded ${maxOutputBytes} bytes`,
        });
      };

      child.stdout?.on("data", (buf: Buffer) => capture("stdout", buf));
      child.stderr?.on("data", (buf: Buffer) => capture("stderr", buf));

      child.on("error", (err: Error) => {
        settle({
          success: false,
          output: stdout,
          stderr,
          exitCode: null,
          durationMs: Date.now() - started,
          error: "spawn_error",
          errorDetail: err.message,
        });
      });

      child.on("close", (code: number | null) => {
        if (this.config.promptMode === "stdin") {
          // already written below
        }
        const durationMs = Date.now() - started;
        if (code === 0) {
          settle({
            success: true,
            output: stdout,
            stderr,
            exitCode: 0,
            durationMs,
          });
        } else {
          settle({
            success: false,
            output: stdout,
            stderr,
            exitCode: code,
            durationMs,
            error: "exit_nonzero",
            errorDetail: stderr.slice(-500) || `exit ${code}`,
          });
        }
      });

      if (this.config.promptMode === "stdin") {
        try {
          child.stdin?.write(prompt);
          child.stdin?.end();
        } catch (err) {
          logger.debug("stdin write failed", { peer: this.id, err: String(err) });
        }
      }
    });
  }
}

// -------------------- registry --------------------

/**
 * First two peers — verified reachable per the docs scan.
 *
 * Cursor: `cursor-agent -p "<prompt>"` — non-interactive headless mode.
 * Auth via `CURSOR_API_KEY` env (operator's existing Cursor key).
 *
 * Warp:   `oz agent run --prompt "<prompt>"` — Oz CLI headless. Auth via
 * `WARP_API_KEY` env (operator's existing Warp key). Note this spawns
 * a CLOUD agent run, not a local terminal — Warp doesn't expose local
 * terminal driving from outside.
 *
 * Adding more peers (Claude Code, Codex, Hermes, OpenClaw) later is a
 * one-entry change here once their headless invocation shape is verified.
 */
export const PEER_REGISTRY: Record<string, PeerAgent> = {
  cursor: new CliSubprocessPeer({
    id: "cursor",
    description:
      "Cursor's local AI coding agent (headless `cursor-agent -p`). " +
      "Use for code editing, refactor, or write-this-file tasks where the " +
      "operator explicitly delegates to Cursor.",
    command: "cursor-agent",
    args: [],
    promptMode: "flag-then-value",
    promptFlag: "-p",
    defaultTimeoutMs: 5 * 60 * 1000,
    inheritedEnvKeys: ["CURSOR_API_KEY"],
  }),
  warp: new CliSubprocessPeer({
    id: "warp",
    description:
      "Warp's Oz cloud agent (`oz agent run --prompt`). Spawns a cloud-side " +
      "run — not the local terminal. Use for CI-style automation tasks where " +
      "the operator delegates to Warp's cloud-runner.",
    command: "oz",
    args: ["agent", "run"],
    promptMode: "flag-then-value",
    promptFlag: "--prompt",
    defaultTimeoutMs: 10 * 60 * 1000,
    inheritedEnvKeys: ["WARP_API_KEY"],
  }),
};

export function listPeers(): PeerAgent[] {
  return Object.values(PEER_REGISTRY);
}

export function getPeer(id: string): PeerAgent | undefined {
  return PEER_REGISTRY[id];
}

export function peerResultToPayload(result: PeerResult): Record<string, unknown> {
  return {
    kind: "peer_delegation.result",
    success: result.success,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    outputBytes: Buffer.byteLength(result.output),
    stderrBytes: Buffer.byteLength(result.stderr),
    error: result.error ?? null,
    errorDetail: result.errorDetail ?? null,
    // Output itself is returned separately by the tool so the model sees
    // the actual content — this payload is for structured observation.
  };
}
