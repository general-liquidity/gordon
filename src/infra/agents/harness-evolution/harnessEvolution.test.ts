import { describe, it, expect, beforeEach } from "bun:test";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  isHarnessEvolutionEnabled,
  defaultHarnessEvolutionLogPath,
  generateHarnessId,
  resetHarnessIdCounterForTesting,
  cloneHarness,
  isBetterScore,
  runHarnessEvolutionLoop,
  formatEvolutionResult,
  resultToPayload,
  HARNESS_EVOLUTION_FLAG_ENV,
  HARNESS_EVOLUTION_LOG_PATH_ENV,
  type HarnessConfig,
  type BlueprintHooks,
  type EvaluationReport,
  type Trace,
} from "./harnessEvolution.ts";

let tempDir: string;
let logPath: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "gordon-harness-evo-test-"));
  logPath = join(tempDir, "evolution.jsonl");
  resetHarnessIdCounterForTesting();
});

// ============================================================================
// Test fixtures
// ============================================================================

function makeHarness(id: string, overrides: Partial<HarnessConfig> = {}): HarnessConfig {
  return {
    id,
    instructions: { systemPrompt: "be helpful" },
    tools: { allowed: ["search"] },
    environment: { modelId: "claude-sonnet-4-7" },
    state: { memoryBudgetChars: 2200 },
    feedback: { rubricDimensions: ["correctness"] },
    ...overrides,
  };
}

/** Hooks that score current iteration k by `scoreSchedule[k - 1]`. */
function makeScriptedHooks(
  scoreSchedule: Array<{ score: number; passed?: boolean }>,
): { hooks: BlueprintHooks; callsTo: { execute: number; evaluate: number; evolve: number } } {
  const callsTo = { execute: 0, evaluate: 0, evolve: 0 };
  let cursor = 0;
  const hooks: BlueprintHooks = {
    async execute(_h: HarnessConfig, _t: string): Promise<Trace> {
      callsTo.execute += 1;
      return { trace: callsTo.execute };
    },
    async evaluate(_trace: Trace, _t: string): Promise<EvaluationReport> {
      const step = scoreSchedule[cursor] ?? { score: 0, passed: false };
      cursor += 1;
      callsTo.evaluate += 1;
      return {
        score: step.score,
        passed: step.passed ?? false,
        rationale: `step ${callsTo.evaluate}`,
        diagnostics: [],
      };
    },
    async evolve(history, bestHarness, _lastReport): Promise<HarnessConfig> {
      callsTo.evolve += 1;
      return makeHarness(`${bestHarness.id}-evo${history.length}`);
    },
  };
  return { hooks, callsTo };
}

// ============================================================================
// Helpers
// ============================================================================

describe("isHarnessEvolutionEnabled", () => {
  it("respects the flag", () => {
    expect(isHarnessEvolutionEnabled({})).toBe(false);
    expect(isHarnessEvolutionEnabled({ [HARNESS_EVOLUTION_FLAG_ENV]: "1" })).toBe(true);
    expect(isHarnessEvolutionEnabled({ [HARNESS_EVOLUTION_FLAG_ENV]: "true" })).toBe(true);
  });
});

describe("defaultHarnessEvolutionLogPath", () => {
  it("honors env override", () => {
    expect(
      defaultHarnessEvolutionLogPath({ [HARNESS_EVOLUTION_LOG_PATH_ENV]: "/x.jsonl" }),
    ).toBe("/x.jsonl");
  });
  it("falls back to home-dir default", () => {
    expect(defaultHarnessEvolutionLogPath({})).toContain("harness-evolution.jsonl");
  });
});

describe("generateHarnessId", () => {
  it("produces unique ids", () => {
    const a = generateHarnessId();
    const b = generateHarnessId();
    expect(a).not.toBe(b);
  });
  it("respects prefix", () => {
    const id = generateHarnessId("worker");
    expect(id.startsWith("worker-")).toBe(true);
  });
});

describe("cloneHarness", () => {
  it("returns a deep-equal copy", () => {
    const h = makeHarness("h-1");
    const c = cloneHarness(h);
    expect(c).toEqual(h);
    expect(c).not.toBe(h);
  });
  it("does not share nested references", () => {
    const h = makeHarness("h-1");
    h.notes = ["original"];
    const c = cloneHarness(h);
    c.notes!.push("mutated");
    expect(h.notes).toEqual(["original"]);
  });
});

