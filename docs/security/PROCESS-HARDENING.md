# Gordon Process Hardening — Core Dumps & Secret Leakage

> **What this is.** The threat model and the layered enforcement of one specific
> leak vector for a money-handling agent: a crash (SIGSEGV / SIGABRT), a
> fatal-error diagnostic report, or an attached debugger writing in-memory
> secrets — exchange / broker / LLM API keys — to disk.

Companion documents: [`RISK-TAXONOMY.md`](./RISK-TAXONOMY.md),
[`PERMISSION-PROFILES.md`](./PERMISSION-PROFILES.md),
[`../../SECURITY.md`](../../SECURITY.md).

Implementation: [`../../src/infra/safety/processHardening.ts`](../../src/infra/safety/processHardening.ts)
(in-process) + [`../../npm/bin/gordon.cjs`](../../npm/bin/gordon.cjs) (launcher).

---

## The threat

Gordon holds API keys in process memory and in the environment block. On a
crash, three things can serialize that memory to disk:

1. **A core dump** — the kernel writes the full process image (including the
   environment block and heap, where keys live) to a core file.
2. **A Node/Bun diagnostic report** — `--report-on-fatalerror` / signal reports
   embed the entire environment block as JSON.
3. **A debugger** (`PTRACE_ATTACH`) — reads live process memory.

This document covers (1), the **core dump**. (2) and (3) are handled in-process
where reachable — see the header comment in `processHardening.ts`.

---

## What is ENFORCED, and where

| Vector | Mechanism | Where | Platform |
|---|---|---|---|
| Diagnostic report on fatal error / signal | `process.report.reportOnFatalError = false`, `reportOnSignal = false`, `excludeEnv = true` | `processHardening.ts` (in-process, always-on) | all |
| `--report-*` injected into child via `NODE_OPTIONS` | strip `--report-*` tokens | `processHardening.ts` (opt-in `GORDON_PROCESS_HARDENING=1`) | all |
| **Core dump** | `ulimit -c 0` before `exec` | **npm launcher** `gordon.cjs` (POSIX only) | Linux / macOS |
| **Core dump** | `LimitCORE=0` | **operator systemd unit** | Linux |
| **Core dump** | `ulimit -c 0` in shell profile / wrapper | **operator** | Linux / macOS |

> **Why not in `processHardening.ts`?** Bun does not expose `setrlimit(2)` to
> JS, so the core-dump limit **cannot** be zeroed from inside the running
> process. It must be set by the parent before `exec`. `processHardening.ts`
> only *detects* (at debug log level) whether the limit is already zero — it
> never claims to set it.

### 1. npm launcher (`gordon.cjs`) — automatic on POSIX

When Gordon is started via the npm wrapper, on Linux/macOS the wrapper execs
the native binary through a minimal shell that zeroes the core limit first:

```sh
/bin/sh -c 'ulimit -c 0; exec "$@"' sh <binary> <args...>
```

- The binary path and all args are passed as **positional parameters** (`"$@"`)
  — never interpolated into the command string — so there is no
  command-injection surface.
- `stdio: 'inherit'` and exit-code / signal propagation are byte-for-byte
  identical to the direct-spawn path.
- **Windows is unaffected**: no core dumps exist there and there is no POSIX
  `ulimit`, so the wrapper keeps the original direct `spawn(binaryPath, args)`.

This covers users who install via `npm i -g @general-liquidity/gordon`.

### 2. Operators running the binary directly

Users who download the standalone binary (via `install.sh`) and run it
directly — or under a service manager — bypass the npm wrapper. They should
enforce the core limit themselves. Two equivalent options:

**systemd unit (recommended for daemons):**

```ini
[Service]
ExecStart=/usr/local/bin/gordon
# Disable core dumps — they would contain in-memory API keys.
LimitCORE=0
# Defense in depth (optional, hardens the same leak class):
# PrivateTmp=true
# ProtectSystem=strict
# NoNewPrivileges=true
```

`LimitCORE=0` sets `RLIMIT_CORE` to 0 for the service process — the strongest
and most durable option, since it cannot be re-raised by the process.

**Shell `ulimit` (interactive / wrapper scripts):**

```sh
# In the shell (or a wrapper) that launches gordon directly:
ulimit -c 0
exec gordon "$@"
```

Add `ulimit -c 0` to the relevant shell profile, or wrap the invocation, before
`exec`-ing the binary.

> **macOS note.** macOS does not write core dumps by default (`/cores` is
> typically absent/non-writable), but `ulimit -c 0` is still the correct belt
> for the npm-launcher and wrapper paths.

---

## Verifying enforcement

- **Launcher path:** the binary inherits the limit. To confirm on Linux, check
  `Max core file size` in `/proc/<pid>/limits` for the running Gordon process —
  the soft limit should read `0`.
- **In-process detection:** with debug logging enabled, `processHardening.ts`
  emits a `core-dump limit detected (not enforced here)` line on Linux carrying
  the detected soft limit. This is **observational only** — it confirms what the
  launcher/systemd already enforced; it does not itself enforce anything.
