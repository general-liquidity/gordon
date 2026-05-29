import { describe, expect, test } from "bun:test";
import {
  DEFAULT_MIN_FITNESS_DROP,
  deriveRejectedMutations,
  filterRejectedMutations,
  matchRejection,
  mutationDirection,
} from "./mutationRejection.ts";
import type { Genome, Mutation } from "./types.ts";

let mutCounter = 0;
function mut(
  fieldPath: string,
  from: unknown,
  to: unknown,
  type: Mutation["mutation_type"] = "nudge",
): Mutation {
  mutCounter += 1;
  return {
    mutation_id: `00000000-0000-0000-0000-${String(mutCounter).padStart(12, "0")}`,
    field_path: fieldPath,
    parameter_name: fieldPath,
    from_value: from,
    to_value: to,
    mutation_type: type,
    reason: "test",
    suggested_by: "test",
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

function genome(
  id: string,
  fitness: number | undefined,
  opts: { parent?: string; mutations?: Mutation[]; generation?: number } = {},
): Genome {
  return {
    genome_id: id,
    playbook_name: "test-playbook",
    parent_genome_id: opts.parent,
    generation: opts.generation ?? 0,
    mutations_from_parent: opts.mutations ?? [],
    status: "candidate",
    paper_trades: 0,
    paper_pnl: 0,
    live_trades: 0,
    live_pnl: 0,
    fitness_score: fitness,
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

describe("mutationDirection", () => {
  test("numeric nudge up / down / change", () => {
    expect(mutationDirection(mut("a", 10, 20))).toBe("up");
    expect(mutationDirection(mut("a", 20, 10))).toBe("down");
    expect(mutationDirection(mut("a", 10, 10))).toBe("change");
  });
  test("structural types pass through", () => {
    expect(mutationDirection(mut("a", "x", "y", "swap"))).toBe("swap");
    expect(mutationDirection(mut("a", null, "y", "add"))).toBe("add");
    expect(mutationDirection(mut("a", "y", null, "remove"))).toBe("remove");
  });
  test("non-numeric nudge → change", () => {
    expect(mutationDirection(mut("a", "lo", "hi", "nudge"))).toBe("change");
  });
});

describe("deriveRejectedMutations — basic regression", () => {
  test("a single material regression is rejected", () => {
    const genomes = [
      genome("p", 60),
      genome("c", 50, { parent: "p", mutations: [mut("entry.confluence_required", 2, 3)] }),
    ];
    const rejections = deriveRejectedMutations(genomes);
    expect(rejections.length).toBe(1);
    expect(rejections[0]!.fieldPath).toBe("entry.confluence_required");
    expect(rejections[0]!.direction).toBe("up");
    expect(rejections[0]!.netFitnessDrop).toBeCloseTo(10, 5);
  });

  test("a regression below the threshold is not rejected", () => {
    const genomes = [
      genome("p", 60),
      genome("c", 59.5, { parent: "p", mutations: [mut("exit.stop_loss.value", 2, 3)] }),
    ];
    expect(deriveRejectedMutations(genomes, { minFitnessDrop: 1.0 })).toEqual([]);
  });

  test("a beneficial mutation (fitness gain) is not rejected", () => {
    const genomes = [
      genome("p", 50),
      genome("c", 65, { parent: "p", mutations: [mut("entry.confluence_required", 3, 2)] }),
    ];
    expect(deriveRejectedMutations(genomes)).toEqual([]);
  });
});

describe("deriveRejectedMutations — net aggregation", () => {
  test("nets help against harm: a mutation that helped more than it hurt is kept", () => {
    // Same (field, up): one fork regressed 5, another gained 10 → net -5 (beneficial).
    const genomes = [
      genome("p1", 60),
      genome("c1", 55, { parent: "p1", mutations: [mut("x", 1, 2)] }), // drop +5
      genome("p2", 50),
      genome("c2", 60, { parent: "p2", mutations: [mut("x", 1, 2)] }), // drop -10
    ];
    expect(deriveRejectedMutations(genomes)).toEqual([]);
  });

  test("nets harm across forks: repeated regressions accumulate past threshold", () => {
    const genomes = [
      genome("p1", 60),
      genome("c1", 57, { parent: "p1", mutations: [mut("x", 1, 2)] }), // drop +3
      genome("p2", 50),
      genome("c2", 45, { parent: "p2", mutations: [mut("x", 1, 2)] }), // drop +5
    ];
    const r = deriveRejectedMutations(genomes);
    expect(r.length).toBe(1);
    expect(r[0]!.netFitnessDrop).toBeCloseTo(8, 5);
    expect(r[0]!.observations).toBe(2);
  });

  test("opposite directions are tracked separately", () => {
    const genomes = [
      genome("p1", 60),
      genome("c1", 50, { parent: "p1", mutations: [mut("x", 1, 2)] }), // up, drop +10
      genome("p2", 60),
      genome("c2", 80, { parent: "p2", mutations: [mut("x", 2, 1)] }), // down, gain
    ];
    const r = deriveRejectedMutations(genomes);
    expect(r.length).toBe(1);
    expect(r[0]!.direction).toBe("up");
  });
});

describe("deriveRejectedMutations — edge cases + ordering", () => {
  test("genomes without a parent in the set are skipped", () => {
    const genomes = [genome("c", 50, { parent: "missing", mutations: [mut("x", 1, 2)] })];
    expect(deriveRejectedMutations(genomes)).toEqual([]);
  });

  test("genomes missing fitness are skipped", () => {
    const genomes = [
      genome("p", undefined),
      genome("c", 50, { parent: "p", mutations: [mut("x", 1, 2)] }),
    ];
    expect(deriveRejectedMutations(genomes)).toEqual([]);
  });

  test("empty population → no rejections", () => {
    expect(deriveRejectedMutations([])).toEqual([]);
  });

  test("rejections are sorted by net drop descending", () => {
    const genomes = [
      genome("p", 100),
      genome("c1", 95, { parent: "p", mutations: [mut("small", 1, 2)] }), // drop 5
      genome("c2", 70, { parent: "p", mutations: [mut("big", 1, 2)] }), // drop 30
    ];
    const r = deriveRejectedMutations(genomes);
    expect(r.map((x) => x.fieldPath)).toEqual(["big", "small"]);
  });

  test("DEFAULT_MIN_FITNESS_DROP is exported and applied", () => {
    expect(DEFAULT_MIN_FITNESS_DROP).toBe(1.0);
  });
});

describe("matchRejection + filterRejectedMutations", () => {
  const rejections = deriveRejectedMutations([
    genome("p", 60),
    genome("c", 45, { parent: "p", mutations: [mut("entry.confluence_required", 2, 3)] }),
  ]);

  test("matches same field + same direction", () => {
    expect(matchRejection(mut("entry.confluence_required", 2, 4), rejections)).not.toBeNull();
  });

  test("does NOT match the opposite direction", () => {
    expect(matchRejection(mut("entry.confluence_required", 4, 2), rejections)).toBeNull();
  });

  test("does NOT match a different field", () => {
    expect(matchRejection(mut("exit.stop_loss.value", 2, 3), rejections)).toBeNull();
  });

  test("filter splits kept vs suppressed", () => {
    const candidates = [
      mut("entry.confluence_required", 2, 5), // suppressed (up, rejected)
      mut("entry.confluence_required", 5, 2), // kept (down)
      mut("exit.take_profit.0.level", 1, 2), // kept (different field)
    ];
    const { kept, suppressed } = filterRejectedMutations(candidates, rejections);
    expect(kept.length).toBe(2);
    expect(suppressed.length).toBe(1);
    expect(suppressed[0]!.rejection.fieldPath).toBe("entry.confluence_required");
  });
});
