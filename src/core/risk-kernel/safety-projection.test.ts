import { describe, expect, test } from "bun:test";
import {
  evaluateBarriers,
  isFeasible,
  limitsFromRiskConfig,
  projectAction,
  type ActionLeg,
  type LegState,
  type PriorAction,
  type SafetyLimits,
  type SafetyState,
} from "./safety-projection.ts";
import { DEFAULT_RISK_CONFIG } from "./config.ts";

const UNBOUNDED = 1e9;

function leg(overrides: Partial<LegState> & { symbol: string }): LegState {
  return {
    currentNotionalUsd: 0,
    availableLiquidityUsd: UNBOUNDED,
    concentrationCapUsd: UNBOUNDED,
    rateLimitUsd: UNBOUNDED,
    riskPerUsd: 0,
    signals: [],
    costWeight: 1,
    ...overrides,
  };
}

function state(overrides: Partial<SafetyState> & { legs: LegState[] }): SafetyState {
  return {
    nowMs: 1_000_000,
    equityUsd: 10_000,
    currentDrawdownUsd: 0,
    recentActions: [],
    ...overrides,
  };
}

function limits(overrides: Partial<SafetyLimits> = {}): SafetyLimits {
  return {
    maxLeverage: 1,
    maxDrawdownUsd: UNBOUNDED,
    rateWindowMs: 60_000,
    signConsistencyMargin: 0.5,
    maxSlackUsd: 0,
    ...overrides,
  };
}

function delta(action: ActionLeg[] | null, symbol: string): number {
  const found = action?.find((l) => l.symbol === symbol);
  if (!found) throw new Error(`no leg ${symbol} in action`);
  return found.notionalDelta;
}

/**
 * Two legs where the liquidity cap on A and the leverage ceiling are both on
 * the boundary at the answer, but only liquidity carries the projection.
 */
function twoLegFixture() {
  return {
    st: state({
      equityUsd: 150,
      legs: [leg({ symbol: "BTC", availableLiquidityUsd: 100 }), leg({ symbol: "ETH" })],
    }),
    lim: limits({ maxLeverage: 1 }),
    proposal: [
      { symbol: "BTC", notionalDelta: 200 },
      { symbol: "ETH", notionalDelta: 50 },
    ],
  };
}

