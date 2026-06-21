import { createModuleLogger } from "../logger/index.ts";

// Best-effort process hardening for a money-handling agent. Goal: reduce the
// chance that a crash, fatal-error diagnostic report, or attached debugger
// leaks in-memory secrets (exchange / broker / LLM API keys) to disk or a log.
//
// HONEST SCOPE — what this DOES and DOES NOT enforce, in pure Bun/TS:
//
//   ENFORCED (in-process, reachable from Bun/Node):
//     - Disables Node/Bun diagnostic reports on fatal error and on signal
//       (`process.report.reportOnFatalError` / `reportOnSignal`). Those
//       reports embed the full environment block, which is where keys live.
//     - Sets `process.report.excludeEnv = true` when the runtime supports it,
//       so any report that IS still produced omits env vars.
//     - Strips `--report-*` flags from `process.env.NODE_OPTIONS` so a child
//       Bun/Node process can't be told to write a report either.
//
//   NOT ENFORCED HERE — needs the launcher or a native layer:
//     - True RLIMIT_CORE=0 (core dumps). Bun does not expose setrlimit to JS,
//       so we CANNOT zero the core-dump limit from this file. A real core dump
//       on SIGSEGV/SIGABRT will still contain process memory. To enforce, the
//       launcher must do it: `ulimit -c 0` (sh) before exec, a systemd unit
//       `LimitCORE=0`, or a native wrapper calling setrlimit(RLIMIT_CORE, 0).
//       Codex's `process-hardening` crate does this in Rust; we have no JS
//       equivalent. See scripts note in the launcher; do NOT assume it's on.
//     - ptrace / PTRACE_ATTACH hardening (anti-debugger). Requires prctl(
//       PR_SET_DUMPABLE, 0) on Linux — native-only, not reachable from Bun.
//     - LD_PRELOAD stripping for child processes — environment-policy concern,
//       left to the launcher.
//
// EVERY step is wrapped so a failure is logged-and-ignored: this must never
// throw and must never change the behavior of a normal run. The safe,
// no-side-effect subset (report suppression) runs always; the NODE_OPTIONS
// rewrite (which mutates an env var children inherit) is gated behind the
// opt-in GORDON_PROCESS_HARDENING flag.

const logger = createModuleLogger("process-hardening");

export const PROCESS_HARDENING_FLAG_ENV = "GORDON_PROCESS_HARDENING";

let installed = false;

function isAggressiveEnabled(env: NodeJS.ProcessEnv): boolean {
  const v = env[PROCESS_HARDENING_FLAG_ENV];
  return v === "1" || v === "true";
}

// Suppress diagnostic reports that serialize the environment block on crash.
// Reachable from Bun/Node via the `process.report` object when present.
function suppressDiagnosticReports(): void {
  try {
    const report = (process as NodeJS.Process & { report?: Record<string, unknown> }).report;
    if (!report) return;
    if ("reportOnFatalError" in report) {
      report.reportOnFatalError = false;
    }
    if ("reportOnSignal" in report) {
      report.reportOnSignal = false;
    }
    // excludeEnv keeps env vars out of any report still emitted. Older
    // runtimes don't expose it; setting it is a no-op there, so only touch
    // it when the property already exists to avoid surprising getters.
    if ("excludeEnv" in report) {
      report.excludeEnv = true;
    }
  } catch (err) {
    logger.debug("suppressDiagnosticReports failed (ignored)", { error: String(err) });
  }
}

// Remove any `--report-*` flags from NODE_OPTIONS so a spawned child can't be
// instructed to write a diagnostic report. Does NOT delete real keys — only
// rewrites this one transport-control var. Gated: it mutates inherited env.
function stripReportFlagsFromNodeOptions(env: NodeJS.ProcessEnv): void {
  try {
    const current = env.NODE_OPTIONS;
    if (!current) return;
    const cleaned = current
      .split(/\s+/)
      .filter((tok) => tok.length > 0 && !tok.startsWith("--report-"))
      .join(" ");
    if (cleaned === current) return;
    if (cleaned.length === 0) {
      delete env.NODE_OPTIONS;
    } else {
      env.NODE_OPTIONS = cleaned;
    }
  } catch (err) {
    logger.debug("stripReportFlagsFromNodeOptions failed (ignored)", { error: String(err) });
  }
}

/**
 * Install best-effort process hardening. Idempotent. Never throws.
 *
 * Always-on (no side effects on a normal run): diagnostic-report suppression.
 * Opt-in via GORDON_PROCESS_HARDENING=1: NODE_OPTIONS `--report-*` stripping,
 * which mutates an env var that child processes inherit.
 */
export function installProcessHardening(env: NodeJS.ProcessEnv = process.env): void {
  if (installed) return;
  installed = true;

  suppressDiagnosticReports();

  if (isAggressiveEnabled(env)) {
    stripReportFlagsFromNodeOptions(env);
  }
}

export function resetProcessHardeningForTesting(): void {
  installed = false;
}
