import { describe, it, expect } from "bun:test";
import {
  computeParetoFrontier,
  dominates,
  weaklyDominates,
  paretoFrontierToPayload,
  type ParetoCandidate,
} from "./paretoFrontier.ts";

const dirs = { sharpe: "maximize", drawdown: "minimize" } as const;

function mk(id: string, sharpe: number, drawdown: number): ParetoCandidate {
  return { id, objectives: { sharpe, drawdown } };
}

describe("dominates — pairwise check", () => {
  it("A dominates B when A is better on all and strictly better on at least one", () => {
    const a = mk("A", 2.0, 5);
    const b = mk("B", 1.5, 7);
    expect(dominates(a, b, dirs)).toBe(true);
    expect(dominates(b, a, dirs)).toBe(false);
  });

  it("does NOT dominate when tied on every objective", () => {
    const a = mk("A", 2.0, 5);
    const b = mk("B", 2.0, 5);
    expect(dominates(a, b, dirs)).toBe(false);
    expect(dominates(b, a, dirs)).toBe(false);
  });

  it("does NOT dominate when worse on at least one objective", () => {
    const a = mk("A", 2.0, 5);
    const b = mk("B", 1.5, 4); // worse Sharpe, better drawdown → no dominance either way
    expect(dominates(a, b, dirs)).toBe(false);
    expect(dominates(b, a, dirs)).toBe(false);
  });

  it("dominates when better on one and tied on others", () => {
    const a = mk("A", 2.0, 5);
    const b = mk("B", 1.5, 5);
    expect(dominates(a, b, dirs)).toBe(true);
  });
});

describe("weaklyDominates", () => {
  it("identical → weakly dominates (both directions)", () => {
    const a = mk("A", 2.0, 5);
    const b = mk("B", 2.0, 5);
    expect(weaklyDominates(a, b, dirs)).toBe(true);
    expect(weaklyDominates(b, a, dirs)).toBe(true);
  });

  it("strictly better on all → weakly + strictly dominates", () => {
    const a = mk("A", 2.0, 4);
    const b = mk("B", 1.5, 5);
    expect(weaklyDominates(a, b, dirs)).toBe(true);
  });

  it("worse on at least one → does not weakly dominate", () => {
    const a = mk("A", 2.0, 6);
    const b = mk("B", 1.5, 5);
    expect(weaklyDominates(a, b, dirs)).toBe(false);
  });
});

describe("computeParetoFrontier — validation", () => {
  it("rejects empty candidates", () => {
    expect(() => computeParetoFrontier({ candidates: [], directions: dirs })).toThrow();
  });

  it("rejects empty directions", () => {
    expect(() =>
      computeParetoFrontier({
        candidates: [mk("A", 1, 1)],
        directions: {} as Record<string, "maximize">,
      }),
    ).toThrow();
  });

  it("rejects invalid direction value", () => {
    expect(() =>
      computeParetoFrontier({
        candidates: [mk("A", 1, 1)],
        directions: { sharpe: "bad" as never },
      }),
    ).toThrow();
  });

  it("rejects duplicate candidate ids", () => {
    expect(() =>
      computeParetoFrontier({
        candidates: [mk("A", 1, 1), mk("A", 2, 2)],
        directions: dirs,
      }),
    ).toThrow();
  });

  it("rejects empty candidate id", () => {
    expect(() =>
      computeParetoFrontier({
        candidates: [{ id: "", objectives: { sharpe: 1, drawdown: 1 } }],
        directions: dirs,
      }),
    ).toThrow();
  });

  it("rejects missing objective on a candidate", () => {
    expect(() =>
      computeParetoFrontier({
        candidates: [{ id: "A", objectives: { sharpe: 1 } }],
        directions: dirs,
      }),
    ).toThrow();
  });

  it("rejects non-finite objective value", () => {
    expect(() =>
      computeParetoFrontier({
        candidates: [{ id: "A", objectives: { sharpe: NaN, drawdown: 1 } }],
        directions: dirs,
      }),
    ).toThrow();
  });
});

