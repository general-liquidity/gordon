# Subprocess Sandbox (opt-in)

> **What this is.** An **opt-in** confinement layer for the child processes Gordon spawns but does
> not author — chiefly MCP plugin servers (`src/infra/ai/mcp/server-instance.ts`) and, externally,
> the MT5 bridge. When enabled and a host sandbox tool is present, Gordon rewrites the child's
> launch `command`/`args` to run it under [bubblewrap](https://github.com/containers/bubblewrap)
> (`bwrap`) on Linux or `sandbox-exec` (Seatbelt) on macOS. Mirrors Codex's approach.

Companion documents: [`RISK-TAXONOMY.md`](./RISK-TAXONOMY.md),
[`PERMISSION-PROFILES.md`](./PERMISSION-PROFILES.md).

Implementation: [`../../src/infra/safety/subprocessSandbox.ts`](../../src/infra/safety/subprocessSandbox.ts).

## It is OFF by default

Without an explicit opt-in, **every launch is byte-identical to a direct spawn** — the wrapper
returns the command/args unchanged. Flipping it on is an operator decision; nothing in the default
build runs children sandboxed.

## Enabling it

Two equivalent toggles (either one enables; both default absent → OFF):

- **Environment variable** (per-run override, wins when set):
  ```sh
  GORDON_SANDBOX_SUBPROCESS=1   # also: true | yes | on
  ```
  An explicit falsy value (`0`, `false`, `no`, `off`) disables it for that run and does **not** fall
  through to config.

- **Settings layer** (`sandbox.subprocess: true`) in any file of the 7-level priority chain
  (`.gordon/settings.json`, `~/.gordon/settings.local.json`, a profile, or policy). Consulted only
  when the env var is unset:
  ```json
  { "sandbox": { "subprocess": true } }
  ```

## What it guarantees (and what it does NOT)

**Guarantees — filesystem-write confinement.** The whole filesystem is mounted **read-only**
(`--ro-bind / /` under bwrap; `(allow file-read*)` under Seatbelt) so a child can still **read** its
own package, `node_modules`, and config. Writes are confined to an explicit set of writable roots:

- the **OS temp dir** (`os.tmpdir()`), and
- the **current working / project dir** (`process.cwd()`).

MCP servers routinely write caches, logs, and lockfiles into both — granting only a single scratch
dir breaks them. The writable set is overridable via `opts.writableRoots`.

**Never writable.** The **home-directory root** and the **filesystem root (`/`)** are always
excluded — even if passed explicitly via `writableRoots`. This keeps credentials and dotfiles
(`.env`, `~/.gordon`, ssh keys, shell rc files) read-only. (Subpaths of home — e.g. a project dir
that happens to live under home — are still allowed; only the home root itself is dropped.)

**Network stays ALLOWED for MCP.** Most MCP servers call vendor APIs, so the MCP wiring passes
`allowNetwork: true` and the sandbox does **not** unshare the network. Filesystem-write confinement
is the primary protection, not network deny. Network is unshared (`--unshare-net` / no
`(allow network*)`) only when a caller explicitly passes `allowNetwork: false`.

This is **not** a full container/jail: it does not isolate PIDs beyond `--die-with-parent`, does not
restrict CPU/memory, and (for MCP) does not block outbound network. Treat it as defense-in-depth
against a misbehaving or compromised third-party server writing outside its sandbox — not as a
complete isolation boundary.

## Requirements

- **Linux:** `bwrap` (bubblewrap) on `PATH`.
- **macOS:** `sandbox-exec` (ships with macOS; Seatbelt).
- **Windows / other:** no host sandbox tool → see fallback below.

## Fallback behavior (enabled but unavailable)

If the operator opts in but no host sandbox tool is on `PATH` (or the platform is unsupported),
Gordon logs a **single warning** and **passes the launch through unchanged** — the child spawns
exactly as it would by default. An unavailable sandbox degrades to current behavior; it never throws
and never blocks the launch.
