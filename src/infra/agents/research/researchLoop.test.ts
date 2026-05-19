import { describe, it, expect } from "bun:test";
import {
  isResearchLoopEnabled,
  evaluateResearchLoop,
  researchLoopToPayload,
  RESEARCH_LOOP_FLAG_ENV,
  type Experiment,
} from "./researchLoop.ts";

describe("isResearchLoopEnabled", () => {
  it("respects the flag", () => {
    expect(isResearchLoopEnabled({})).toBe(false);
    expect(isResearchLoopEnabled({ [RESEARCH_LOOP_FLAG_ENV]: "1" })).toBe(true);
  });
});

function exp(
  id: string,
  parentId: string | null,
  score: number,
  family: string,
  status: Experiment["status"] = "candidate",
  timestamp = 0,
): Experiment {
  return { id, parentId, hypothesis: `h-${id}`, score, family, timestamp, status };
}

describe("evaluateResearchLoop — first experiment", () => {
  it("positive score with no prior baseline → keep", () => {
    const candidate = exp("e1", null, 0.8, "momentum");
    const r = evaluateResearchLoop({ experiments: [], candidate });
    expect(r.decision).toBe("keep");
    expect(r.baseline?.id).toBe("e1");
  });

  it("negative score with no prior baseline → revert", () => {
    const candidate = exp("e1", null, -0.2, "momentum");
    const r = evaluateResearchLoop({ experiments: [], candidate });
    expect(r.decision).toBe("revert");
    expect(r.baseline).toBeNull();
  });
});

describe("evaluateResearchLoop — keep vs revert decision", () => {
  it("improvement over baseline → keep", () => {
    const experiments: Experiment[] = [exp("b1", null, 0.5, "momentum", "kept")];
    const candidate = exp("e2", "b1", 0.7, "momentum");
    const r = evaluateResearchLoop({ experiments, candidate });
    expect(r.decision).toBe("keep");
    expect(r.scoreDelta).toBeCloseTo(0.2, 5);
    expect(r.baseline?.id).toBe("e2");
  });

  it("worse than baseline → revert; baseline unchanged", () => {
    const experiments: Experiment[] = [exp("b1", null, 0.5, "momentum", "kept")];
    const candidate = exp("e2", "b1", 0.3, "momentum");
    const r = evaluateResearchLoop({ experiments, candidate });
    expect(r.decision).toBe("revert");
    expect(r.baseline?.id).toBe("b1");
  });

  it("equal to baseline → revert (default threshold)", () => {
    const experiments: Experiment[] = [exp("b1", null, 0.5, "momentum", "kept")];
    const candidate = exp("e2", "b1", 0.5, "momentum");
    const r = evaluateResearchLoop({ experiments, candidate });
    expect(r.decision).toBe("revert");
  });

  it("custom threshold raises the bar", () => {
    const experiments: Experiment[] = [exp("b1", null, 0.5, "momentum", "kept")];
    const candidate = exp("e2", "b1", 0.55, "momentum");
    const r = evaluateResearchLoop({ experiments, candidate, keepThreshold: 0.1 });
    expect(r.decision).toBe("revert");
  });

  it("errored candidate → investigate", () => {
    const experiments: Experiment[] = [exp("b1", null, 0.5, "momentum", "kept")];
    const candidate = exp("e2", "b1", Number.NaN, "momentum", "errored");
    const r = evaluateResearchLoop({ experiments, candidate });
    expect(r.decision).toBe("investigate");
  });
});

