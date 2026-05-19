import { describe, it, expect } from "bun:test";
import {
  isEfficiencyRatioEnabled,
  computeEfficiencyRatio,
  efficiencyRatioToPayload,
  EFFICIENCY_RATIO_FLAG_ENV,
} from "./efficiencyRatio.ts";

describe("isEfficiencyRatioEnabled", () => {
  it("respects the flag", () => {
    expect(isEfficiencyRatioEnabled({})).toBe(false);
    expect(isEfficiencyRatioEnabled({ [EFFICIENCY_RATIO_FLAG_ENV]: "1" })).toBe(true);
  });
});

describe("computeEfficiencyRatio", () => {
  it("monotone rise → ER ≈ 1, trending", () => {
    const r = computeEfficiencyRatio({
      prices: [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110],
      period: 10,
    });
    expect(r.efficiencyRatio).toBeCloseTo(1, 5);
    expect(r.regime).toBe("trending");
  });

  it("symmetric oscillation → ER near 0, choppy", () => {
    const r = computeEfficiencyRatio({
      prices: [100, 105, 100, 105, 100, 105, 100, 105, 100, 105, 100],
      period: 10,
    });
    expect(r.efficiencyRatio).toBeLessThan(0.1);
    expect(r.regime).toBe("choppy");
  });

  it("mixed move → mixed regime", () => {
    // 3 points of net gain across 15 points of total path → ER ≈ 0.2.
    const r = computeEfficiencyRatio({
      prices: [100, 102, 101, 103, 102, 103, 101, 103, 102, 104, 103],
      period: 10,
    });
    expect(r.regime).toBe("mixed");
    expect(r.efficiencyRatio).toBeGreaterThan(0.1);
    expect(r.efficiencyRatio).toBeLessThan(0.3);
  });

  it("insufficient data → choppy with reason", () => {
    const r = computeEfficiencyRatio({ prices: [100, 101], period: 10 });
    expect(r.regime).toBe("choppy");
    expect(r.reasoning).toContain("need");
  });

  it("flat prices → ER = 0", () => {
    const r = computeEfficiencyRatio({
      prices: [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100],
      period: 10,
    });
    expect(r.efficiencyRatio).toBe(0);
  });

  it("custom thresholds change the classification", () => {
    // Same prices as the mixed-regime test → ER ≈ 0.2.
    const prices = [100, 102, 101, 103, 102, 103, 101, 103, 102, 104, 103];
    const lax = computeEfficiencyRatio({ prices, period: 10 });
    const strict = computeEfficiencyRatio({
      prices,
      period: 10,
      trendingThreshold: 0.2,
    });
    expect(lax.regime).toBe("mixed");
    expect(strict.regime).toBe("trending");
  });

  it("toPayload emits a stable shape", () => {
    const r = computeEfficiencyRatio({
      prices: [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110],
    });
    const p = efficiencyRatioToPayload(r) as { kind: string; regime: string };
    expect(p.kind).toBe("efficiency_ratio.computed");
    expect(p.regime).toBe("trending");
  });
});
