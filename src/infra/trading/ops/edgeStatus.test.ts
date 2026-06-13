import { describe, expect, it } from "bun:test";
import { parseEdgeSpec } from "../../../core/edge/index.ts";
import { assessEdge } from "./edgeStatus.ts";

const SPEC = parseEdgeSpec(`---
name: fade-test
strategy: mean-reversion
status: live
regime: [ranging, chop]
instruments: [BTC/USDT]
---

## Hypothesis
Trapped buyers exit into the fade.

## Invariants
| id | metric | comparator | threshold | description |
|---|---|---|---|---|
| ev-net-positive | netEdgeBps | > | 0 | Survives cost |
| regime-ranging | regime | in | ranging,chop | Range only |

## Kill Conditions
| id | metric | comparator | threshold | description |
|---|---|---|---|---|
| regime-flip | regime | not-in | ranging,chop | Regime left range |
`);

const HEALTHY = { netEdgeBps: 6, regime: "ranging" };

// 60 trades so evaluateDecay has its full recent(20)+baseline(40) windows.
const STABLE_R = Array.from({ length: 60 }, () => 0.5);
// Recent 20 collapsed to ~0.1R vs 0.5R baseline → ratio 0.2 < retire(0.3).
const DECAYED_R = [...Array.from({ length: 20 }, () => 0.1), ...Array.from({ length: 40 }, () => 0.5)];

describe("assessEdge", () => {
  it("is stable when invariants hold and no rMultiples are supplied", () => {
    const a = assessEdge(SPEC, HEALTHY);
    expect(a.health).toBe("stable");
    expect(a.decay).toBeUndefined();
    expect(a.recommendedSizeMultiplier).toBe(1);
  });

  it("retires (size 0) when a kill condition fires, regardless of decay", () => {
    const a = assessEdge(SPEC, { netEdgeBps: 6, regime: "trending" }, STABLE_R);
    expect(a.health).toBe("retire");
    expect(a.recommendedSizeMultiplier).toBe(0);
    expect(a.invariants.firedKills.map((c) => c.invariant.id)).toContain("regime-flip");
  });

  it("folds in the statistical decay verdict when invariants still hold", () => {
    const a = assessEdge(SPEC, HEALTHY, DECAYED_R);
    expect(a.invariants.health).toBe("stable"); // invariants alone say fine
    expect(a.decay?.state).toBe("retire"); // but realized R has collapsed
    expect(a.health).toBe("retire"); // composed → more severe wins
    expect(a.recommendedSizeMultiplier).toBe(0);
    expect(a.reason).toContain("decay:");
  });

  it("keeps full size when both invariants hold and decay is stable", () => {
    const a = assessEdge(SPEC, HEALTHY, STABLE_R);
    expect(a.health).toBe("stable");
    expect(a.recommendedSizeMultiplier).toBe(1);
  });
});