describe("safety projection", () => {
  test("a feasible action is returned unchanged", () => {
    const st = state({ legs: [leg({ symbol: "BTC", availableLiquidityUsd: 5_000 })] });
    const proposal = [{ symbol: "BTC", notionalDelta: 250 }];

    const result = projectAction(proposal, st, limits());

    expect(result.verdict).toBe("pass");
    expect(result.action).toEqual(proposal);
    expect(result.telemetry.deviation).toBe(0);
    expect(result.telemetry.bindingConstraints).toEqual([]);
  });

  test("an infeasible action lands on the nearest feasible point", () => {
    const { st, lim, proposal } = twoLegFixture();

    const result = projectAction(proposal, st, lim);

    expect(result.verdict).toBe("soft_intercept");
    expect(delta(result.action, "BTC")).toBeCloseTo(100, 6);
    expect(delta(result.action, "ETH")).toBeCloseTo(50, 6);
    expect(isFeasible(result.action!, st, lim)).toBe(true);
  });

  test("no feasible point on a grid is closer to the proposal than the returned action", () => {
    const { st, lim, proposal } = twoLegFixture();
    const result = projectAction(proposal, st, lim);

    const distance = (a: number, b: number) => Math.hypot(a - 200, b - 50);
    const best = distance(delta(result.action, "BTC"), delta(result.action, "ETH"));

    for (let a = -100; a <= 250; a += 5) {
      for (let b = -100; b <= 150; b += 5) {
        const candidate = [
          { symbol: "BTC", notionalDelta: a },
          { symbol: "ETH", notionalDelta: b },
        ];
        if (!isFeasible(candidate, st, lim)) continue;
        expect(distance(a, b)).toBeGreaterThanOrEqual(best - 1e-6);
      }
    }
  });

  test("feasibility holds at every step of a projected sequence", () => {
    const lim = limits({ maxLeverage: 1 });
    const proposals: ActionLeg[][] = [
      [
        { symbol: "BTC", notionalDelta: 400 },
        { symbol: "ETH", notionalDelta: -350 },
      ],
      [
        { symbol: "BTC", notionalDelta: 600 },
        { symbol: "ETH", notionalDelta: 600 },
      ],
      [
        { symbol: "BTC", notionalDelta: -900 },
        { symbol: "ETH", notionalDelta: 200 },
      ],
      [
        { symbol: "BTC", notionalDelta: 250 },
        { symbol: "ETH", notionalDelta: 250 },
      ],
    ];

    let positions = { BTC: 0, ETH: 0 };
    for (const [step, proposal] of proposals.entries()) {
      const st = state({
        nowMs: 1_000_000 + step * 1_000,
        equityUsd: 1_000,
        legs: [
          leg({
            symbol: "BTC",
            currentNotionalUsd: positions.BTC,
            availableLiquidityUsd: 300,
            concentrationCapUsd: 500,
          }),
          leg({
            symbol: "ETH",
            currentNotionalUsd: positions.ETH,
            availableLiquidityUsd: 300,
            concentrationCapUsd: 500,
          }),
        ],
      });

      const result = projectAction(proposal, st, lim);
      expect(result.action).not.toBeNull();

      positions = {
        BTC: positions.BTC + delta(result.action, "BTC"),
        ETH: positions.ETH + delta(result.action, "ETH"),
      };

      const after = state({
        equityUsd: 1_000,
        legs: [
          leg({
            symbol: "BTC",
            currentNotionalUsd: positions.BTC,
            availableLiquidityUsd: 300,
            concentrationCapUsd: 500,
          }),
          leg({
            symbol: "ETH",
            currentNotionalUsd: positions.ETH,
            availableLiquidityUsd: 300,
            concentrationCapUsd: 500,
          }),
        ],
      });
      const barriers = evaluateBarriers([], after, lim);
      expect(barriers.leverage).toBeGreaterThanOrEqual(-1e-6);
      expect(barriers.concentration).toBeGreaterThanOrEqual(-1e-6);
      expect(barriers.liquidity).toBeGreaterThanOrEqual(-1e-6);
      expect(barriers.drawdown).toBeGreaterThanOrEqual(-1e-6);
      expect(barriers.rate_limit).toBeGreaterThanOrEqual(-1e-6);
    }
  });

  test("splitting one large change into many small steps cannot exceed the rate limit", () => {
    const lim = limits({ rateWindowMs: 60_000 });
    const history: PriorAction[] = [];
    let applied = 0;

    for (let step = 0; step < 10; step++) {
      const st = state({
        nowMs: 1_000_000 + step * 1_000,
        legs: [leg({ symbol: "BTC", rateLimitUsd: 100, currentNotionalUsd: applied })],
        recentActions: history,
      });
      const result = projectAction([{ symbol: "BTC", notionalDelta: 20 }], st, lim);
      const moved = delta(result.action, "BTC");
      applied += moved;
      history.push({ atMs: st.nowMs, legs: [{ symbol: "BTC", notionalDelta: moved }] });
    }

    expect(applied).toBeLessThanOrEqual(100 + 1e-6);
    expect(applied).toBeCloseTo(100, 6);
  });

  test("telemetry names the binding constraint, not a merely active one", () => {
    const { st, lim, proposal } = twoLegFixture();

    const { telemetry } = projectAction(proposal, st, lim);

    expect(telemetry.activeConstraints).toContain("liquidity");
    expect(telemetry.activeConstraints).toContain("leverage");
    expect(telemetry.bindingConstraints).toEqual(["liquidity"]);
    expect(telemetry.tightestConstraint).toBe("liquidity");
  });

  test("telemetry reports deviation, tightness and rate utilisation for every projection", () => {
    const st = state({
      legs: [leg({ symbol: "BTC", availableLiquidityUsd: 100, rateLimitUsd: 200 })],
    });

    const { telemetry } = projectAction([{ symbol: "BTC", notionalDelta: 160 }], st, limits());

    expect(telemetry.deviation).toBeCloseTo(60, 6);
    expect(telemetry.deviationPerLeg).toEqual([{ symbol: "BTC", delta: -60 }]);
    expect(telemetry.rateLimitUtilisation).toBeCloseTo(0.5, 6);
    const liquidity = telemetry.constraints.find((c) => c.name === "liquidity")!;
    expect(liquidity.slackProposed).toBeCloseTo(-60, 6);
    expect(liquidity.slackProjected).toBeCloseTo(0, 6);
    expect(liquidity.tightness).toBeCloseTo(1, 6);
    expect(telemetry.totalSlackUsd).toBeCloseTo(0, 6);
  });

  test("an action modified within satisfiable constraints is a soft intercept", () => {
    const st = state({ legs: [leg({ symbol: "BTC", availableLiquidityUsd: 100 })] });

    const result = projectAction([{ symbol: "BTC", notionalDelta: 400 }], st, limits());

    expect(result.verdict).toBe("soft_intercept");
    expect(delta(result.action, "BTC")).toBeCloseTo(100, 6);
    expect(result.telemetry.totalSlackUsd).toBeCloseTo(0, 6);
  });

  test("a constraint that cannot be satisfied reports the slack it required", () => {
    const st = state({
      currentDrawdownUsd: 250,
      legs: [leg({ symbol: "BTC", riskPerUsd: 0.1 })],
    });
    const lim = limits({ maxDrawdownUsd: 200, maxSlackUsd: 500 });

    const result = projectAction([{ symbol: "BTC", notionalDelta: 300 }], st, lim);

    expect(result.verdict).toBe("hard_intercept");
    expect(result.action).not.toBeNull();
    expect(delta(result.action, "BTC")).toBeCloseTo(0, 4);
    const drawdown = result.telemetry.constraints.find((c) => c.name === "drawdown")!;
    expect(drawdown.slackUsedUsd).toBeCloseTo(50, 4);
    expect(result.telemetry.totalSlackUsd).toBeCloseTo(50, 4);
  });

  test("an empty feasible set returns no action rather than a zero action", () => {
    const st = state({
      currentDrawdownUsd: 250,
      legs: [leg({ symbol: "BTC", riskPerUsd: 0.1 })],
    });
    const lim = limits({ maxDrawdownUsd: 200, maxSlackUsd: 0 });

    const result = projectAction([{ symbol: "BTC", notionalDelta: 300 }], st, lim);

    expect(result.verdict).toBe("infeasible");
    expect(result.action).toBeNull();
    expect(result.telemetry.constraints.find((c) => c.name === "drawdown")!.slackProjected)
      .toBeLessThan(0);
  });

  test("soft, hard and infeasible outcomes do not collapse into one blocked verdict", () => {
    const base = { symbol: "BTC", riskPerUsd: 0.1 } as const;
    const soft = projectAction(
      [{ symbol: "BTC", notionalDelta: 400 }],
      state({ legs: [leg({ ...base, availableLiquidityUsd: 100 })] }),
      limits(),
    );
    const hard = projectAction(
      [{ symbol: "BTC", notionalDelta: 300 }],
      state({ currentDrawdownUsd: 250, legs: [leg({ ...base })] }),
      limits({ maxDrawdownUsd: 200, maxSlackUsd: 500 }),
    );
    const none = projectAction(
      [{ symbol: "BTC", notionalDelta: 300 }],
      state({ currentDrawdownUsd: 250, legs: [leg({ ...base })] }),
      limits({ maxDrawdownUsd: 200 }),
    );

    expect([soft.verdict, hard.verdict, none.verdict]).toEqual([
      "soft_intercept",
      "hard_intercept",
      "infeasible",
    ]);
  });

  test("a direction the signal ensemble rejects is refused, not shrunk", () => {
    const st = state({
      legs: [leg({ symbol: "BTC", availableLiquidityUsd: 100, signals: [1, 1, -1] })],
    });

    const result = projectAction([{ symbol: "BTC", notionalDelta: -400 }], st, limits());

    expect(result.verdict).toBe("refused");
    expect(result.action).toBeNull();
    expect(result.telemetry.tightestConstraint).toBe("sign_consistency");
    expect(result.telemetry.signConsistency[0]!.agreed).toBe(false);
  });

  test("a direction the signal ensemble supports by the margin is allowed through", () => {
    const st = state({
      legs: [leg({ symbol: "BTC", availableLiquidityUsd: 100, signals: [1, 1, -0.2] })],
    });

    const result = projectAction([{ symbol: "BTC", notionalDelta: 80 }], st, limits());

    expect(result.verdict).toBe("pass");
    expect(result.telemetry.signConsistency[0]!.agreed).toBe(true);
  });

  test("identical inputs produce identical results", () => {
    const { st, lim, proposal } = twoLegFixture();

    expect(projectAction(proposal, st, lim)).toEqual(projectAction(proposal, st, lim));
  });

  test("the rate window is measured against the injected clock", () => {
    const history: PriorAction[] = [
      { atMs: 1_000_000, legs: [{ symbol: "BTC", notionalDelta: 90 }] },
    ];
    const inWindow = projectAction(
      [{ symbol: "BTC", notionalDelta: 50 }],
      state({
        nowMs: 1_010_000,
        legs: [leg({ symbol: "BTC", rateLimitUsd: 100 })],
        recentActions: history,
      }),
      limits(),
    );
    const outOfWindow = projectAction(
      [{ symbol: "BTC", notionalDelta: 50 }],
      state({
        nowMs: 1_100_000,
        legs: [leg({ symbol: "BTC", rateLimitUsd: 100 })],
        recentActions: history,
      }),
      limits(),
    );

    expect(delta(inWindow.action, "BTC")).toBeCloseTo(10, 6);
    expect(delta(outOfWindow.action, "BTC")).toBeCloseTo(50, 6);
  });

  test("limits derived from the risk kernel config carry its ceilings", () => {
    const derived = limitsFromRiskConfig(DEFAULT_RISK_CONFIG, 20_000);

    expect(derived.maxLeverage).toBe(DEFAULT_RISK_CONFIG.maxLeverage);
    expect(derived.maxDrawdownUsd).toBeCloseTo(
      (DEFAULT_RISK_CONFIG.maxDrawdownPercent / 100) * 20_000,
      6,
    );
    expect(derived.maxSlackUsd).toBe(0);
  });
});
