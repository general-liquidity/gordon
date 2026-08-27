import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEdgeSpec } from "./parser.ts";
import { loadEdgeSpecs, loadLiveEdges } from "./loader.ts";
import {
  composeHealth,
  evaluateCondition,
  evaluateEdgeInvariants,
  type EdgeMetrics,
} from "./monitor.ts";

const FIXTURE = `---
name: test-fade
strategy: mean-reversion
status: verified
regime: [ranging, chop]
instruments: [BTC/USDT, ETH/USDT]
---

## Hypothesis

Trapped breakout buyers exit into the fade.

## Invariants

| id | metric | comparator | threshold | description |
|---|---|---|---|---|
| ev-net-positive | netEdgeBps | > | 0 | Survives round-trip cost |
| regime-ranging | regime | in | ranging,chop | Range-bound only |
| liquidity-floor | avgVol1mUsd | >= | 100000 | Enough depth |

## Kill Conditions

| id | metric | comparator | threshold | description |
|---|---|---|---|---|
| regime-flip | regime | not-in | ranging,chop | Regime left the range |
| winrate-broke | winRate | < | 0.45 | Win rate below break-even |

## Verification

bar-permutation p < 0.05, walk-forward PBO < 0.5.
`;

describe("parseEdgeSpec", () => {
  const spec = parseEdgeSpec(FIXTURE);

  it("parses frontmatter scalars and lists", () => {
    expect(spec.name).toBe("test-fade");
    expect(spec.strategy).toBe("mean-reversion");
    expect(spec.status).toBe("verified");
    expect(spec.regime).toEqual(["ranging", "chop"]);
    expect(spec.instruments).toEqual(["BTC/USDT", "ETH/USDT"]);
  });

  it("parses the hypothesis and verification prose", () => {
    expect(spec.hypothesis).toContain("Trapped breakout buyers");
    expect(spec.verification).toContain("bar-permutation");
  });

  it("parses the invariant table, skipping header and separator rows", () => {
    expect(spec.invariants).toHaveLength(3);
    const ev = spec.invariants.find((i) => i.id === "ev-net-positive")!;
    expect(ev.metric).toBe("netEdgeBps");
    expect(ev.comparator).toBe(">");
    expect(ev.threshold).toBe(0);
  });

  it("parses in/not-in thresholds as string arrays", () => {
    const regime = spec.invariants.find((i) => i.id === "regime-ranging")!;
    expect(regime.comparator).toBe("in");
    expect(regime.threshold).toEqual(["ranging", "chop"]);
  });

  it("parses kill conditions separately from invariants", () => {
    expect(spec.killConditions).toHaveLength(2);
    expect(spec.killConditions.map((k) => k.id)).toEqual(["regime-flip", "winrate-broke"]);
  });

  it("defaults status to proposed when absent/invalid", () => {
    expect(parseEdgeSpec("## Hypothesis\nx").status).toBe("proposed");
  });
});

describe("evaluateCondition", () => {
  const metrics: EdgeMetrics = {
    netEdgeBps: 5,
    regime: "ranging",
    winRate: 0.52,
    avgVol1mUsd: 250000,
  };

  it("evaluates numeric comparators", () => {
    expect(
      evaluateCondition(
        { id: "a", metric: "netEdgeBps", comparator: ">", threshold: 0, description: "" },
        metrics,
      ).satisfied,
    ).toBe(true);
    expect(
      evaluateCondition(
        { id: "a", metric: "netEdgeBps", comparator: "<=", threshold: 0, description: "" },
        metrics,
      ).satisfied,
    ).toBe(false);
  });

  it("evaluates in / not-in against string arrays", () => {
    expect(
      evaluateCondition(
        {
          id: "a",
          metric: "regime",
          comparator: "in",
          threshold: ["ranging", "chop"],
          description: "",
        },
        metrics,
      ).satisfied,
    ).toBe(true);
    expect(
      evaluateCondition(
        {
          id: "a",
          metric: "regime",
          comparator: "not-in",
          threshold: ["ranging", "chop"],
          description: "",
        },
        metrics,
      ).satisfied,
    ).toBe(false);
  });

  it("treats a missing metric as not-satisfied", () => {
    const check = evaluateCondition(
      { id: "a", metric: "absent", comparator: ">", threshold: 0, description: "" },
      metrics,
    );
    expect(check.satisfied).toBe(false);
    expect(check.value).toBeUndefined();
  });
});