describe("isBetterScore", () => {
  it("returns true only when strictly greater", () => {
    expect(isBetterScore(1, 0)).toBe(true);
    expect(isBetterScore(0, 0)).toBe(false);
    expect(isBetterScore(-1, 0)).toBe(false);
  });
});

// ============================================================================
// Loop semantics
// ============================================================================

describe("runHarnessEvolutionLoop — input validation", () => {
  it("rejects maxIterations < 1", async () => {
    const { hooks } = makeScriptedHooks([{ score: 1 }]);
    await expect(
      runHarnessEvolutionLoop(makeHarness("h-1"), hooks, "task", { maxIterations: 0, noLog: true }),
    ).rejects.toThrow();
  });
});

describe("runHarnessEvolutionLoop — convergence", () => {
  it("stops on first passed=true when no targetScore set", async () => {
    const { hooks, callsTo } = makeScriptedHooks([{ score: 1, passed: true }]);
    const result = await runHarnessEvolutionLoop(makeHarness("h-1"), hooks, "task", {
      maxIterations: 10,
      noLog: true,
    });
    expect(result.terminationReason).toBe("converged");
    expect(result.history.length).toBe(1);
    expect(callsTo.execute).toBe(1);
    expect(callsTo.evolve).toBe(0);
  });

  it("stops only after passed AND score >= targetScore", async () => {
    const { hooks } = makeScriptedHooks([
      { score: 5, passed: true }, // passed but below target
      { score: 9, passed: true }, // converges
    ]);
    const result = await runHarnessEvolutionLoop(makeHarness("h-1"), hooks, "task", {
      maxIterations: 10,
      targetScore: 8,
      noLog: true,
    });
    expect(result.terminationReason).toBe("converged");
    expect(result.history.length).toBe(2);
  });

  it("does not converge on passed=false even at high score", async () => {
    const { hooks } = makeScriptedHooks([{ score: 100, passed: false }]);
    const result = await runHarnessEvolutionLoop(makeHarness("h-1"), hooks, "task", {
      maxIterations: 1,
      noLog: true,
    });
    expect(result.terminationReason).toBe("max_iterations");
  });
});

describe("runHarnessEvolutionLoop — max iterations", () => {
  it("runs exactly K iterations when nothing converges", async () => {
    const { hooks, callsTo } = makeScriptedHooks(
      Array.from({ length: 5 }, () => ({ score: 0, passed: false })),
    );
    const result = await runHarnessEvolutionLoop(makeHarness("h-1"), hooks, "task", {
      maxIterations: 5,
      noLog: true,
    });
    expect(result.terminationReason).toBe("max_iterations");
    expect(result.history.length).toBe(5);
    expect(callsTo.execute).toBe(5);
    // Evolve is called between iterations, so 4 times for 5 iterations
    expect(callsTo.evolve).toBe(4);
  });
});

describe("runHarnessEvolutionLoop — patience", () => {
  it("stops after `patience` iterations of no improvement", async () => {
    const { hooks } = makeScriptedHooks([
      { score: 5 }, // best
      { score: 4 }, // no improvement (1)
      { score: 3 }, // no improvement (2)
      { score: 2 }, // would be no improvement (3) — should stop here
    ]);
    const result = await runHarnessEvolutionLoop(makeHarness("h-1"), hooks, "task", {
      maxIterations: 10,
      patience: 3,
      noLog: true,
    });
    expect(result.terminationReason).toBe("no_improvement");
    expect(result.history.length).toBeLessThanOrEqual(4);
    expect(result.bestScore).toBe(5);
    expect(result.bestIteration).toBe(1);
  });

  it("resets patience counter on improvement", async () => {
    const { hooks } = makeScriptedHooks([
      { score: 1 }, // best
      { score: 0 }, // no improvement (1)
      { score: 2 }, // new best — patience resets
      { score: 1 }, // no improvement (1)
      { score: 0 }, // no improvement (2)
      { score: 0 }, // would be no improvement (3) — should stop here
    ]);
    const result = await runHarnessEvolutionLoop(makeHarness("h-1"), hooks, "task", {
      maxIterations: 10,
      patience: 3,
      noLog: true,
    });
    expect(result.terminationReason).toBe("no_improvement");
    expect(result.bestScore).toBe(2);
    expect(result.bestIteration).toBe(3);
  });
});

