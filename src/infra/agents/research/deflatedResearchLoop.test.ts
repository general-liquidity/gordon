import { describe, expect, it } from "bun:test";
import {
  defaultDeflatedScore,
  pairwiseCorrelation,
  runDeflatedResearchLoop,
  type Candidate,
  type Hypothesis,
  type ResearchLoopDeps,
  type ScoreResult,
} from "./deflatedResearchLoop.ts";

// ---------------------------------------------------------------------------
// Synthetic data helpers (deterministic LCG — no real RNG, no I/O)
// ---------------------------------------------------------------------------

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (1103515245 * s + 12345) >>> 0;
    return s / 0xffffffff;
  };
}

function noiseReturns(n: number, seed: number): number[] {
  const rng = lcg(seed);
  return Array.from({ length: n }, () => (rng() - 0.5) * 0.04);
}

function signalReturns(n: number, mu: number, sd: number, seed: number): number[] {
  const rng = lcg(seed);
  return Array.from({ length: n }, () => mu + (rng() - 0.5) * sd);
}

function hyp(id: string): Hypothesis {
  return { id, description: `hypothesis ${id}` };
}

/**
 * Builds deps from a fixed list of candidates. `generate` walks the list in
 * order; `backtest` returns the prepared candidate; `score` is injected by the
 * test so the loop's gating logic — not the DSR math — is under test.
 */
function depsFromCandidates(
  candidates: Candidate[],
  score: ResearchLoopDeps["score"],
): { deps: ResearchLoopDeps; generated: string[]; trialCounts: number[] } {
  let i = 0;
  const generated: string[] = [];
  const trialCounts: number[] = [];
  const deps: ResearchLoopDeps = {
    generate: () => {
      const c = candidates[Math.min(i, candidates.length - 1)]!;
      generated.push(c.hypothesis.id);
      return c.hypothesis;
    },
    backtest: () => candidates[Math.min(i++, candidates.length - 1)]!,
    score: (oos, totalTrials) => {
      trialCounts.push(totalTrials);
      return score(oos, totalTrials);
    },
  };
  return { deps, generated, trialCounts };
}

describe("pairwiseCorrelation", () => {
  it("is 1 for identical series and ~-1 for inverted", () => {
    const a = [1, 2, 3, 4, 5];
    expect(pairwiseCorrelation(a, a)).toBeCloseTo(1, 6);
    expect(pairwiseCorrelation(a, a.map((x) => -x))).toBeCloseTo(-1, 6);
  });

  it("returns 0 (safe default) for no variance or no overlap", () => {
    expect(pairwiseCorrelation([1, 1, 1], [2, 3, 4])).toBe(0);
    expect(pairwiseCorrelation([1], [2])).toBe(0);
  });
});

describe("runDeflatedResearchLoop — anti-overfit (the differentiator)", () => {
  it("approves 0 candidates from a stream of pure noise, even with high in-sample Sharpe", async () => {
    // 30 noise candidates that each LOOK good in-sample. A naive in-sample
    // gate would approve many; the deflation gate (modeled here as: rises with
    // trial count) approves none.
    const candidates: Candidate[] = Array.from({ length: 30 }, (_, k) => ({
      hypothesis: hyp(`noise-${k}`),
      oosReturns: noiseReturns(252, 1000 + k),
    }));

    // Synthetic deflation-aware score: noise produces a decent-looking
    // in-sample Sharpe (~1.2) — enough to fool a naive in-sample gate — but the
    // deflation bar (the expected max Sharpe under the null, ~sqrt(2·ln N))
    // already exceeds it at the very first trial and only rises as we mine.
    // Pure noise never clears it.
    const score: ResearchLoopDeps["score"] = (_oos, totalTrials): ScoreResult => {
      const inSampleSharpe = 1.0; // attractive but not real
      const deflationBar = Math.sqrt(2 * Math.log(totalTrials + 1));
      return { sharpe: inSampleSharpe, deflatedSignificant: inSampleSharpe > deflationBar };
    };

    const { deps } = depsFromCandidates(candidates, score);
    const result = await runDeflatedResearchLoop(deps, {
      targetApproved: 3,
      maxIterations: 30,
    });

    expect(result.approved.length).toBe(0);
    expect(result.rejected.every((r) => r.reason === "deflation")).toBe(true);
    expect(result.stopReason).toBe("max_iterations");
    expect(result.trials).toBe(30);
  });

  it("pure-noise rejection holds with the REAL deflatedSharpeRatio via defaultDeflatedScore", async () => {
    const candidates: Candidate[] = Array.from({ length: 20 }, (_, k) => ({
      hypothesis: hyp(`rawnoise-${k}`),
      oosReturns: noiseReturns(252, 5000 + k),
    }));
    const { deps } = depsFromCandidates(candidates, defaultDeflatedScore(252));
    const result = await runDeflatedResearchLoop(deps, {
      targetApproved: 3,
      maxIterations: 20,
    });
    expect(result.approved.length).toBe(0);
  });
});