describe("evaluateEdgeInvariants", () => {
  const spec = parseEdgeSpec(FIXTURE);

  it("is stable when all invariants hold and no kill fires", () => {
    const r = evaluateEdgeInvariants(spec, {
      netEdgeBps: 5,
      regime: "ranging",
      avgVol1mUsd: 250000,
      winRate: 0.55,
    });
    expect(r.health).toBe("stable");
    expect(r.violatedInvariants).toHaveLength(0);
    expect(r.firedKills).toHaveLength(0);
  });

  it("is degraded when an invariant is violated but no kill fires", () => {
    const r = evaluateEdgeInvariants(spec, {
      netEdgeBps: -2,
      regime: "ranging",
      avgVol1mUsd: 250000,
      winRate: 0.55,
    });
    expect(r.health).toBe("degraded");
    expect(r.violatedInvariants.map((c) => c.invariant.id)).toContain("ev-net-positive");
  });

  it("retires when a kill condition fires, taking precedence over invariant violations", () => {
    const r = evaluateEdgeInvariants(spec, {
      netEdgeBps: -2,
      regime: "trending",
      avgVol1mUsd: 250000,
      winRate: 0.3,
    });
    expect(r.health).toBe("retire");
    expect(r.firedKills.map((c) => c.invariant.id)).toEqual(
      expect.arrayContaining(["regime-flip", "winrate-broke"]),
    );
  });

  it("fails safe on missing data: absent invariant metric degrades, absent kill metric does not fire", () => {
    const r = evaluateEdgeInvariants(spec, { regime: "ranging" });
    expect(r.health).toBe("degraded");
    expect(r.firedKills).toHaveLength(0);
  });
});

describe("composeHealth", () => {
  it("returns the more severe of two verdicts", () => {
    expect(composeHealth("stable", "degraded")).toBe("degraded");
    expect(composeHealth("degraded", "retire")).toBe("retire");
    expect(composeHealth("stable", "stable")).toBe("stable");
    expect(composeHealth("retire", "degraded")).toBe("retire");
  });
});

describe("loadEdgeSpecs", () => {
  it("discovers the builtin edge from disk", () => {
    const specs = loadEdgeSpecs();
    expect(specs.find((s) => s.name === "mean-reversion-fade")).toBeDefined();
  });

  it("loadLiveEdges excludes the builtin example until it is promoted to live", () => {
    // The committed example ships as status: verified — a dormant template, not
    // a deployed edge — so the live-edge monitor must not pick it up by default.
    expect(loadLiveEdges().find((s) => s.name === "mean-reversion-fade")).toBeUndefined();
  });
});

describe("builtin mean-reversion.edge.md", () => {
  it("parses the committed example without drift", () => {
    const md = readFileSync(join(import.meta.dir, "builtin", "mean-reversion.edge.md"), "utf8");
    const spec = parseEdgeSpec(md);
    expect(spec.name).toBe("mean-reversion-fade");
    expect(spec.strategy).toBe("mean-reversion");
    expect(spec.invariants.length).toBeGreaterThanOrEqual(4);
    expect(spec.killConditions.length).toBeGreaterThanOrEqual(4);
    for (const inv of [...spec.invariants, ...spec.killConditions]) {
      expect(inv.id).not.toBe("");
      expect(inv.metric).not.toBe("");
    }
  });
});

describe("builtin turn-of-month-spy.edge.md", () => {
  it("parses the seasonal example and shows EDD generalizes past microstructure", () => {
    const md = readFileSync(join(import.meta.dir, "builtin", "turn-of-month-spy.edge.md"), "utf8");
    const spec = parseEdgeSpec(md);
    expect(spec.name).toBe("turn-of-month-spy");
    expect(spec.instruments).toEqual(["SPY"]);
    // The falsifiable core is a calendar segment, not an orderflow signal.
    expect(spec.invariants.find((i) => i.metric === "tomEffectTStat")).toBeDefined();
    expect(spec.killConditions.find((k) => k.metric === "tomEffectPValue")).toBeDefined();
    // It still carries the ledger-derived invariants the live monitor evaluates.
    expect(spec.invariants.find((i) => i.metric === "netEdgeBps")).toBeDefined();
    expect(spec.invariants.find((i) => i.metric === "winRate")).toBeDefined();
    expect(spec.verification).toContain("calendar-effect");
  });
});