describe("runHarnessEvolutionLoop — best tracking", () => {
  it("keeps best harness when subsequent harnesses score worse", async () => {
    const { hooks } = makeScriptedHooks([{ score: 5 }, { score: 1 }, { score: 0 }]);
    const result = await runHarnessEvolutionLoop(makeHarness("seed"), hooks, "task", {
      maxIterations: 3,
      noLog: true,
    });
    expect(result.bestScore).toBe(5);
    expect(result.bestIteration).toBe(1);
    expect(result.bestHarness.id).toBe("seed"); // the iteration-1 harness
  });

  it("updates best harness to mutated version when later score wins", async () => {
    const { hooks } = makeScriptedHooks([{ score: 1 }, { score: 5 }, { score: 3 }]);
    const result = await runHarnessEvolutionLoop(makeHarness("seed"), hooks, "task", {
      maxIterations: 3,
      noLog: true,
    });
    expect(result.bestScore).toBe(5);
    expect(result.bestIteration).toBe(2);
    // best harness should not be "seed" — it's the evolved iteration-2 one
    expect(result.bestHarness.id).not.toBe("seed");
  });

  it("marks the iteration record as isBest correctly", async () => {
    const { hooks } = makeScriptedHooks([{ score: 1 }, { score: 5 }, { score: 3 }]);
    const result = await runHarnessEvolutionLoop(makeHarness("seed"), hooks, "task", {
      maxIterations: 3,
      noLog: true,
    });
    expect(result.history[0]!.isBest).toBe(true);  // first is always best
    expect(result.history[1]!.isBest).toBe(true);  // 5 > 1
    expect(result.history[2]!.isBest).toBe(false); // 3 < 5
  });
});

describe("runHarnessEvolutionLoop — error handling", () => {
  it("captures execute errors and terminates with reason=error", async () => {
    const hooks: BlueprintHooks = {
      async execute() {
        throw new Error("executor exploded");
      },
      async evaluate() {
        return { score: 0, passed: false, rationale: "" };
      },
      async evolve(_h, b) {
        return b;
      },
    };
    const result = await runHarnessEvolutionLoop(makeHarness("seed"), hooks, "task", {
      maxIterations: 3,
      noLog: true,
    });
    expect(result.terminationReason).toBe("error");
    expect(result.history.length).toBe(1);
    expect(result.history[0]!.error).toContain("executor exploded");
  });

  it("captures evaluate errors", async () => {
    const hooks: BlueprintHooks = {
      async execute() {
        return {};
      },
      async evaluate() {
        throw new Error("evaluator boom");
      },
      async evolve(_h, b) {
        return b;
      },
    };
    const result = await runHarnessEvolutionLoop(makeHarness("seed"), hooks, "task", {
      maxIterations: 3,
      noLog: true,
    });
    expect(result.terminationReason).toBe("error");
    expect(result.history[0]!.error).toContain("evaluator boom");
  });

  it("captures evolve errors AFTER a successful iteration", async () => {
    const hooks: BlueprintHooks = {
      async execute() {
        return {};
      },
      async evaluate() {
        return { score: 1, passed: false, rationale: "ok" };
      },
      async evolve() {
        throw new Error("evolve exploded");
      },
    };
    const result = await runHarnessEvolutionLoop(makeHarness("seed"), hooks, "task", {
      maxIterations: 3,
      noLog: true,
    });
    expect(result.terminationReason).toBe("error");
    expect(result.history[1]!.error).toContain("evolve exploded");
  });
});

describe("runHarnessEvolutionLoop — input isolation", () => {
  it("does not mutate the input initial harness when evolve produces a different one", async () => {
    const seed = makeHarness("seed");
    const original = JSON.stringify(seed);
    const { hooks } = makeScriptedHooks([{ score: 1 }, { score: 2 }]);
    await runHarnessEvolutionLoop(seed, hooks, "task", { maxIterations: 2, noLog: true });
    expect(JSON.stringify(seed)).toBe(original);
  });

  it("history records harness id at time of iteration, not post-evolution", async () => {
    const { hooks } = makeScriptedHooks([{ score: 1 }, { score: 2 }]);
    const result = await runHarnessEvolutionLoop(makeHarness("seed"), hooks, "task", {
      maxIterations: 2,
      noLog: true,
    });
    expect(result.history[0]!.harnessId).toBe("seed");
    // Iteration 2's harness is the post-evolution one named "seed-evo1"
    expect(result.history[1]!.harnessId).toBe("seed-evo1");
  });
});