describe("evaluateResearchLoop — curated history", () => {
  it("top kept is sorted by score descending", () => {
    const experiments: Experiment[] = [
      exp("a", null, 0.3, "momentum", "kept"),
      exp("b", "a", 0.8, "momentum", "kept"),
      exp("c", "b", 0.5, "mean-reversion", "kept"),
    ];
    const candidate = exp("d", "b", 0.9, "breakout");
    const r = evaluateResearchLoop({ experiments, candidate });
    expect(r.curated.topKept[0]?.id).toBe("d");
    expect(r.curated.topKept[1]?.id).toBe("b");
  });

  it("bestByFamily picks the best kept-status entry in each family", () => {
    // Keep/revert is vs the GLOBAL best baseline (b at 0.8), not per-family.
    // Candidate d (mean-reversion, 0.6) loses to b → reverted → mean-reversion
    // family champion remains c (kept, 0.5). Per-family curation only counts
    // kept-status experiments.
    const experiments: Experiment[] = [
      exp("a", null, 0.3, "momentum", "kept"),
      exp("b", "a", 0.8, "momentum", "kept"),
      exp("c", null, 0.5, "mean-reversion", "kept"),
    ];
    const candidate = exp("d", null, 0.6, "mean-reversion");
    const r = evaluateResearchLoop({ experiments, candidate });
    expect(r.curated.bestByFamily["momentum"]?.id).toBe("b");
    expect(r.curated.bestByFamily["mean-reversion"]?.id).toBe("c");
  });

  it("bestByFamily updates when candidate is kept (beats global baseline)", () => {
    const experiments: Experiment[] = [
      exp("a", null, 0.3, "momentum", "kept"),
      exp("b", "a", 0.4, "mean-reversion", "kept"),
    ];
    const candidate = exp("c", "b", 0.9, "mean-reversion");
    const r = evaluateResearchLoop({ experiments, candidate });
    expect(r.decision).toBe("keep");
    expect(r.curated.bestByFamily["mean-reversion"]?.id).toBe("c");
  });

  it("close misses surface near-baseline reverts", () => {
    const experiments: Experiment[] = [
      exp("a", null, 1.0, "momentum", "kept"),
      exp("b", "a", 0.95, "breakout", "reverted"),
    ];
    const candidate = exp("c", "a", 0.5, "mean-reversion");
    const r = evaluateResearchLoop({ experiments, candidate });
    expect(r.curated.closeMisses.some((e) => e.id === "b")).toBe(true);
  });
});

describe("evaluateResearchLoop — diversity steering", () => {
  it("recent window dominated by one family → diversity hint fires", () => {
    const experiments: Experiment[] = [
      exp("a", null, 0.3, "momentum", "kept"),
      exp("b", "a", 0.4, "momentum", "kept"),
      exp("c", "b", 0.35, "momentum", "reverted"),
      exp("d", "b", 0.5, "momentum", "kept"),
      exp("e", "d", 0.45, "mean-reversion", "kept"),
      exp("f", "d", 0.55, "momentum", "kept"),
    ];
    const candidate = exp("g", "f", 0.6, "momentum");
    const r = evaluateResearchLoop({ experiments, candidate });
    expect(r.diversityHint).not.toBeNull();
    expect(r.diversityHint?.dominantFamily).toBe("momentum");
    expect(r.diversityHint?.saturation).toBeGreaterThan(0.5);
  });

  it("balanced families → no diversity hint", () => {
    const experiments: Experiment[] = [
      exp("a", null, 0.3, "momentum", "kept"),
      exp("b", "a", 0.4, "mean-reversion", "kept"),
      exp("c", "b", 0.35, "breakout", "reverted"),
      exp("d", "b", 0.5, "vol-targeting", "kept"),
      exp("e", "d", 0.45, "momentum", "kept"),
    ];
    const candidate = exp("f", "d", 0.55, "mean-reversion");
    const r = evaluateResearchLoop({ experiments, candidate });
    expect(r.diversityHint).toBeNull();
  });
});

describe("researchLoopToPayload", () => {
  it("emits stable shape", () => {
    const candidate = exp("e1", null, 0.8, "momentum");
    const r = evaluateResearchLoop({ experiments: [], candidate });
    const p = researchLoopToPayload(r) as { kind: string; decision: string };
    expect(p.kind).toBe("research_loop.evaluated");
    expect(["keep", "revert", "investigate"]).toContain(p.decision);
  });
});
