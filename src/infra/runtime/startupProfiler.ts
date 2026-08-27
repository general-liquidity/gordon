/**
 * Startup Profiler
 *
 * Claude Code pattern: lightweight boot instrumentation. `profileCheckpoint`
 * stamps a named marker with a high-resolution timestamp; the phase aggregator
 * turns the marker sequence into per-phase durations and prints a report on
 * boot when GORDON_PROFILE_STARTUP=1.
 *
 * Pure timing — every entry point is a no-op unless profiling is enabled, so
 * there is no behavior change on the normal path. Per-task durations from
 * `parallelStartup` are folded in via `foldParallelStartup` so the concurrent
 * boot tasks show up alongside the sequential phases.
 */

import type { StartupResult } from "./parallelStartup.ts";

// ============================================================================
// Types
// ============================================================================

export interface ProfileCheckpoint {
  name: string;
  /** Milliseconds since the profiler epoch. */
  at: number;
}

export interface ProfileTaskTiming {
  id: string;
  label: string;
  durationMs: number;
  timedOut?: boolean;
  success?: boolean;
}

// ============================================================================
// Module state
// ============================================================================

let epoch = now();
const checkpoints: ProfileCheckpoint[] = [];
const taskTimings: ProfileTaskTiming[] = [];

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export function isStartupProfilingEnabled(): boolean {
  const v = process.env.GORDON_PROFILE_STARTUP;
  return v === "1" || v === "true";
}

/** Reset profiler state (mainly for tests). */
export function resetStartupProfiler(epochNow: number = now()): void {
  epoch = epochNow;
  checkpoints.length = 0;
  taskTimings.length = 0;
}

/** Record a named checkpoint. No-op unless profiling is enabled. */
export function profileCheckpoint(name: string): void {
  if (!isStartupProfilingEnabled()) return;
  checkpoints.push({ name, at: now() - epoch });
}

/** Fold per-task durations from a parallel-startup run into the report. */
export function foldParallelStartup(result: StartupResult): void {
  if (!isStartupProfilingEnabled()) return;
  for (const t of result.tasks) {
    taskTimings.push({
      id: t.id,
      label: t.label,
      durationMs: t.durationMs,
      timedOut: t.timedOut,
      success: t.success,
    });
  }
}

export function getStartupCheckpoints(): ProfileCheckpoint[] {
  return checkpoints.slice();
}

export function getStartupTaskTimings(): ProfileTaskTiming[] {
  return taskTimings.slice();
}

// ============================================================================
// Report
// ============================================================================

function fmtMs(ms: number): string {
  return `${ms.toFixed(1)}ms`;
}

/**
 * Render the phase-timing report from raw checkpoint + task timings.
 * Pure — deterministic for a given input, so it can be exercised from fixtures.
 */
export function renderStartupProfile(
  marks: ProfileCheckpoint[],
  tasks: ProfileTaskTiming[] = [],
): string {
  if (marks.length === 0) return "";

  const rows: Array<{ name: string; dur: number }> = [];
  let prev = 0;
  for (const m of marks) {
    rows.push({ name: m.name, dur: Math.max(0, m.at - prev) });
    prev = m.at;
  }
  const total = marks[marks.length - 1]!.at;

  const nameWidth = Math.max(
    5,
    ...rows.map((r) => r.name.length),
    ...tasks.map((t) => t.id.length + 2),
  );
  const pad = (s: string) => s.padEnd(nameWidth);

  const lines: string[] = [];
  lines.push("Startup profile (GORDON_PROFILE_STARTUP)");
  for (const r of rows) {
    lines.push(`  ${pad(r.name)}  ${fmtMs(r.dur).padStart(9)}`);
  }
  lines.push(`  ${pad("total")}  ${fmtMs(total).padStart(9)}`);

  if (tasks.length > 0) {
    lines.push("");
    lines.push("  parallel tasks");
    for (const t of tasks) {
      const flag = t.timedOut ? " (timeout)" : t.success === false ? " (failed)" : "";
      lines.push(`  ${pad(`  ${t.id}`)}  ${fmtMs(t.durationMs).padStart(9)}${flag}`);
    }
  }

  return lines.join("\n");
}

/** Print the report to stderr when profiling is enabled. */
export function printStartupProfile(): void {
  if (!isStartupProfilingEnabled()) return;
  const report = renderStartupProfile(checkpoints, taskTimings);
  if (report) process.stderr.write(`${report}\n`);
}