describe("runHarnessEvolutionLoop — persistence", () => {
  it("appends JSONL records when noLog is not set", async () => {
    const { hooks } = makeScriptedHooks([{ score: 1 }, { score: 2 }]);
    await runHarnessEvolutionLoop(makeHarness("seed"), hooks, "task", {
      maxIterations: 2,
      historyLogPath: logPath,
    });
    expect(existsSync(logPath)).toBe(true);
    const lines = readFileSync(logPath, "utf8").trim().split("\n");
    expect(lines.length).toBe(2);
    const first = JSON.parse(lines[0]!);
    expect(first.iteration).toBe(1);
    expect(first.harnessId).toBe("seed");
  });

  it("creates parent directory if missing", async () => {
    const nested = join(tempDir, "a", "b", "c.jsonl");
    const { hooks } = makeScriptedHooks([{ score: 1 }]);
    await runHarnessEvolutionLoop(makeHarness("seed"), hooks, "task", {
      maxIterations: 1,
      historyLogPath: nested,
    });
    expect(existsSync(nested)).toBe(true);
  });

  it("skips persistence when noLog=true", async () => {
    const { hooks } = makeScriptedHooks([{ score: 1 }]);
    await runHarnessEvolutionLoop(makeHarness("seed"), hooks, "task", {
      maxIterations: 1,
      noLog: true,
      historyLogPath: logPath,
    });
    expect(existsSync(logPath)).toBe(false);
  });
});

describe("runHarnessEvolutionLoop — callbacks", () => {
  it("calls onIteration after each record is appended", async () => {
    const seen: number[] = [];
    const { hooks } = makeScriptedHooks([{ score: 1 }, { score: 2 }, { score: 3 }]);
    await runHarnessEvolutionLoop(makeHarness("seed"), hooks, "task", {
      maxIterations: 3,
      noLog: true,
      onIteration: (entry) => seen.push(entry.iteration),
    });
    expect(seen).toEqual([1, 2, 3]);
  });

  it("uses injected clock", async () => {
    const { hooks } = makeScriptedHooks([{ score: 1 }]);
    const result = await runHarnessEvolutionLoop(makeHarness("seed"), hooks, "task", {
      maxIterations: 1,
      noLog: true,
      now: () => "2026-05-13T10:00:00.000Z",
    });
    expect(result.history[0]!.capturedAt).toBe("2026-05-13T10:00:00.000Z");
  });
});

describe("formatEvolutionResult", () => {
  it("includes termination reason and per-iteration lines", async () => {
    const { hooks } = makeScriptedHooks([{ score: 1, passed: true }]);
    const result = await runHarnessEvolutionLoop(makeHarness("seed"), hooks, "task", {
      maxIterations: 3,
      noLog: true,
    });
    const out = formatEvolutionResult(result);
    expect(out).toContain("converged");
    expect(out).toContain("k=1");
  });

  it("marks the best iteration with a star", async () => {
    const { hooks } = makeScriptedHooks([{ score: 5 }, { score: 1 }]);
    const result = await runHarnessEvolutionLoop(makeHarness("seed"), hooks, "task", {
      maxIterations: 2,
      noLog: true,
    });
    const out = formatEvolutionResult(result);
    expect(out).toContain("★ k=1");
  });
});

describe("resultToPayload", () => {
  it("emits stable shape", async () => {
    const { hooks } = makeScriptedHooks([{ score: 5, passed: true }]);
    const result = await runHarnessEvolutionLoop(makeHarness("seed"), hooks, "task", {
      maxIterations: 1,
      noLog: true,
    });
    const p = resultToPayload(result);
    expect(p.kind).toBe("harness_evolution.result_recorded");
    expect(p.terminationReason).toBe("converged");
    expect(p.bestPassed).toBe(true);
  });
});