describe("runDeflatedResearchLoop — genuine signal", () => {
  it("approves candidates that carry stable positive OOS signal", async () => {
    // Mostly noise, with a few genuinely strong-and-stable candidates seeded in.
    const candidates: Candidate[] = [];
    for (let k = 0; k < 12; k++) {
      const isSignal = k === 2 || k === 5 || k === 9;
      candidates.push({
        hypothesis: hyp(isSignal ? `signal-${k}` : `noise-${k}`),
        oosReturns: isSignal
          ? signalReturns(252, 0.01, 0.006, 200 + k) // high, stable mean
          : noiseReturns(252, 200 + k),
      });
    }

    // Deflation-aware synthetic score: a high stable mean clears the bar; noise
    // does not. (Uses the candidate's own mean/std so the loop is exercised over
    // realistic per-candidate inputs.)
    const score: ResearchLoopDeps["score"] = (oos, totalTrials): ScoreResult => {
      const m = oos.reduce((a, b) => a + b, 0) / oos.length;
      const sd =
        Math.sqrt(oos.reduce((a, b) => a + (b - m) ** 2, 0) / oos.length) || 1e-9;
      const sharpe = (m / sd) * Math.sqrt(252);
      const bar = Math.sqrt(2 * Math.log(totalTrials + 1)) * 1.0; // rises with trials
      return { sharpe, deflatedSignificant: sharpe > bar };
    };

    const { deps } = depsFromCandidates(candidates, score);
    const result = await runDeflatedResearchLoop(deps, {
      targetApproved: 3,
      maxIterations: 12,
    });

    expect(result.approved.length).toBe(3);
    expect(result.approved.every((c) => c.hypothesis.id.startsWith("signal-"))).toBe(
      true,
    );
    expect(result.stopReason).toBe("target_reached");
  });
});

describe("runDeflatedResearchLoop — correlation de-duplication", () => {
  it("rejects a duplicate of an already-approved candidate", async () => {
    const winner = signalReturns(252, 0.01, 0.006, 42);
    const duplicate = winner.map((x) => x + 1e-9); // ~identical edge
    const distinct = signalReturns(252, 0.01, 0.006, 777); // different draw

    const candidates: Candidate[] = [
      { hypothesis: hyp("first"), oosReturns: winner },
      { hypothesis: hyp("dup"), oosReturns: duplicate },
      { hypothesis: hyp("distinct"), oosReturns: distinct },
    ];

    // Every candidate is "significant + positive" so ONLY the correlation
    // filter can reject — isolating the de-dup behavior.
    const score: ResearchLoopDeps["score"] = (): ScoreResult => ({
      sharpe: 2.5,
      deflatedSignificant: true,
    });

    const { deps } = depsFromCandidates(candidates, score);
    const result = await runDeflatedResearchLoop(deps, {
      targetApproved: 3,
      maxIterations: 3,
      maxCorrelation: 0.9,
    });

    expect(result.approved.map((c) => c.hypothesis.id)).toEqual(["first", "distinct"]);
    expect(result.rejected.length).toBe(1);
    expect(result.rejected[0]!.candidate!.hypothesis.id).toBe("dup");
    expect(result.rejected[0]!.reason).toBe("correlated");
  });
});

describe("runDeflatedResearchLoop — termination & trial accounting", () => {
  it("terminates at targetApproved", async () => {
    const candidates: Candidate[] = Array.from({ length: 20 }, (_, k) => ({
      hypothesis: hyp(`c-${k}`),
      oosReturns: signalReturns(252, 0.01, 0.006, k),
    }));
    const score: ResearchLoopDeps["score"] = (): ScoreResult => ({
      sharpe: 2,
      deflatedSignificant: true,
    });
    const { deps } = depsFromCandidates(candidates, score);
    const result = await runDeflatedResearchLoop(deps, {
      targetApproved: 2,
      maxIterations: 20,
    });
    expect(result.approved.length).toBe(2);
    expect(result.stopReason).toBe("target_reached");
    expect(result.iterations).toBe(2);
  });

  it("terminates at maxIterations when target is unreachable", async () => {
    const candidates: Candidate[] = Array.from({ length: 5 }, (_, k) => ({
      hypothesis: hyp(`c-${k}`),
      oosReturns: noiseReturns(252, k),
    }));
    const score: ResearchLoopDeps["score"] = (): ScoreResult => ({
      sharpe: 0.1,
      deflatedSignificant: false,
    });
    const { deps } = depsFromCandidates(candidates, score);
    const result = await runDeflatedResearchLoop(deps, {
      targetApproved: 99,
      maxIterations: 5,
    });
    expect(result.approved.length).toBe(0);
    expect(result.iterations).toBe(5);
    expect(result.stopReason).toBe("max_iterations");
  });

  it("accumulates trials monotonically across ALL candidates (the honest correction)", async () => {
    const candidates: Candidate[] = Array.from({ length: 8 }, (_, k) => ({
      hypothesis: hyp(`c-${k}`),
      oosReturns: noiseReturns(252, 9000 + k),
    }));
    const score: ResearchLoopDeps["score"] = (): ScoreResult => ({
      sharpe: 0.5,
      deflatedSignificant: false, // never approve → run all iterations
    });
    const { deps, trialCounts } = depsFromCandidates(candidates, score);
    const result = await runDeflatedResearchLoop(deps, {
      targetApproved: 10,
      maxIterations: 8,
    });

    // The trial count handed to score is strictly increasing and never reset:
    // 1,2,3,...,8 — proving deflation is applied against the cumulative count.
    expect(trialCounts).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(result.trials).toBe(8);
    for (let i = 1; i < trialCounts.length; i++) {
      expect(trialCounts[i]).toBe(trialCounts[i - 1]! + 1);
    }
  });

  it("rejects candidates below minTrades before scoring deflation", async () => {
    const candidates: Candidate[] = [
      { hypothesis: hyp("short"), oosReturns: noiseReturns(5, 1) },
      { hypothesis: hyp("ok"), oosReturns: signalReturns(252, 0.01, 0.006, 2) },
    ];
    const score: ResearchLoopDeps["score"] = (): ScoreResult => ({
      sharpe: 2,
      deflatedSignificant: true,
    });
    const { deps } = depsFromCandidates(candidates, score);
    const result = await runDeflatedResearchLoop(deps, {
      targetApproved: 1,
      maxIterations: 2,
      minTrades: 30,
    });
    expect(result.rejected[0]!.reason).toBe("insufficient_trades");
    expect(result.approved.map((c) => c.hypothesis.id)).toEqual(["ok"]);
  });
});