describe("computeParetoFrontier — frontier computation", () => {
  it("single candidate → frontier = [that candidate]", () => {
    const r = computeParetoFrontier({
      candidates: [mk("A", 2, 5)],
      directions: dirs,
    });
    expect(r.nFrontier).toBe(1);
    expect(r.frontier[0]!.id).toBe("A");
    expect(r.dominated.length).toBe(0);
  });

  it("two candidates where A dominates B → frontier = [A]", () => {
    const r = computeParetoFrontier({
      candidates: [mk("A", 2, 5), mk("B", 1.5, 7)],
      directions: dirs,
    });
    expect(r.nFrontier).toBe(1);
    expect(r.frontier[0]!.id).toBe("A");
    expect(r.dominated.length).toBe(1);
    expect(r.dominated[0]!.id).toBe("B");
    expect(r.dominationMap.B).toEqual(["A"]);
    expect(r.dominationMap.A).toEqual([]);
  });

  it("identical objective vectors → both on frontier", () => {
    const r = computeParetoFrontier({
      candidates: [mk("A", 2, 5), mk("B", 2, 5)],
      directions: dirs,
    });
    expect(r.nFrontier).toBe(2);
    expect(new Set(r.frontier.map((c) => c.id))).toEqual(new Set(["A", "B"]));
  });

  it("classic tradeoff: each candidate is best at one objective → both on frontier", () => {
    const r = computeParetoFrontier({
      candidates: [
        mk("HighSharpe", 3, 15), // best Sharpe, worst drawdown
        mk("LowDrawdown", 1, 2), // worst Sharpe, best drawdown
      ],
      directions: dirs,
    });
    expect(r.nFrontier).toBe(2);
  });

  it("3-candidate mixed example", () => {
    // A: (3, 15) — high Sharpe, high DD → on frontier (no one beats Sharpe AND DD)
    // B: (1, 2)  — low Sharpe, low DD  → on frontier
    // C: (2, 10) — middle              → dominated by neither A nor B individually,
    //   but check: A dominates C? A.sharpe=3>2 ✓; A.dd=15 vs C.dd=10, A worse → no.
    //                 B dominates C? B.sharpe=1<2 → no.
    //   So C is also on the frontier.
    const r = computeParetoFrontier({
      candidates: [mk("A", 3, 15), mk("B", 1, 2), mk("C", 2, 10)],
      directions: dirs,
    });
    expect(r.nFrontier).toBe(3);
  });

  it("dominated-by-multiple is captured in dominationMap", () => {
    const r = computeParetoFrontier({
      candidates: [mk("Best", 3, 2), mk("Strong", 2.5, 3), mk("Weak", 1, 10)],
      directions: dirs,
    });
    // Best dominates Strong and Weak. Strong dominates Weak.
    expect(r.dominationMap.Weak!.sort()).toEqual(["Best", "Strong"]);
    expect(r.dominationMap.Strong).toEqual(["Best"]);
    expect(r.dominationMap.Best).toEqual([]);
    expect(r.nFrontier).toBe(1);
  });

  it("preserves metadata on output", () => {
    const candidates: ParetoCandidate[] = [
      { id: "A", objectives: { sharpe: 2, drawdown: 5 }, metadata: { strategy: "vcp" } },
    ];
    const r = computeParetoFrontier({ candidates, directions: dirs });
    expect(r.frontier[0]!.metadata).toEqual({ strategy: "vcp" });
  });
});

describe("computeParetoFrontier — many objectives", () => {
  it("works with 4 objectives", () => {
    const dirs4 = {
      sharpe: "maximize",
      drawdown: "minimize",
      capacity: "maximize",
      latency: "minimize",
    } as const;
    const r = computeParetoFrontier({
      candidates: [
        { id: "A", objectives: { sharpe: 2, drawdown: 5, capacity: 100, latency: 20 } },
        { id: "B", objectives: { sharpe: 1, drawdown: 6, capacity: 120, latency: 25 } },
        { id: "C", objectives: { sharpe: 3, drawdown: 4, capacity: 110, latency: 15 } }, // strictly better than A on all 4
      ],
      directions: dirs4,
    });
    // C dominates A on all 4 (sharpe 3>2, dd 4<5, cap 110>100, lat 15<20).
    // C vs B: C better on sharpe/drawdown/latency, worse on capacity (110<120) → no dominance.
    // A vs B: A better on sharpe/drawdown/latency, worse on capacity → no dominance.
    expect(r.dominationMap.A).toEqual(["C"]);
    expect(r.dominationMap.C).toEqual([]);
    expect(r.nFrontier).toBe(2);
    expect(new Set(r.frontier.map((c) => c.id))).toEqual(new Set(["B", "C"]));
  });
});

describe("paretoFrontierToPayload", () => {
  it("emits stable shape", () => {
    const r = computeParetoFrontier({
      candidates: [mk("A", 2, 5), mk("B", 1.5, 7)],
      directions: dirs,
    });
    const p = paretoFrontierToPayload(r) as {
      kind: string;
      nCandidates: number;
      nFrontier: number;
      frontierIds: string[];
    };
    expect(p.kind).toBe("pareto_frontier.computed");
    expect(p.nCandidates).toBe(2);
    expect(p.nFrontier).toBe(1);
    expect(p.frontierIds).toEqual(["A"]);
  });
});
