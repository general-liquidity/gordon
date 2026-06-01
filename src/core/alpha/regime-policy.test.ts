import { describe, expect, test } from "bun:test";
import {
  stateConditionalReturns,
  defaultDiscreteActions,
  regimePolicyIteration,
} from "./regime-policy.ts";

describe("stateConditionalReturns", () => {
  test("groups asset returns by regime path and averages (the paper's Table 3)", () => {
    const statePath = [0, 0, 1, 1, 0];
    const assetReturns = [
      [1, 3, 10, 20, 2], // asset 0
      [5, 5, 5, 5, 5], // asset 1
    ];
    const r = stateConditionalReturns(statePath, assetReturns, 2);
    expect(r.counts).toEqual([3, 2]);
    // State 0 = indices {0,1,4}: asset0 (1+3+2)/3=2, asset1 5
    expect(r.meanReturns[0]![0]!).toBeCloseTo(2, 6);
    expect(r.meanReturns[0]![1]!).toBeCloseTo(5, 6);
    // State 1 = indices {2,3}: asset0 (10+20)/2=15, asset1 5
    expect(r.meanReturns[1]![0]!).toBeCloseTo(15, 6);
    expect(r.meanReturns[1]![1]!).toBeCloseTo(5, 6);
  });
});

describe("defaultDiscreteActions", () => {
  test("pure single-asset positions + equal-weight", () => {
    const a = defaultDiscreteActions(3);
    expect(a.length).toBe(4); // 3 pure + 1 equal-weight
    expect(a[0]).toEqual([1, 0, 0]);
    expect(a[1]).toEqual([0, 1, 0]);
    expect(a[2]).toEqual([0, 0, 1]);
    for (const w of a) expect(w.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 9);
  });
});

describe("regimePolicyIteration", () => {
  const transitions = [
    [0.9, 0.1],
    [0.2, 0.8],
  ];
  const expectedReturns = [
    [0.02, -0.01], // state 0: asset 0 best
    [-0.01, 0.03], // state 1: asset 1 best
  ];
  const actions = defaultDiscreteActions(2); // [[1,0],[0,1],[0.5,0.5]]

  test("picks the max-expected-return action per regime (current reward)", () => {
    const r = regimePolicyIteration({ transitions, actions, expectedReturns, rewardModel: "current" });
    expect(r.converged).toBe(true);
    expect(r.policy).toEqual([0, 1]); // state0→asset0, state1→asset1
    expect(r.policyWeights[0]).toEqual([1, 0]);
    expect(r.policyWeights[1]).toEqual([0, 1]);
  });

  test("value function satisfies the Bellman equation under π*", () => {
    const gamma = 0.9;
    const r = regimePolicyIteration({ transitions, actions, expectedReturns, discount: gamma });
    // R(s, π(s)) for the current-reward model = ⟨action, returns[s]⟩.
    for (let s = 0; s < 2; s++) {
      const a = actions[r.policy[s]!]!;
      const reward = a[0]! * expectedReturns[s]![0]! + a[1]! * expectedReturns[s]![1]!;
      const cont = transitions[s]![0]! * r.values[0]! + transitions[s]![1]! * r.values[1]!;
      expect(r.values[s]!).toBeCloseTo(reward + gamma * cont, 6);
    }
  });

  test("γ changes the value but not the policy (action-independent transition)", () => {
    const lo = regimePolicyIteration({ transitions, actions, expectedReturns, discount: 0 });
    const hi = regimePolicyIteration({ transitions, actions, expectedReturns, discount: 0.95 });
    expect(lo.policy).toEqual(hi.policy);
    // Higher γ accumulates more discounted future reward → larger values here.
    expect(hi.values[0]!).toBeGreaterThan(lo.values[0]!);
  });

  test("lookahead reward can flip the policy vs current reward", () => {
    const t = [
      [0.1, 0.9], // state 0 transitions mostly INTO state 1
      [0.9, 0.1],
    ];
    const er = [
      [0.05, 0.0], // state 0 favors asset 0
      [0.0, 0.05], // state 1 favors asset 1
    ];
    const acts = [
      [1, 0],
      [0, 1],
    ];
    const cur = regimePolicyIteration({ transitions: t, actions: acts, expectedReturns: er, rewardModel: "current" });
    const look = regimePolicyIteration({ transitions: t, actions: acts, expectedReturns: er, rewardModel: "lookahead" });
    expect(cur.policy[0]).toBe(0); // current: hold asset 0 (state 0 favors it)
    expect(look.policy[0]).toBe(1); // lookahead: anticipate the move into state 1 → asset 1
  });

  test("reproduces the paper's Table-4 Top-1 rotation on its own parameters", () => {
    // Table 3 state-conditional means, asset order [TLT, GLD, SPY].
    const er = [
      [-0.000119, 0.000458, 0.001295], // State 0: SPY highest
      [0.000228, 0.000335, 0.000014], // State 1: GLD highest
      [0.001673, 0.000476, -0.004749], // State 2: TLT highest
    ];
    // Table 2(b) transition matrix.
    const t = [
      [0.9386, 0.0614, 0.0],
      [0.0726, 0.9093, 0.0181],
      [0.0001, 0.126, 0.874],
    ];
    const acts = defaultDiscreteActions(3); // A0=TLT, A1=GLD, A2=SPY, A3=equal
    const r = regimePolicyIteration({ transitions: t, actions: acts, expectedReturns: er, rewardModel: "current" });
    // Paper Table 4 Top-1: State0→SPY, State1→GLD, State2→TLT.
    expect(r.policy).toEqual([2, 1, 0]);
    expect(r.policyWeights[0]).toEqual([0, 0, 1]); // SPY
    expect(r.policyWeights[1]).toEqual([0, 1, 0]); // GLD
    expect(r.policyWeights[2]).toEqual([1, 0, 0]); // TLT
  });

  test("explicit reward matrix overrides expectedReturns", () => {
    const r = regimePolicyIteration({
      transitions,
      actions,
      expectedReturns: [],
      rewardMatrix: [
        [0.0, 1.0, 0.0], // state 0 → action 1 best
        [1.0, 0.0, 0.0], // state 1 → action 0 best
      ],
    });
    expect(r.policy).toEqual([1, 0]);
  });

  test("guards an empty MDP", () => {
    const r = regimePolicyIteration({ transitions: [], actions: [], expectedReturns: [] });
    expect(r.policy).toEqual([]);
    expect(r.converged).toBe(true);
  });
});
