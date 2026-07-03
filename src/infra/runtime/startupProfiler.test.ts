import { afterEach, describe, expect, test } from "bun:test";
import {
  getStartupCheckpoints,
  getStartupTaskTimings,
  foldParallelStartup,
  isStartupProfilingEnabled,
  profileCheckpoint,
  renderStartupProfile,
  resetStartupProfiler,
  type ProfileCheckpoint,
  type ProfileTaskTiming,
} from "./startupProfiler.ts";
import type { StartupResult } from "./parallelStartup.ts";

afterEach(() => {
  delete process.env.GORDON_PROFILE_STARTUP;
  resetStartupProfiler();
});

describe("profileCheckpoint", () => {
  test("is a no-op when profiling is disabled", () => {
    resetStartupProfiler();
    profileCheckpoint("boot");
    expect(isStartupProfilingEnabled()).toBe(false);
    expect(getStartupCheckpoints()).toHaveLength(0);
  });

  test("records checkpoints when enabled", () => {
    process.env.GORDON_PROFILE_STARTUP = "1";
    resetStartupProfiler(0);
    profileCheckpoint("guards");
    profileCheckpoint("license");
    const marks = getStartupCheckpoints();
    expect(marks.map((m) => m.name)).toEqual(["guards", "license"]);
    expect(marks[0]!.at).toBeGreaterThanOrEqual(0);
  });

  test("folds parallel-startup task durations", () => {
    process.env.GORDON_PROFILE_STARTUP = "1";
    resetStartupProfiler(0);
    const result: StartupResult = {
      totalDurationMs: 50,
      allRequiredSucceeded: true,
      tasks: [
        { id: "config", label: "Load configuration", success: true, durationMs: 45, timedOut: false },
        { id: "memory", label: "Load session memory", success: false, durationMs: 3, timedOut: true },
      ],
    };
    foldParallelStartup(result);
    const timings = getStartupTaskTimings();
    expect(timings).toHaveLength(2);
    expect(timings[0]!.id).toBe("config");
    expect(timings[1]!.timedOut).toBe(true);
  });
});

describe("renderStartupProfile", () => {
  const marks: ProfileCheckpoint[] = [
    { name: "guards", at: 12.3 },
    { name: "license", at: 16.4 },
    { name: "parallel-startup", at: 61.4 },
    { name: "pre-tui", at: 147.1 },
  ];
  const tasks: ProfileTaskTiming[] = [
    { id: "config", label: "Load configuration", durationMs: 45, success: true, timedOut: false },
    { id: "memory", label: "Load session memory", durationMs: 3, success: false, timedOut: true },
  ];

  test("renders a phase table with per-phase durations and a total", () => {
    const report = renderStartupProfile(marks, tasks);
    expect(report).toContain("Startup profile");
    expect(report).toContain("guards");
    // license phase = 16.4 - 12.3 = 4.1ms
    expect(report).toContain("4.1ms");
    // total is the last checkpoint offset
    expect(report).toContain("total");
    expect(report).toContain("147.1ms");
    // parallel-startup phase = 61.4 - 16.4 = 45.0ms
    expect(report).toContain("45.0ms");
  });

  test("lists parallel tasks with status flags", () => {
    const report = renderStartupProfile(marks, tasks);
    expect(report).toContain("parallel tasks");
    expect(report).toContain("config");
    expect(report).toContain("(timeout)");
  });

  test("returns empty string when there are no checkpoints", () => {
    expect(renderStartupProfile([], [])).toBe("");
  });
});