describe("runDeflatedResearchLoop — failure-pattern memory feeds generate", () => {
  it("passes accumulating approved/rejected memory into generate", async () => {
    let i = 0;
    const seenTrials: number[] = [];
    const seenRejections: number[] = [];
    const deps: ResearchLoopDeps = {
      generate: (memory) => {
        seenTrials.push(memory.trials);
        seenRejections.push(memory.rejected.length);
        return hyp(`c-${i}`);
      },
      backtest: () => ({
        hypothesis: hyp(`c-${i++}`),
        oosReturns: noiseReturns(252, i),
      }),
      score: () => ({ sharpe: 0.1, deflatedSignificant: false }),
    };

    await runDeflatedResearchLoop(deps, { targetApproved: 9, maxIterations: 4 });

    // generate is called once per iteration, observing memory BEFORE its own
    // backtest increments the counter. Trials and rejections accumulate: the
    // failure-pattern memory grows each round and is handed forward.
    expect(seenTrials).toEqual([0, 1, 2, 3]);
    expect(seenRejections).toEqual([0, 1, 2, 3]);
  });
});

// ============================================================================
// Trial accounting for failed backtests (Tier-0 Group B, item 4)
// ============================================================================

describe("runDeflatedResearchLoop: a failed backtest still consumes a trial", () => {
  it("counts a throwing backtest and keeps searching", async () => {
    const seen: number[] = [];
    const result = await runDeflatedResearchLoop(
      {
        generate: (memory) => ({ id: `h${memory.iterations}`, description: "h" }),
        backtest: (hypothesis) => {
          if (hypothesis.id === "h2") throw new Error("no historical data");
          return { hypothesis, oosReturns: [0.01, 0.02, 0.015] };
        },
        score: (_returns, totalTrials) => {
          seen.push(totalTrials);
          return { sharpe: 1.5, deflatedSignificant: false };
        },
      },
      { targetApproved: 5, maxIterations: 4 },
    );

    // Before the fix the throw escaped the loop entirely: it propagated out of
    // runDeflatedResearchLoop before `trials++`, so the trial was invisible AND
    // the caller lost the accumulated count.
    expect(result.trials).toBe(4);
    expect(result.iterations).toBe(4);

    const failed = result.rejected.filter((r) => r.reason === "backtest_failed");
    expect(failed.length).toBe(1);
    expect(failed[0]!.candidate).toBeNull();
    expect(failed[0]!.trialsAtScore).toBe(2);

    // The failed trial is baked into the bar every LATER candidate is scored
    // against: the scorer sees 1, then 3, 4, never a reused 2.
    expect(seen).toEqual([1, 3, 4]);
  });

  it("does not reuse the trial number consumed by a failed backtest", async () => {
    const result = await runDeflatedResearchLoop(
      {
        generate: (memory) => ({ id: `h${memory.iterations}`, description: "h" }),
        backtest: () => {
          throw new Error("always fails");
        },
        score: () => ({ sharpe: 0, deflatedSignificant: false }),
      },
      { targetApproved: 1, maxIterations: 3 },
    );

    expect(result.trials).toBe(3);
    expect(result.approved).toHaveLength(0);
    expect(result.rejected).toHaveLength(3);
    expect(result.rejected.map((r) => r.trialsAtScore)).toEqual([1, 2, 3]);
  });
});
